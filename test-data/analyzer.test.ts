import { setLogger, createFakeLspDocument } from './helpers';
import { initializeParser } from '../src/parser';
/* @ts-ignore */
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from '../src/analyze';
import { containsNode, getChildNodes, getRange } from '../src/utils/tree-sitter';
import { isFunctionDefinitionName } from '../src/utils/node-types';
import * as LSP from 'vscode-languageserver';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
/* @ts-ignore */
import os from 'os';
import { join } from 'path';
import { pathToUri } from '../src/utils/translation';
import { flattenNested } from '../src/utils/flatten';
import { createSourceResources, reachableSources, symbolsFromResource } from '../src/parsing/source';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { filterLastPerScopeSymbol, FishSymbol } from '../src/parsing/symbol';

let parser: Parser;
let analyzer: Analyzer;
const tmpDir = join(os.tmpdir(), 'fish-lsp-analyzer-tests');

describe('Analyzer class in file: `src/analyze.ts`', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
    await setupProcessEnvExecFile();
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
      const result = analyzer.getTree(document.uri);
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
      const result = analyzer.getRootNode(document.uri);
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

  describe('analyzePath()', () => {
    let testFilePath: string;

    // Before all tests run
    beforeAll(async () => {
      // Make sure temp directory exists
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true });
      }

      // Initialize parser for analyzer
      parser = await initializeParser();
      analyzer = new Analyzer(parser);
      await setupProcessEnvExecFile();
    });

    // After all tests run
    afterAll(() => {
      // Clean up the temp directory and all its contents
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    // Before each test
    beforeEach(() => {
      // Ensure test directory exists
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true });
      }
    });

    // After each test
    afterEach(() => {
      // Clean up test file after each test
      if (existsSync(testFilePath)) {
        rmSync(testFilePath, { force: true });
      }
    });

    it('simple', async () => {
      testFilePath = join(tmpDir, 'foo.fish');
      const content = [
        'function foo',
        'end',
      ].join('\n');
      writeFileSync(testFilePath, content);
      const result = analyzer.analyzePath(testFilePath);
      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
    });

    it('multiple functions', async () => {
      testFilePath = join(tmpDir, 'baz.fish');
      const content = [
        'function foo',
        'end',
        'function bar',
        'end',
        'function baz',
        '    foo',
        '    bar',
        'end',
      ].join('\n');
      writeFileSync(testFilePath, content);
      const result = analyzer.analyzePath(testFilePath);
      expect(result).toBeDefined();
      expect(result).toHaveLength(4);
      const lookupUri = pathToUri(testFilePath);
      const document = analyzer.getDocument(lookupUri);
      expect(document).toBeDefined();
      expect(document?.uri).toEqual(lookupUri);
      const flatSymbols = analyzer.getFlatDocumentSymbols(lookupUri);
      expect(flatSymbols).toBeDefined();
      expect(flatSymbols).toHaveLength(7);
      expect(flatSymbols.map(s => s.name)).toEqual(['argv', 'foo', 'bar', 'baz', 'argv', 'argv', 'argv']);
    });

    it('source command', async () => {
      testFilePath = join(tmpDir, 'foo.fish');
      const content = [
        'source $__fish_data_dir/config.fish',
        'function foo',
        '    echo \'inside foo\'',
        'end',
        'function bar',
        '    source $__fish_data_dir/functions/fish_add_path.fish',
        'end',
      ].join('\n');
      writeFileSync(testFilePath, content);
      const result = analyzer.analyzePath(testFilePath);
      expect(result).toBeDefined();
      // expect(result).toHaveLength(2);
      const document = analyzer.getDocumentFromPath(testFilePath);
      if (!document) fail();
      const allSources = analyzer.collectAllSources(document.uri);
      // for (const sourceUri of Array.from(sources)) {
      //   const sourceDocument = analyzer.getDocument(sourceUri);
      //   console.log({sourceUri})
      //   expect(sourceDocument).toBeDefined();
      // }
      expect(allSources.size).toBe(3);
      const { sourceNodes } = result;
      const addPathNode = sourceNodes.at(-1)!;
      const sourceBeforeAddPathNode = analyzer.collectReachableSources(document.uri, getRange(addPathNode).start);
      const sourceAfterAddPathNode = analyzer.collectReachableSources(document.uri, getRange(addPathNode).end);
      expect(sourceBeforeAddPathNode.size).toBe(2);
      expect(sourceAfterAddPathNode.size).toBe(3);
    });
  });

  // TODO: test more Analyzer methods
});
