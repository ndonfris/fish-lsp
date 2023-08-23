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
let analyzer: Analyzer;
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


describe("querying examples for future devs", () => {
    /**
     * Starting off we have using the query method from the tree-sitter framework:
     *  • http://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax
     *  • https://github.com/ram02z/tree-sitter-fish/blob/master/queries/highlights.scm
     *  • https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
     */
    it("tree-sitter query method [function_definition nodes]", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope.fish`);
        const tree = parser.parse(doc.getText())
        //tree.printDotGraph()
        const query = lang.query(
            `(function_definition
                name: [
                    (word) (concatenation)
                ] 
            @function)`
        );
        //query.captures(tree.rootNode).forEach((capture) => console.log(capture.node.text));
        //query.matches(tree.rootNode).forEach((match) => console.log(match))
        //query.captureNames.forEach((capture) => console.log(capture))
        assert.deepEqual(
            query.captures(tree.rootNode).map((cap) => cap.node.text),
            ["aaa", "bbb"]
        );
        assert.deepEqual(query.captureNames.length, 1)
    })

    /**
     * Common practice among LSPs using tree-sitter for parsing does not typically use the
     * query method defined above. Currently it appears the api's node-tree-sitter vs web-tree-sitter,
     * are not 1 to 1. When writting this LSP, it appeared simplier to use SyntaxNode methods
     * provided, to determine how trees are queried.
     */
    it("fish-lsp method to get [function_definition nodes]", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope.fish`);
        const tree = parser.parse(doc.getText())

        /**
         * get all function definitions via 'src/utils/node-types.ts' & 'src/utils/tree-sitter.ts'
         */
        const allNodes = getChildNodes(tree.rootNode!);
        const functionNodes: SyntaxNode[] = allNodes.filter((node: SyntaxNode) => isFunctionDefinitionName(node))

        //functionNodes.forEach((node: SyntaxNode) => console.log(node.text))
        assert.deepEqual(functionNodes.map((node: SyntaxNode) => node.text), ["aaa", "bbb"]);
    })

    const fishbangOne = [
        `#!/usr/bin/env fish`,
        `fish -c 'echo "hello world"'`,
        `builtin --names`
    ].join('\n');
    const fishbangTwo = [
        `#!/usr/bin/fish`,
        `echo "executing some fish commands..."`
    ].join('\n')
    const fishbangFail = [
        `echo 'not necessarily a fish script';`,
        `printf "%s\n" "this should fail the shebangTest"`,
    ].join("\n");


    /**
     * FEATURES extending the functionality of this LSP (debugging, etc...), can build off of either of these methods,
     */
    it("fish-lsp more examples", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope.fish`);
        const tree = parser.parse(doc.getText())

        const allNodes = getChildNodes(tree.rootNode!);

        const uniqueCommands = Array.from(new Set(allNodes.filter((n) => isCommandName(n)).map((n) => n.text)))

        assert.deepEqual(uniqueCommands,  ['seq', 'echo', 'true', 'set', 'bbb', 'aaa']); //console.log(uniqueCommands);
    })

    it("example to check if first line of script as a fish shell shebang implementations", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope.fish`);

        function approachOne(text: string) {
            const firstLine = text.split('\n').slice(0, 1).join('');
            return firstLine.startsWith("#!") && firstLine.includes("/fish");
        }

        function approachTwo(text: string) {
            const tree = parser.parse(text)
            const firstNode = tree.rootNode.firstChild;
            return firstNode && firstNode.text.startsWith("#!") && firstNode.text.includes("/fish") 
        }

        // writing tests for the Lsp become significantly simpler once understanding the LspDocument class
        // is just an abstraction for the Lsp to keep track of files (seen below). 
        const shebangScript = doc.getText();
        const notShebangScript = `fish -c "ls"; echo "executing some fish commands...";builtin --names`

        assert.deepEqual( approachOne(shebangScript) , approachTwo(shebangScript)    );
        assert.notEqual(  approachOne(shebangScript) , approachOne(notShebangScript) );
        assert.notEqual(  approachTwo(shebangScript) , approachTwo(notShebangScript) );
    })

    it("example if a node is a fish shell shebang implementations", async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/variable_scope_2.fish`);

        // writing tests for the Lsp become significantly simpler once understanding the LspDocument class
        // is just an abstraction for the Lsp to keep track of files (seen below). 
        //
        const shebangRoot = parser.parse(doc.getText()).rootNode!;
        const allNodes = getChildNodes(shebangRoot);

        const comments = allNodes.filter((node) => NodeTypes.isComment(node))
        const shebangs = allNodes.filter((node) => NodeTypes.isShebang(node))

        assert.equal(shebangs.length, 1)
        const overlaps = comments.filter((node) => {
            if (shebangs.filter((shebang) => shebang.equals(node)).length >= 1) {
                return true;
            }
            return false;
        })
        assert.equal(overlaps.length, 0)
        })

    /**
     * If you are trying to be a maintainer for the fish-lsp, determining variable scoping,
     * through tree-sitter is something that likely needs more rigorous testing.
     */
    //it("more serious testing for scopes in fish", async () => {
        //const forVarScope = resolveLspDocumentForHelperTestFile(`fish_files/simple/for_var.fish`);
        //const functionVarScope = resolveLspDocumentForHelperTestFile(`fish_files/simple/function_variable_def.fish`);
        ////forVarScope
    //})

})