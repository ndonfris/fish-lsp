import { BaseSymbolInformation, DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import Parser, { Tree, QueryMatch, Query, Language, SyntaxNode } from 'web-tree-sitter';
import { assert } from 'chai';
import { homedir } from 'os';
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import { isCommandName, isFunctionDefinitionName } from '../src/utils/node-types';
import * as NodeTypes from '../src/utils/node-types'
import { firstAncestorMatch, getChildNodes, pointToPosition, positionToPoint } from '../src/utils/tree-sitter';
import { initializeParser } from "../src/parser";
import { Analyzer, findParentScopes, findDefs, findLocalDefinitionSymbol } from "../src/analyze";
import { LspDocument } from "../src/document";
import { FishDocumentSymbol, getFishDocumentSymbols } from "../src/document-symbol";
import { expandEntireVariableLine, getScope, getVariableScope } from '../src/utils/definition-scope';
 
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

function parseStringForNodeType(str: string, predicate: (n:SyntaxNode) => boolean) {
    const tree = parser.parse(str);
    const root = tree.rootNode;
    return getChildNodes(root).filter(predicate);
}

describe("scopes tests", () => {

    it("finding all scope nodes in a document", async () => {
        const { allNodes } = testHelper(`fish_files/advanced/variable_scope_2.fish`);
        const scopes = allNodes.filter((node) => NodeTypes.isScope(node))

        scopes.forEach((scope, index) => {
            console.log(index, scope.text.split('\n')[0]);
        })

    })

    it('finding scope', async () => {
        const input = [
            'function func_foo -a func_foo_arg',
            '    begin',
            '         echo "hi" | read --local read_foo_1',
            '         echo "hi" | read -l read_foo_2',
            '    end',
            '    echo $func_foo_arg',
            'end',
            'set -gx OS_NAME (get-os-name) # check for mac or linux',
        ].join('\n');
        const variableDefinitions = parseStringForNodeType(input, NodeTypes.isVariableDefinition);
        for (const v of variableDefinitions) {
            const {scopeNode, scopeTag} = getVariableScope(v)
            console.log(v.text);
            console.log(scopeNode?.text)
            console.log();
            console.log();
            console.log();
        }
    })
    it('checking scope for FishDocumentSymbol', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/advanced/inner_functions.fish`);
        const root = parser.parse(doc.getText()).rootNode!;
        const symbolArray = getFishDocumentSymbols(doc.uri, root);
        const flatSymbolArray = [...FishDocumentSymbol.flattenArray(symbolArray)]


        logClientTree(symbolArray)
        console.log('-'.repeat(40));
        flatSymbolArray.forEach((def, index) => console.log(index, FishDocumentSymbol.logString(def)))


        filterLastPerScopeSymbols(root, symbolArray)
    })

})

function logClientTree(symbols: FishDocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        console.log("      ".repeat(level) + `${FishDocumentSymbol.logString(symbol)}`);
        logClientTree(symbol.children || [], level + 1);
    }
}

const getNodeStr = (node: SyntaxNode | null) => {
    if (!node) return 'got NULL'
    const {startPosition, endPosition} = node;
    return [
        `(${startPosition.row}:${startPosition.column},${endPosition.row}:${endPosition.column})`,
        node.text,
    ].join("\n");
}

function filterLastPerScopeSymbols(root: SyntaxNode,symbols: FishDocumentSymbol[]) {
    const flatSymbols = [...FishDocumentSymbol.flattenArray(symbols)]
    for (const symbol of flatSymbols) {
        const matchingNames = flatSymbols.filter((s) =>
             s.name === symbol.name && !FishDocumentSymbol.equal(symbol, s));
        const matchingScopes = matchingNames.filter((s) =>
            FishDocumentSymbol.equalScopes(symbol, s));
        // pop() will give you the last seen match?
        //    ~or~
        // write a function which will check the last seen match using: FishDocumentSymbol.isAfter()
        //
        // actually I think easiest method is to remove `symbol` if we find a match.
        const symbolNode = FishDocumentSymbol.getSyntaxNode(root, symbol)
        matchingScopes.forEach((s) => {
            const matchNode = FishDocumentSymbol.getSyntaxNode(root, s)
            console.log([ getNodeStr(symbolNode!) , '===', getNodeStr(matchNode)].join('\n'))
            console.log('-'.repeat(40))
        })
    }
}

