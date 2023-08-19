import Parser, { Tree, QueryMatch, Query, Language, SyntaxNode } from 'web-tree-sitter';
import { Position, Range, SymbolKind, URI } from 'vscode-languageserver'
import { assert } from 'chai';
import { homedir } from 'os';
import { createRange } from '../src/utils/translation';
import { printTestName, resolveLspDocumentForHelperTestFile } from "./helpers";
import { isCommandName, isFunctionDefinitionName } from '../src/utils/node-types';
import * as NodeTypes from '../src/utils/node-types'
import { GenericTree, TNode, filterTree } from '../src/utils/generic-tree'
import { firstAncestorMatch, getChildNodes, getRange, isPositionWithinRange, pointToPosition, positionToPoint } from '../src/utils/tree-sitter';
import { initializeParser } from "../src/parser";
import { Analyzer, findParentScopes, findDefs, findLocalDefinitionSymbol } from "../src/analyze";
import { LspDocument } from "../src/document";
import { findSymbolsForCompletion, FishDocumentSymbol,  filterLastPerScopeSymbol, getFishDocumentSymbols,  findSymbolReferences, findLastDefinition } from "../src/document-symbol";
import { ScopeTag, expandEntireVariableLine, getScope, getVariableScope } from '../src/utils/definition-scope';
 
let parser: Parser;
let lang: Language;
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
    if (parser) parser.reset();
}, 10000);

describe("scopes tests", () => {

    it('checking for last unique FishDocumentSymbol per scope', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/simple/inner_function.fish`);
        const root = parser.parse(doc.getText()).rootNode!;
        const symbols = getFishDocumentSymbols(doc.uri, root);

        const uniqueSymbols = filterLastPerScopeSymbol(symbols)
        const flatUniqueSymbols = new GenericTree<FishDocumentSymbol>(uniqueSymbols).toFlatArray()
        assert.equal(6, flatUniqueSymbols.length)
        assert.deepEqual([
            FishDocumentSymbol.createMock('outer',   'local',     createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('inner',   'local',     createRange( 1,  0,  8,  3)),
            FishDocumentSymbol.createMock('a',       'local',     createRange( 5,  8,  5, 27)),
            FishDocumentSymbol.createMock('a',       'function',  createRange( 7,  4,  7, 13)),
            FishDocumentSymbol.createMock('_helper', 'local',     createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('b',       'function',  createRange(11,  4, 11, 24)),
        ], flatUniqueSymbols.map((s) => FishDocumentSymbol.toMock(s)))
        //logMockSymbols(flatUniqueSymbols)
        //logClientTree(uniqueSymbols);
    })


    it('finding scope for completion', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/simple/inner_function.fish`);
        const root = parser.parse(doc.getText()).rootNode!;

        let [ cursor , symbols ] = [ Position.create(5, 34), getFishDocumentSymbols(doc.uri, root) ]
        let newSymbols = findSymbolsForCompletion(symbols, cursor)

        // should have 4 symbols (theres only 4 unique in the file)
        assert.equal(newSymbols.length, 4)
        //logMockSymbols(newSymbols)

        // if ranges are incorrect, the nearest symbol to the cursor was not found.
        assert.deepEqual([
            FishDocumentSymbol.createMock('_helper', 'local', createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('a',       'local', createRange( 5,  8,  5, 27)),
            FishDocumentSymbol.createMock('inner',   'local', createRange( 1,  0,  8,  3)),
            FishDocumentSymbol.createMock('outer',   'local', createRange( 0,  0, 12,  3))
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s))) 

        // testing if variable scope works correctly (`a` should be function scoped )
        cursor = Position.create(7, 15)
        newSymbols = findSymbolsForCompletion(symbols, cursor)

        assert.deepEqual([
            FishDocumentSymbol.createMock('_helper', 'local',    createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('a',       'function', createRange( 7,  4,  7, 13)),
            FishDocumentSymbol.createMock('inner',   'local',    createRange( 1,  0,  8,  3)),
            FishDocumentSymbol.createMock('outer',   'local',    createRange( 0,  0, 12,  3))
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s))) 

        cursor = Position.create(11, 1)
        newSymbols = findSymbolsForCompletion(symbols, cursor)
        assert.deepEqual([
            FishDocumentSymbol.createMock('_helper', 'local',    createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('outer',   'local',    createRange( 0,  0, 12,  3))
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s))) 

        cursor = Position.create(0, 1)
        newSymbols = findSymbolsForCompletion(symbols, cursor)
        assert.deepEqual([
            FishDocumentSymbol.createMock('_helper', 'local',    createRange( 0,  0, 12,  3)),
            FishDocumentSymbol.createMock('outer',   'local',    createRange( 0,  0, 12,  3))
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s))) 
    })

    it('find references for variables in scope', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/simple/global_vs_local.fish`);
        const root = parser.parse(doc.getText()).rootNode!;
        let symbols = getFishDocumentSymbols(doc.uri, root)

        function debug(symbols: FishDocumentSymbol[]) {
            const tree = new GenericTree<FishDocumentSymbol>(symbols)
            return {
                allSymbols: () => logDebbugingAllSymbols(tree.toFlatArray()),
                varSymbols: () => {
                    const result = tree
                        .filterToTree((node) => node.kind === SymbolKind.Variable)
                        .toFlatArray()
                    logDebbugingAllSymbols(result);
                },
            }
        }
        /////// LOCAL DEBUGGING
        //debug(symbols).allSymbols()
        //debug(symbols).varSymbols() 

        const flatSymbols = new GenericTree<FishDocumentSymbol>(symbols).toFlatArray()

        /////// GLOBAL VARIABLE SYMBOL
        const globalSymbol = flatSymbols[0]
        let newSymbols = findSymbolReferences(symbols, globalSymbol)
        assert.equal(3, newSymbols.length);
        assert.deepEqual([
            FishDocumentSymbol.createMock('testvar', 'global',  createRange( 1,  0,  1, 36)),
            FishDocumentSymbol.createMock('testvar', 'global',  createRange( 7,  4,  7, 46)),
            FishDocumentSymbol.createMock('testvar', 'inherit', createRange(13,  0, 13, 27)),
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s)))
        // logMockSymbols(newSymbols);

        /////// LOCAL VARIABLE SYMBOL 
        const localSymbol = flatSymbols[2]
        newSymbols = findSymbolReferences(symbols, localSymbol)
        assert.equal(1, newSymbols.length);
        assert.deepEqual([
            FishDocumentSymbol.createMock('testvar', 'local', createRange( 5,  4,  5, 38)),
        ], newSymbols.map((s) => FishDocumentSymbol.toMock(s)))        
        // logMockSymbols(newSymbols);
    })

    it('find last definition', async () => {
        const doc = resolveLspDocumentForHelperTestFile(`fish_files/simple/symbols.fish`);
        const root = parser.parse(doc.getText()).rootNode!;
        const symbols = getFishDocumentSymbols(doc.uri, root);

        const arg_one = root.descendantForPosition({row: 21, column: 16})!
        const arg_two = root.descendantForPosition({row: 26, column:  8})!
        const func_a = root.descendantForPosition({row: 21, column:  8})!
        const func_b = root.descendantForPosition({row: 26, column:  0})!
        const for_i = root.descendantForPosition({row: 5, column:  15})!

        let lastSymbol = findLastDefinition(symbols, arg_one)!
        assert.deepEqual(
            FishDocumentSymbol.createMock('arg_one', 'function', createRange(19, 0, 24, 3)),
            FishDocumentSymbol.toMock(lastSymbol)
        )
        lastSymbol = findLastDefinition(symbols, arg_two)!
        assert.deepEqual(
            FishDocumentSymbol.createMock('arg_two', 'local',  createRange(17, 0, 17, 33)),
            FishDocumentSymbol.toMock(lastSymbol)
        )
        lastSymbol = findLastDefinition(symbols, func_a)!
        assert.deepEqual(
            FishDocumentSymbol.createMock('func_a', 'local', createRange(0, 0, 26, 15)),
            FishDocumentSymbol.toMock(lastSymbol)
        )
        lastSymbol = findLastDefinition(symbols, func_b)!
        assert.deepEqual(
            FishDocumentSymbol.createMock('func_b', 'local', createRange(0, 0, 26, 15)),
            FishDocumentSymbol.toMock(lastSymbol)
        )
        lastSymbol = findLastDefinition(symbols, for_i)!
        assert.deepEqual(
            FishDocumentSymbol.createMock('i', 'function', createRange(4, 4, 6, 7)),
            FishDocumentSymbol.toMock(lastSymbol)
        )
        //logMockSymbols([lastSymbol])
    })
})

function logClientTree(symbols: FishDocumentSymbol[], level = 0) {
    for (const symbol of symbols) {
        console.log("  ".repeat(level) + `${FishDocumentSymbol.logString(symbol)}`);
        logClientTree(symbol.children || [], level + 1);
    }
}

function logMockSymbols(symbols: FishDocumentSymbol[]) {
    symbols.forEach((s) => {
        console.log(FishDocumentSymbol.toMock(s));
    })
}

function logDebbugingAllSymbols(symbols: FishDocumentSymbol[]) {
    const tree = new GenericTree<FishDocumentSymbol>(symbols);
    tree.toFlatArray().forEach((s, index) => {
        console.log(index, FishDocumentSymbol.debug(s));
    })
}

//const input = [
//    'function func_foo -a func_foo_arg',
//    '    begin',
//    '         echo "hi" | read --local read_foo_1',
//    '         echo "hi" | read -l read_foo_2',
//    '    end',
//    '    echo $func_foo_arg',
//    'end',
//    'set -gx OS_NAME (get-os-name) # check for mac or linux',
//].join('\n');
//const root = parser.parse(input).rootNode!;