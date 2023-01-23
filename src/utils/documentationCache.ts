import { MarkupContent } from 'coc.nvim';
import { MarkupKind, SymbolKind } from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import { documentationHoverProviderForBuiltIns } from '../documentation';
import { execCommandDocs, execEscapedCommand } from './exec';
import { uriToPath } from './translation';

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

//async function getFormattedDocString(name: string, item: CachedGlobalItem) : Promise<MarkupContent | undefined> {
//    switch (item.type) {
//    case SymbolKind.Variable:
//        return {
//            kind: MarkupKind.Markdown,
//            value: [
//                    item.docs,
//                ].join('\n')
//        }
//    case SymbolKind.Function:
//        return {
//            kind: MarkupKind.Markdown,
//            value: [
//                    `${name} defined in ${item.uri}`
//                    '___',
//            ].join('\n')
//        }
//    case SymbolKind.Class:
//        return {
//                kind: MarkupKind.Markdown,
//                value: item?.docs || "",
//            }
//    default:
//        return undefined;
//    }
//}                                                                  

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

async function getVariableDocs(name: string): Promise<string | undefined> {
    const docs = await execEscapedCommand(`set --show ${name}`)
    if (!docs) {
        return undefined;
    }
    const splitDocs = docs.join('\n').split('\n');
    const splitTitleArray = splitDocs[0].split(':');
    const splitOther = splitDocs.slice(1);
    return [
        `__${splitTitleArray[0].trim()}__ - _${splitTitleArray[1].trim()}_`,
        '___',
        splitOther.join('\n')
    ].join('\n')
    //return docs.join('\n').trim();
}

async function getFunctionUri(name: string): Promise<string | undefined> {
    const uriString = await execEscapedCommand(`type -ap ${name}`)
    const uri = uriString.join('\n').trim();
    if (!uri) {
        return undefined;
    }
    return uri;
}

async function getFunctionDocString(name: string): Promise<string | undefined> {
    const docStr = await execCommandDocs(name);
    if (docStr) {
        const docTitle = docStr.split('\n')[0];
        const docBody = docStr.split('\n').slice(1).join('\n');
        return [
            `_${docTitle.substring(2)}_`,
            '___',
            '```fish',
            docBody,
            '```'
        ].join('\n');
    }
    return undefined;
}
async function getBuiltinDocString(name: string): Promise<string | undefined> {
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

export function initializeMap(collection: string[], type: SymbolKind, uri?: string): Map<string, CachedGlobalItem> {
    const items: Map<string, CachedGlobalItem> = new Map<string, CachedGlobalItem>();
    collection.forEach((item) => {
        items.set(item, createCachedItem(type));
    })
    return items
}

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

    private setUnknown(name: string, item: CachedGlobalItem) {
        item.resolved = true;
        this._unknowns.set(name, item);
    }

    async resolve(name: string, uri?:string, type?: SymbolKind) {
        const itemType = type || this.findType(name);
        let item : CachedGlobalItem | undefined = this.find(name, itemType);
        if (!item) {
            item = createCachedItem(itemType, uri);
            this._unknowns.set(name, item);
        }
        if (!item.resolved) {
            //if (itemType === SymbolKind.Function) {
                //item.uri = await getFunctionUri(name)
                //if (!item.uri) {
                    //this._unknowns.set(name, item);
                //}
            //}
            item = await resolveItem(name, item)
        } 
        if (!item.docs) { 
            this._unknowns.set(name, item)
        }
        //item
        //switch (itemType) {
            //case SymbolKind.Variable:
                //item.formattedDocs = this._variables.get(name)
                //break;
            //case SymbolKind.Function:
                //item = this._functions.get(name)
                //break;
            //case SymbolKind.Class:
                //item = this._builtins.get(name)
                //break;
            //default:
                //item = this._unknowns.get(name)
                //break;
        //}
        //item.formattedDocs =
        return item
    }



}















