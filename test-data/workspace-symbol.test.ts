import {resolveLspDocumentForHelperTestFile} from './helpers';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem, CompletionParams, DocumentSymbol, MarkupContent, MarkupKind, Position, Range, SymbolKind, TextDocumentIdentifier} from 'vscode-languageserver';
import { BUILT_INS, createCompletionList, generateShellCompletionItems, getShellCompletions, workspaceSymbolToCompletionItem } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {resolve} from 'dns';
import {LspDocument} from '../src/document';
import { containsRange, createSymbol, getDefinitionSymbols, getNearbySymbols, getNodeFromRange} from '../src/workspace-symbol';
import {getChildNodes, getNodeAtRange, getRange, getRangeWithPrecedingComments} from '../src/utils/tree-sitter';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';
import { isFunctionDefinition, isFunctionDefinitionName, isDefinition, isVariableDefinition } from '../src/utils/node-types';
import { collectAllSymbolInformation, CommentRange } from '../src/symbols';
import { DocumentationCache, initializeDocumentationCache } from '../src/utils/documentationCache';

let parser: Parser;
let documentationCache: DocumentationCache;
let analyzer: Analyzer;
let symbols: DocumentSymbol[] = [];
let loggedAmount: number = 0;

const jestConsole = console;

beforeEach(async () => {
    global.console = require('console');
    parser = await  initializeParser();
    documentationCache = await initializeDocumentationCache();
    analyzer = new Analyzer(parser, documentationCache);
    symbols = [];
});

afterEach(() => {
    global.console = jestConsole;
    parser.delete()
});

function pushCommentRanges(doc: LspDocument) {
    const root: SyntaxNode = parser.parse(doc.getText()).rootNode
    const nodes = getChildNodes(root).filter(node => isDefinition(node));
    const commentRanges: CommentRange.WithPrecedingComments[] = [];
    nodes.forEach(node => {
        commentRanges.push(CommentRange.create(node))
    })
    return commentRanges;
}

/**
 * Workspace Symbols are coupled to essentially every feature that the language server
 * provides. The tests in this file, attempt to verify that the workspace symbols are
 * being generated correctly.
 */
describe('workspace-symbols tests', () => {

    it('simple function symbols', async () => {
        const doc = resolveLspDocumentForHelperTestFile('./fish_files/simple/simple_function.fish');
        const commentRanges = pushCommentRanges(doc)
        expect(commentRanges.length).toBe(1);
    })

    it('simple variable symbols', async () => {
        const doc = resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish');
        const commentRanges = pushCommentRanges(doc)
        expect(commentRanges.length).toBe(1);
    })

    it('simple for variable symbols', async () => {
        const doc = resolveLspDocumentForHelperTestFile('./fish_files/simple/for_var.fish');
        const commentRanges = pushCommentRanges(doc)
        expect(commentRanges.length).toBe(1);
    })

    it('function with variable symbols', async () => {
        const doc = resolveLspDocumentForHelperTestFile('./fish_files/simple/function_variable_def.fish');
        //const commentRanges = pushCommentRanges(doc)
        analyzer.analyze(doc)
        const toFind = analyzer.getNodes(doc).filter(n => n.text === 'simple_function');
        const symbols = collectAllSymbolInformation(doc.uri, parser.parse(doc.getText()).rootNode)
        symbols.forEach((symbol) => {
            console.log(JSON.stringify({symbol: symbol}, null, 2))
        })
        //const result = await analyzer.getDefinition(doc, toFind[0])
        //result.forEach(n => {
            //console.log(n);
            //console.log();
        //})
        //console.log(toFind[0]?.text);
        //expect(commentRanges.length).toBe(3);
    })   
})



