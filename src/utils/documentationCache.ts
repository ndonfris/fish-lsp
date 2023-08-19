import { MarkupKind, SymbolKind, MarkupContent, DocumentSymbol } from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import { documentationHoverProviderForBuiltIns } from '../documentation';
import { execCommandDocs, execEscapedCommand } from './exec';
import { uriToPath } from './translation';


/****************************************************************************************
 *                                                                                      *
 * @TODO: DO NOT convert this to a FishDocumentSymbol! Instead, use this to cache to    *
 * FishDocumentSymbol documentation strings cached. FishDocumentSymbol will lookup      *
 * base documentation from this cache. Converting this to a FishDocumentSymbol will     *
 * cause issues with the lsp api because, documentSymbols require a range/location      *
 *        (Maybe check BaseSymbol, I vaguely remember that one of the Symbol's          *
 *         mentions not requiring a Range, having multiple symbols is still             *
 *         not a capability the protocol supports, as per the v.0.7.0)                  *
 * With that in mind, build out a structure inside analyzer, that will be able to use   *
 * everything that is necessary for a well-informed detail to the client.               *
 * Current goal likely needs:                                                           *
 *       • parser                                                                       *
 *       • FishDocumentSymbol                                                           *
 *       • This DocumentationCache                                                      *
 *       • some kind of flag resolver (the function flags '--description',              *
 *         '--argument-names', '--inherit-variables', come to mind)                     *
 *                                                                                      *
 *                                                                                      *
 * @TODO: support docs & formatted docs. (non-markdown version will be docs)            *
 *                                                                                      *
 * @TODO: Refactor building documentation string! Potentially remove documentation.ts   *
 * and replace it with a lot of the methods seen here.                                  *
 *                                                                                      *
 ****************************************************************************************/

export interface CachedGlobalItem {
    docs?: string;
    formattedDocs?: MarkupContent;
    uri?: string;
    refrenceUris: Set<string>;
    type: SymbolKind;
    resolved: boolean;
}

export function createCachedItem(type: SymbolKind, uri?: string): CachedGlobalItem {
    return {
        type: type,
        resolved: false,
        uri: uri,
        refrenceUris: uri ? new Set([...uri]) : new Set<string>()
    } as CachedGlobalItem;
}


/**
 * Currrently spoofs docs as FormattedDocs, likely to change in future versions.
 */
async function getNewDocSring(name: string, item: CachedGlobalItem) : Promise<string | undefined> {
    switch (item.type) {
    case SymbolKind.Variable:
        return await getVariableDocs(name);
    case SymbolKind.Function:
        return await getFunctionDocString(name)
    case SymbolKind.Class:
        return await getBuiltinDocString(name)
    default:
        return undefined;
    }
}

export async function resolveItem(name: string, item: CachedGlobalItem, uri?: string) {
    if (uri !== undefined) { item.refrenceUris.add(uri)}
    if (item.resolved) {return item}
    if (item.type === SymbolKind.Function) {
        item.uri = await getFunctionUri(name)
    }
    const newDocStr: string | undefined = await getNewDocSring(name, item)
    item.resolved = true;
    if (!newDocStr) {
        return item;
    }
    item.docs = newDocStr;
    return item;
}

/**
 * just a getter for the absolute path to a function defined
 */
async function getFunctionUri(name: string): Promise<string | undefined> {
    const uriString = await execEscapedCommand(`type -ap ${name}`)
    const uri = uriString.join('\n').trim();
    if (!uri) {
        return undefined;
    }
    return uri;
}

/**
 * builds MarkupString for function names, since fish shell standard for private functions
 * is naming convention with leading '__', this function ensures that our MarkupStrings
 * will be able to display the FunctionName (instead of interpreting it as '__' bold text)
 */
function escapePathStr(functionTitleLine: string) : string {
    const afterComment =  functionTitleLine.split(' ').slice(1)
    const pathIndex = afterComment.findIndex((str: string) => str.includes('/')) 
    const path = afterComment[pathIndex]
    return [
    '**'+afterComment.slice(0, pathIndex).join(' ').trim() + '**',
    `*\`${path.toString()}\`*`,
    '**'+afterComment.slice(pathIndex + 1).join(' ').trim() + '**'
    ].join(' ')
}

/**
 * builds FunctionDocumentaiton string
 */
async function getFunctionDocString(name: string): Promise<string | undefined> {
    const docStr = await execCommandDocs(name);
    if (docStr) {
        const docTitle = docStr.split('\n')[0]
        const docBody = docStr.split('\n').slice(1).join('\n');
        return [
            `${escapePathStr(docTitle).trim()}`,
            '___',
            '```fish',
            docBody,
            '```'
        ].join('\n');
    }
    return undefined;
}
/** 
 * builds MarkupString for builtin documentation
 */
export async function getBuiltinDocString(name: string): Promise<string | undefined> {
    const cmdDocs: string = await execCommandDocs(name);
    if (!cmdDocs) return undefined
    const splitDocs = cmdDocs.split('\n');
    const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME')
    return [
        `__${name.toUpperCase()}__ - _https://fishshell.com/docs/current/cmds/${name.trim()}.html_`,
        `___`,
        '```man',
        splitDocs.slice(startIndex).join('\n'),
        '```'
    ].join('\n') 
}
/**
 * builds MarkupString for global variable documentation
 */
async function getVariableDocs(name: string): Promise<string | undefined> {
    const docs = await execEscapedCommand(`set --show ${name}`)
    if (!docs) {
        return undefined;
    }
    const splitDocs = docs.join('\n').split('\n');
    const splitTitleArray = splitDocs[0].split(':');
    const splitOther: string[] = splitDocs.slice(1);
    const formattedOther = splitOther.map((line: string) => {
        const arr = line.split(': ');
        const fishScript = ['**|**', arr[1].slice(1,-1), '**|**'].join('`')
        return `*${arr[0]}*: ${fishScript}`
    }).join('\n')
    return [
        `**${splitTitleArray[0].trim()}** - *${splitTitleArray[1].trim()}*`,
        //'___',
        formattedOther
    ].join('\n')
}


export function initializeMap(collection: string[], type: SymbolKind, uri?: string): Map<string, CachedGlobalItem> {
    const items: Map<string, CachedGlobalItem> = new Map<string, CachedGlobalItem>();
    collection.forEach((item) => {
        items.set(item, createCachedItem(type));
    })
    return items
}

/**
 * Uses internal fish shell commands to store brief output for global variables, functions,
 * builtins, and unknown identifiers. This class is meant to be initialized once, on server
 * startup. It is then used as fallback documentation provider, if our analysis can't 
 * resolve any documentation for a given identifier.
 */
export class DocumentationCache {

    private _variables: Map<string, CachedGlobalItem> = new Map();
    private _functions: Map<string, CachedGlobalItem> = new Map();
    private _builtins: Map<string, CachedGlobalItem> = new Map();
    private _unknowns: Map<string, CachedGlobalItem> = new Map();

    get items(): string[] {
        return [
            ...this._variables.keys(),
            ...this._functions.keys(),
            ...this._builtins.keys(),
            ...this._unknowns.keys()
        ]
    }

    async parse(uri?: string) {
        this._unknowns = initializeMap([], SymbolKind.Null, uri);
        await Promise.all([
            execEscapedCommand('set -n'),
            execEscapedCommand(`functions -an`),
            execEscapedCommand('builtin -n')
        ]).then(([vars, funcs, builtins]) => {
            this._variables = initializeMap(vars, SymbolKind.Variable, uri);
            this._functions = initializeMap(funcs, SymbolKind.Function, uri);
            this._builtins = initializeMap(builtins, SymbolKind.Class, uri);
        })
        return this
    }

    find(name: string, type?: SymbolKind): CachedGlobalItem | undefined {
        if (type === SymbolKind.Variable) {
            return this._variables.get(name);
        }
        if (type === SymbolKind.Function) {
            return this._functions.get(name);
        }
        if (type === SymbolKind.Class) {
            return this._builtins.get(name);
        }
        return this._unknowns.get(name);
    }

    findType(name: string): SymbolKind {
        if (this._variables.has(name)) {
            return SymbolKind.Variable;
        }
        if (this._functions.has(name)) {
            return SymbolKind.Function;
        }
        if (this._builtins.has(name)) {
            return SymbolKind.Class;
        }
        return SymbolKind.Null;
    }

    /**
     * @async
     * Resolves a symbol's documentation. Store's resolved items in the Cache, otherwise
     * returns the already cached item.
     */
    async resolve(name: string, uri?:string, type?: SymbolKind) {
        const itemType = type || this.findType(name);
        let item : CachedGlobalItem | undefined = this.find(name, itemType);
        if (!item) {
            item = createCachedItem(itemType, uri);
            this._unknowns.set(name, item);
        }
        if (item.resolved && item.docs) return item;
        if (!item.resolved) {
            item = await resolveItem(name, item)
        } 
        if (!item.docs) { 
            this._unknowns.set(name, item)
        }
        this.setItem(name, item)
        return item
    }

    /**
     * sets an item, mostly called within this class, because CachedGlobalItem will typically
     * already be resolved.
     *
     * @param {string} name - string for the symbol
     * @param {CachedGlobalItem} item - the item to set
     */
    setItem(name: string, item: CachedGlobalItem) {
        switch (item.type) {
            case SymbolKind.Variable:
                this._variables.set(name, item)
                break;
            case SymbolKind.Function:
                this._functions.set(name, item)
                break;
            case SymbolKind.Class:
                this._builtins.set(name, item)
                break;
            default:
                this._unknowns.set(name, item)
                break;
        }
    }

    /**
    * getter for a cached item, guarding SymbolKind.Null from retrieved.
    */
    getItem(name: string) {
        const item = this.find(name);
        if (!item || item.type === SymbolKind.Null) {
            return undefined;
        }
        return item;
    }

}

/**
 * Function to be called when the server is initialized, so that the DocumentationCache
 * can be populated.
 */
export async function initializeDocumentationCache() {
    const cache = new DocumentationCache();
    await cache.parse();
    return cache;
}