import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,BaseSymbolInformation, Range, Position,SymbolKind, MarkupContent, WorkspaceSymbol, DocumentUri,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop, isCommandName,} from "../src/utils/node-types";
import { CommentRange, symbolKindToString } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { DocumentSymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
import { execCommandDocs, execEscapedCommand } from '../src/utils/exec';
let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;

const jestConsole = console;

beforeAll(async () => {
    parser = await initializeParser();
    documentationCache = await initializeDocumentationCache();
    analyzer = new Analyzer(parser, documentationCache);
    symbols = [];
})
beforeEach(async () => {
    global.console = require("console");
});

afterEach(() => {
    global.console = jestConsole;
    parser.reset();
});

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("symbolsCache tests", () => {

    it('getRefrences for config.fish', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`${homedir}/.config/fish/config.fish`); 
        const cache = new WorkspaceCache();
        await cache.initialize();
        cache.logCache()
        cache.parseDocument(doc)
    }, 5000)

    it('comparing to documentationCache.ts', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`${homedir}/.config/fish/config.fish`); 
        const cache = new DocumentationCache();
        await cache.parse(doc.uri)
    })
});



// export interface IndistinctSymbol extends BaseSymbolInformation {
//     documentation: MarkupContent;
//     unqiue: boolean;
//     uri?: DocumentUri;
//     range?: Range;
// }

// builtins
export interface IndistinctSymbol extends BaseSymbolInformation {
    documentation: MarkupContent,
    unqiue: false;
    resolved: boolean;
    //resolveDocumentation:
}

const createBuiltinSymbol = async (name: string) => {
    return {
        name: name,
        kind: SymbolKind.Class,
        documentation: {
            kind: 'markdown',
            value: (await getBuiltinDocString(name))?.toString() || '',
        },
        unqiue: false,
    } as IndistinctSymbol
}
/** 
 * builds MarkupString for builtin documentation
 */
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

// for functions/variables
export interface ExportedSymbol extends WorkspaceSymbol {
    documentation: MarkupContent;
    unique: true;
}

export class WorkspaceCache {

    public cache: Map<string, IndistinctSymbol|ExportedSymbol> = new Map();

    constructor() {}

    async initialize() {
        const builtinNames = await execEscapedCommand('builtin -n')
        return await Promise.all(
            builtinNames.map((name: string) => createBuiltinSymbol(name))
        ).then((builtins) =>
            builtins.forEach((symbol: IndistinctSymbol) => {
                this.cache.set(symbol.name, symbol);
            })
        );
    }

    // @TODO
    public async parseDocument(doc: LspDocument) {
        const tree = parser.parse(doc.getText());
        const root = tree.rootNode;
        this.findSourcedUris(root)
        const symbols = DocumentSymbolTree(root).last()
    }

    private findSourcedUris(root: SyntaxNode): DocumentUri[] {
        //const checked = new Set<string>()
        getChildNodes(root)
            .filter((n) => isCommandName(n) && !this.cache.has(n.text))
            .filter((n, idx, self) => self.findIndex((other) => other.text === n.text) === idx)
            .forEach((c) => {
                    console.log(c.text);
            });
        return [];
    }

    public async logCache() {
        for (const [key, value] of this.cache) {
            console.log(`${key}: ${value.documentation.value}`);
        }
    }


}








