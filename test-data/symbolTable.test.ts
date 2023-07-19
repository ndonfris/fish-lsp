
import Parser from 'web-tree-sitter';
import { SymbolTable } from '../src/utils/symbolTable';
import { Analyzer, findParentScopes, findDefs, findLocalDefinitionSymbol } from "../src/analyze";
import { initializeParser } from "../src/parser";
import { initializeFishWorkspaces, Workspace } from '../src/utils/workspace';
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import { homedir } from 'os';
import { flattenFishDocumentSymbols } from '../src/document-symbol';
import { getChildNodes } from '../src/utils/tree-sitter';
import { isProgram, isScope } from '../src/utils/node-types';
 
let parser: Parser;
let analyzer: Analyzer;
let workspaces: Workspace[] ;
const jestConsole = console;

beforeEach(async () => {
    parser = await initializeParser();
    workspaces = await initializeFishWorkspaces({});
    analyzer = new Analyzer(parser, workspaces)
    //const amount = await analyzer.initiateBackgroundAnalysis()
    //loggedAmount = amount.filesParsed;
    //symbols = [];
    global.console = require("console");
}, 10000);

afterEach(() => {
    global.console = jestConsole;
});


describe("analyze tests", () => {
    it("test symbol table toString", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope.fish`);
        analyzer.analyze(doc);

        const root = analyzer.getRootNode(doc)!
        const symbols = flattenFishDocumentSymbols(analyzer.cache.getDocumentSymbols(doc.uri))
        const symbolTable = new SymbolTable(root);


        const allNodes =  getChildNodes(root);
        for (const node of allNodes) {
            if (!isScope(node) || isProgram(node)) continue;
            console.log(node.text);
        }

        //symbolTable.build();
        //for (const s of symbols) {
            //const scope = symbolTable.findScope(s.selectionRange);
            //const foundStr = !!scope ? "    found" : "not found"
            //console.log(foundStr, s.name, s.selectionRange);
            //console.log(scope?.truncated());
        //}
    })



})