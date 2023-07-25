import { BaseSymbolInformation, DocumentSymbol } from 'vscode-languageserver';
import Parser, { Tree, QueryMatch, Query, Language, SyntaxNode } from 'web-tree-sitter';
import { assert } from 'chai';
import { homedir } from 'os';
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import { isCommandName, isFunctionDefinitionName } from '../src/utils/node-types';
import * as NodeTypes from '../src/utils/node-types'
import { getChildNodes } from '../src/utils/tree-sitter';
import { initializeParser } from "../src/parser";
import { Analyzer, findParentScopes, findDefs, findLocalDefinitionSymbol } from "../src/analyze";
import { LspDocument } from "../src/document";
import { FishDocumentSymbol } from "../src/document-symbol";
 
let parser: Parser;
let lang:Language;
let query: Query;
const jestConsole = console;
beforeEach(async () => {
    parser = await initializeParser();
    lang = parser.getLanguage();
    global.console = require("console");
}, 10000);

afterEach(() => {
    global.console = jestConsole;
    if (query) query.delete();
    if (parser) parser.delete();
});

function testHelper(docPath: string, inAutoloadPath: boolean = true) {
    const doc = resolveLspDocumentForHelperTestFile(docPath, inAutoloadPath);
    const tree = parser.parse(doc.getText())
    const root = tree.rootNode;
    const allNodes = getChildNodes(root);
    return {
        document: doc,
        tree: tree,
        root: root,
        allNodes: allNodes
    }
}



describe("scopes tests", () => {

    it("finding all scope nodes in a document", async () => {
        const { allNodes } = testHelper(`fish_files/advanced/variable_scope_2.fish`);
        const scopes = allNodes.filter((node) => NodeTypes.isScope(node))

        scopes.forEach((scope, index) => {
            console.log(index, scope.text.split('\n')[0]);
        })

    })

})


