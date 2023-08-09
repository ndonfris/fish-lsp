import { homedir } from 'os'
import { assert } from 'chai'
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import {DocumentSymbol,SymbolKind,} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { initializeParser } from "../src/parser";
import { Analyzer, findParentScopes, findDefs } from "../src/analyze";
import { filterLastPerScopeSymbol, FishDocumentSymbol} from '../src/document-symbol';
import { FishWorkspace, initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { WorkspaceSpoofer } from './workspace-builder';
 
let parser: Parser;
let analyzer: Analyzer;
let allPaths: string[] = [];
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;
let workspaces: FishWorkspace[] = [];
const jestConsole = console;

beforeEach(async () => {
    parser = await initializeParser();
    global.console = require("console");
}, 10000);

afterEach(() => {
    global.console = jestConsole;
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

    it('checking initializedResult amount/speed', async () => {
        workspaces = await initializeDefaultFishWorkspaces()
        analyzer = new Analyzer(parser, workspaces)
        const initializedResult = await analyzer.initiateBackgroundAnalysis();
        const amount = initializedResult.filesParsed;
        //analyzer.globalSymbols.allSymbols.forEach((symbol) => {
        //    console.log(symbol.name);
        //})
        //console.log(amount);
        assert.isAbove(amount, 100)
    });

    it('checking spoofed workspace_1', async () => {
        workspaces = [await WorkspaceSpoofer.create('workspace_1')]
        analyzer = new Analyzer(parser, workspaces)
        const initializedResult = await analyzer.initiateBackgroundAnalysis();
        const amount = initializedResult.filesParsed;
        analyzer.globalSymbols.allSymbols.forEach((symbol) => {
            console.log(symbol.name);
        })
        console.log(amount);
        //assert.isAbove(amount, 100)
    });

});