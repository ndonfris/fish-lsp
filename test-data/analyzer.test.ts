import { setLogger, createFakeLspDocument } from './helpers';
import { initializeParser } from '../src/parser';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from '../src/analyze';
import { getChildNodes } from '../src/utils/tree-sitter';
import { isFunctionDefinitionName } from '../src/utils/node-types';
import * as LSP from 'vscode-languageserver';

let parser: Parser;
let analyzer: Analyzer;

describe('Analyzer class in file: `src/analyze.ts`', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  describe('analyze', () => {
    it('default', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
      ].join('\n'));
      const result = analyzer.analyze(document);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
    });

    it('multiple functions', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
        'function bar',
        '  return 2',
        'end',
      ].join('\n'));
      const result = analyzer.analyze(document);
      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });

    it('function with args', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo -a arg1 -a arg2',
        '  return 1',
        'end',
      ].join('\n'));
      const result = analyzer.analyze(document);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
    });
  });

  describe('findDocumentSymbol()', () => {
    it('function name', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const { rootNode } = parser.parse(document.getText());
      const child: SyntaxNode = getChildNodes(rootNode).find(n => isFunctionDefinitionName(n))!;
      const position: LSP.Position = document.positionAt(child.startIndex);
      const result = analyzer.findDocumentSymbol(document, position);
      expect(result).toBeDefined();
      expect(result?.name).toEqual('foo');
      expect(result?.kind).toEqual(LSP.SymbolKind.Function);
    });
  });

  describe('findDocumentSymbols()', () => {
    it('function name', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
        'function bar',
        '  return 2',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const { rootNode } = parser.parse(document.getText());
      const child: SyntaxNode = getChildNodes(rootNode).find(n => isFunctionDefinitionName(n))!;
      const position: LSP.Position = document.positionAt(child.startIndex);
      const result = analyzer.findDocumentSymbol(document, position);
      expect(result).toBeDefined();
      expect(result?.name).toEqual('foo');
      expect(result?.kind).toEqual(LSP.SymbolKind.Function);
    });
  });

  describe('getTree', () => {
    it('function name', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const matchTree = parser.parse(document.getText());
      const result = analyzer.getTree(document);
      expect(result).toBeDefined();
      expect(result!.rootNode.text).toEqual(matchTree.rootNode.text);
    });
  });

  describe('getRootNode', () => {
    it('function name', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        '  return 1',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const output = parser.parse(document.getText()).rootNode;
      const result = analyzer.getRootNode(document);
      expect(result).toBeDefined();
      expect(result!.text).toEqual(output.text);
    });
  });

  describe('getDocument', () => {
    it('simple', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const result = analyzer.getDocument(document.uri);
      expect(result).toBeDefined();
      expect(result).toEqual(document);
    });
  });

  describe('getFlatDocumentSymbols', () => {
    it('simple', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const result = analyzer.getFlatDocumentSymbols(document.uri);
      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });

    it('multiple functions', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo',
        'end',
        'function bar',
        'end',
      ].join('\n'));
      analyzer.analyze(document);
      const result = analyzer.getFlatDocumentSymbols(document.uri);
      expect(result).toBeDefined();
      expect(result).toHaveLength(4);
    });

    it('completion', () => {
      const document = createFakeLspDocument('completions/foo.fish', [
        'function __foo_helper',
        'end',
        'complete -c foo -f',
        'complete -c foo -s h -l help -d "Display help message"',
        'complete -c foo -s v -l version -d "Display version information"',
      ].join('\n'));
      analyzer.analyze(document);
      const result = analyzer.getFlatDocumentSymbols(document.uri);
      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });

    it('config', () => {
      const document = createFakeLspDocument('config.fish', [
        'set -g foo bar',
        'set -g bar foo',
      ].join('\n'));
      analyzer.analyze(document);
      const result = analyzer.getFlatDocumentSymbols(document.uri);
      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });
  });

  // TODO: test more Analyzer methods
});
