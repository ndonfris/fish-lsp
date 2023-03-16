import fs from 'fs'
import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,Position,SymbolKind, WorkspaceSymbol,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop, isVariable, isCommand, isCommandName,} from "../src/utils/node-types";
//import { CommentRange, DocumentDefSymbol, symbolKindToString } from "../src/symbols";
import { FishDocumentSymbol } from '../src/document-symbol';
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { SymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
import { pathToRelativeFunctionName, toLspDocument, uriToPath } from '../src/utils/translation';
import * as fastGlob from 'fast-glob'
import { execEscapedCommand } from '../src/utils/exec';
import { initializeFishWorkspaces, Workspace } from '../src/utils/workspace';
 
let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let allPaths: string[] = [];
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;
let workspaces: Workspace[] ;

//const chalk = new Chalk();
//const term = new TerminalRenderer()
//marked.setOptions({
    //// Define custom renderer
    //renderer: term,
    //gfm: true,
//});
const jestConsole = console;
//setMarkedterminal();

beforeEach(async () => {
    parser = await initializeParser();
    documentationCache = await initializeDocumentationCache();
    workspaces = await initializeFishWorkspaces({});
    analyzer = new Analyzer(parser, documentationCache, workspaces)
    //const amount = await analyzer.initiateBackgroundAnalysis()
    //loggedAmount = amount.filesParsed;
    //symbols = [];
    global.console = require("console");
}, 10000);

afterEach(() => {
    global.console = jestConsole;
    //parser.reset();
    symbols = [];
});

function analyzeConfigDocument() {
    const doc = resolveLspDocumentForHelperTestFile(`${homedir()}/.config/fish/config.fish`);
    analyzer.analyze(doc);
    return {doc: doc, analyzer: analyzer};
}

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe("analyze tests", () => {

    const analyze_test_1 = 'generates WorkspaceSymbols in background (logging total files parsed)';
    it(analyze_test_1, async () => {
        const shouldLog = false;

        const initializedResult = await analyzer.initiateBackgroundAnalysis();
        if (shouldLog) console.log(initializedResult);

        expect(initializedResult.filesParsed).toBeGreaterThan(0);
        if (shouldLog) console.log(Array.from(analyzer.globalSymbols.keys()).length);
        if (!shouldLog) return

        const symbols = Array.from(analyzer.globalSymbols.values()).flat();
        for (const symbol of symbols) {
            if (!symbol.uri.startsWith("file:///usr/share")) {
                console.log(symbol.name);
                console.log(symbol.uri);
                console.log(symbol.detail);
                console.log("-".repeat(symbol.uri.length) + '\n');
            }
        }

    });

    const analyze_test_2 = `checking specific 'config.fish' analysis`
    it(analyze_test_2, async () => {
        const shouldLog = true;

        const doc = resolveLspDocumentForHelperTestFile(`${homedir()}/.config/fish/config.fish`);
        analyzer.analyze(doc);

        //const result = analyzer.uriToAnalyzedDocument[doc.uri]

        if (!shouldLog) return

        const symbolMap: Map<string, FishDocumentSymbol[]> = analyzer.globalSymbols;
        const brokenSymbol: FishDocumentSymbol = symbolMap.get('fish_user_key_bindings')!.at(0)!
        console.log(brokenSymbol.detail);
        // detail looks like its working now (3/21/2023)

    });

    // TODO: convert all symbols to SymbolInformation, and only grab the document symbols per
    // request from client
    //
    // WHY?
});



// small helper to print out the client tree like the editor would tree
//function logClientTree(symbols: DocumentSymbol[], level = 0) {
    //for (const symbol of symbols) {
        //const logIcon = symbol.kind === SymbolKind.Function ? "  " :  "  "
        //console.log("  ".repeat(level) + `${logIcon}${symbol.name}`);
        //logClientTree(symbol.children || [], level + 1);
    //}
//
//}