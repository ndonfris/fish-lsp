import fs from 'fs'
import { resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,Position,SymbolKind,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { LspDocument } from "../src/document";
import {findFirstParent, getChildNodes } from "../src/utils/tree-sitter";
import { Analyzer, getAllPaths } from "../src/analyze";
import { isFunctionDefinition,isDefinition,isVariableDefinition,isScope, findParentCommand, isForLoop, isVariable, isCommand, isCommandName,} from "../src/utils/node-types";
import { CommentRange, DocumentDefSymbol, symbolKindToString } from "../src/symbols";
import { DocumentationCache, initializeDocumentationCache } from "../src/utils/documentationCache";
import { DocumentSymbolTree } from "../src/symbolTree";
import { homedir } from 'os';
import { pathToRelativeFunctionName, toLspDocument, uriToPath } from '../src/utils/translation';
import * as fastGlob from 'fast-glob'
import { execEscapedCommand } from '../src/utils/exec';
 
let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let allPaths: string[] = [];
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;

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
    allPaths = await getAllPaths()
    analyzer = new Analyzer(parser, documentationCache, allPaths);
    symbols = [];
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
describe("analyze tests", () => {
    it('testing generating WorkspaceSymbols in background', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`${homedir}/.config/fish/config.fish`);
        console.log();
        analyzer.analyze(doc)
        const amount = await analyzer.initiateBackgroundAnalysis({backgroundAnalysisMaxFiles: 1000})
        for await (const [k, v] of analyzer.lookupUriMap.entries()) {
            console.log(`k: ${k} v: ${v}`);
        }
        //const { globalDefinitions } = analyzer.uriToAnalyzedDocument[doc.uri]
        //Object.values(globalDefinitions).forEach((symbol) => {
            //console.log(symbol);
        //})
        const wsSymbols = analyzer.getAllWorkspaceSymbols();
        for (const symbol of wsSymbols) {
            if (symbol.kind === SymbolKind.Function) {
                console.log(symbol);
            }
        }
        console.log(amount);
        expect(true).toBeTruthy()
    })
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



