import { setLogger, createFakeLspDocument, rangeAsString } from './helpers';
import { initializeParser } from '../src/parser';
/* @ts-ignore */
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { getChildNodes, getRange } from '../src/utils/tree-sitter';
import { isConcatenation, isFunctionDefinitionName } from '../src/utils/node-types';
import * as LSP from 'vscode-languageserver';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
/* @ts-ignore */
import os from 'os';
import { join } from 'path';
import { pathToUri } from '../src/utils/translation';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { workspaceManager } from '../src/utils/workspace-manager';
import { logger } from '../src/logger';
import { getNestedCommandReferenceAtPoint } from '../src/utils/nested-command-point';
import { extractCommands } from '../src/parsing/nested-strings';

let parser: Parser;
const tmpDir = join(os.tmpdir(), 'fish-lsp-analyzer-tests');

describe('Analyzer class in file: `src/analyze.ts`', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    await Analyzer.initialize();
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
      expect(result.documentSymbols).toHaveLength(1);
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
      expect(result.documentSymbols).toHaveLength(2);
    });

    it('function with args', () => {
      const document = createFakeLspDocument('functions/foo.fish', [
        'function foo -a arg1 -a arg2',
        '  return 1',
        'end',
      ].join('\n'));
      const result = analyzer.analyze(document);
      expect(result).toBeDefined();
      expect(result.documentSymbols).toHaveLength(1);
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
      expect(result?.documentSymbols).toHaveLength(2);
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
      expect(result?.documentSymbols).toHaveLength(4);
      const lookupUri = pathToUri(testFilePath);
      const document = analyzer.getDocument(lookupUri);
      expect(document).toBeDefined();
      expect(document?.uri).toEqual(lookupUri);
      const flatSymbols = analyzer.getFlatDocumentSymbols(lookupUri);
      expect(flatSymbols).toBeDefined();
      expect(flatSymbols).toHaveLength(7);
      expect(flatSymbols.map(s => s.name)).toEqual(['argv', 'foo', 'bar', 'baz', 'argv', 'argv', 'argv']);
    });
  });

  describe('workspace-scoped definition resolution', () => {
    it('should not resolve definitions from current workspace when document is in another workspace', () => {
      workspaceManager.clear();

      const uniqueCommand = '__fish_lsp_workspace_scope_test_cmd_91731';
      const docA = createFakeLspDocument('/tmp/fish-lsp-ws-a/functions/ws_a.fish', [
        `function ${uniqueCommand}`,
        'end',
      ].join('\n'));
      const docB = createFakeLspDocument('/tmp/fish-lsp-ws-b/ws_b.fish', [
        uniqueCommand,
      ].join('\n'));

      analyzer.analyze(docA);
      analyzer.analyze(docB);
      workspaceManager.handleUpdateDocument(docA);
      workspaceManager.handleUpdateDocument(docB);

      const wsA = workspaceManager.findContainingWorkspace(docA.uri)!;
      const wsB = workspaceManager.findContainingWorkspace(docB.uri)!;
      expect(wsA.uri).not.toEqual(wsB.uri);

      // Simulate an unrelated active workspace selection.
      workspaceManager.setCurrent(wsA);

      const definition = analyzer.getDefinition(docB, LSP.Position.create(0, 1));
      expect(definition).toBeNull();
    });
  });

  describe('nested command references', () => {
    it('resolves definition and hover from inside an alias value', () => {
      const document = createFakeLspDocument('conf.d/alias-hover.fish', [
        'function bar',
        'end',
        '',
        "alias bb 'bar'",
        'alias b_="bar -s"',
      ].join('\n'));

      analyzer.analyze(document);

      const aliasDefinition = analyzer.getDefinition(document, LSP.Position.create(3, 11));
      expect(aliasDefinition?.name).toBe('bar');
      expect(aliasDefinition?.fishKind).toBe('FUNCTION');

      const wrappedAliasDefinition = analyzer.getDefinition(document, LSP.Position.create(4, 11));
      expect(wrappedAliasDefinition?.name).toBe('bar');
      expect(wrappedAliasDefinition?.fishKind).toBe('FUNCTION');

      const hover = analyzer.getHover(document, LSP.Position.create(4, 11));
      expect(JSON.stringify(hover?.contents)).toContain('bar');
    });

    it('keeps alias-name hover on the alias definition for equals syntax', () => {
      logger.logTime();
      logger.allowDefaultConsole();
      logger.setSilent(false);
      const document = createFakeLspDocument('conf.d/alias-hover-name.fish',
        'alias b_="bar -s"',
      );

      const { flatSymbols } = analyzer.analyze(document).ensureParsed();
      // workspaceManager.handleOpenDocument(document);
      console.log({
        flatSymbols: flatSymbols.map(s => ({
          name: s.name,
          kind: s.fishKind,
          range: rangeAsString(s.range),
          selectionRange: rangeAsString(s.selectionRange),
        })),
      });

      const ndoe = analyzer.nodeAtPoint(document.uri, 0, 7);
      const word = analyzer.wordAtPoint(document.uri, 0, 7);
      for (const node of getChildNodes(analyzer.getRootNode(document.uri)!)) {
        console.log({
          text: node.text,
          type: node.type,
          range: rangeAsString(getRange(node)),
        });
      }
      console.log({
        node: ndoe ? { text: ndoe.text, type: ndoe.type, range: rangeAsString(getRange(ndoe)) } : null,
        word,
      });

      const definition = analyzer.getDefinition(document, LSP.Position.create(0, 7))!;
      // expect(definition?.name).toBe('b_');
      // expect(definition?.fishKind).toBe('ALIAS');
      //
      // const hover = analyzer.getHover(document, LSP.Position.create(0, 7));
      // expect(JSON.stringify(hover?.contents)).toContain('alias');
      // expect(JSON.stringify(hover?.contents)).toContain('b_');
    });

    it('does not resolve plain string contents that are not real references', () => {
      const document = createFakeLspDocument('conf.d/non-reference-string.fish', [
        'function bar',
        'end',
        '',
        "echo 'bar'",
      ].join('\n'));

      analyzer.analyze(document);

      const definition = analyzer.getDefinition(document, LSP.Position.create(3, 7));
      expect(definition).toBeNull();

      const hover = analyzer.getHover(document, LSP.Position.create(3, 7));
      expect(hover).toBeNull();
    });

    it('resolves definition and hover inside complete -n conditions', () => {
      const document = createFakeLspDocument('conf.d/complete-condition-hover.fish', [
        'function __fish_use_subcommand',
        'end',
        '',
        'complete -c foo -n \'__fish_use_subcommand\' -f',
      ].join('\n'));

      analyzer.analyze(document);

      const definition = analyzer.getDefinition(document, LSP.Position.create(3, 22));
      expect(definition?.name).toBe('__fish_use_subcommand');
      expect(definition?.fishKind).toBe('FUNCTION');

      const hover = analyzer.getHover(document, LSP.Position.create(3, 22));
      expect(JSON.stringify(hover?.contents)).toContain('__fish_use_subcommand');
    });

    it('extracts nested helper names from complete -a command substitutions', () => {
      const document = createFakeLspDocument('conf.d/complete-arguments-hover.fish', [
        'complete -c nvim -a \'(__fish_use_subcommand)\'',
      ].join('\n'));

      analyzer.analyze(document);

      expect(analyzer.wordAtPoint(document.uri, 0, 24)).toBe('__fish_use_subcommand');
    });

    it.skip('resolves correct word for each command in a piped command substitution', () => {
      // Regression: wordAtPoint returned the first command in the pipe (_fish_alt_greeting)
      // regardless of cursor position, because getParenthesizedCarrierCommand was called
      // before the position-aware extractCommandLocations lookup.
      //   set -x a (_fish_alt_greeting | no_color)
      //            ^col10              ^col31
      const document = createFakeLspDocument('conf.d/piped-substitution.fish', [
        'set -x a (_fish_alt_greeting | no_color)',
        //                              ^^^^^^^^ cursor here should resolve correct word
      ].join('\n'));

      analyzer.analyze(document);

      expect(analyzer.wordAtPoint(document.uri, 0, 31)).toBe('no_color');
      expect(analyzer.wordAtPoint(document.uri, 0, 10)).toBe('_fish_alt_greeting');
    });

    it('resolves correct word for each arg/flag', () => {
      const document = createFakeLspDocument('conf.d/piped-substitution.fish',
        'set -x a (path resolve $PWD/ | string split -r \'/\')',
        //                                     ^^^^  ^^ ^^^ search locations
      );

      const { root } = analyzer.analyze(document);
      // const searchTexts = [`split`, '-r', "'/'"]
      // for (const node of getChildNodes(root!)) {
      //   if (searchTexts.includes(node.text)) {
      //     console.log({
      //       text: node.text,
      //       type: node.type,
      //       range: rangeAsString(getRange(node)),
      //       location: node.startPosition,
      //     })
      //   }
      // }

      const positions : {
        row: number;
        column: number;
        expected: string;
      }[] = [
        { row: 0, column: 38, expected: 'split' },
        { row: 0, column: 44, expected: '-r' },
        { row: 0, column: 47, expected: "'/'" },
        { row: 0, column: 48, expected: "'/'" },
      ];

      logger.setSilent(false);
      for (const { row, column, expected } of positions) {
        const word = analyzer.wordAtPoint(document.uri, row, column);
        const node = analyzer.nodeAtPoint(document.uri, row, column);
        // console.log(`-`.repeat(50))
        // console.log(`At position (${row}, ${column}):`);
        // console.log(`  Expected: "${expected}"`);
        // console.log(`  wordAtPoint: "${word}"`);
        // console.log(`  nodeAtPoint: "${node?.text}" (type: ${node?.type})`);
        // console.log(`-`.repeat(50))
      }
      expect(analyzer.wordAtPoint(document.uri, 0, 38)).toBe('split');
      expect(analyzer.wordAtPoint(document.uri, 0, 44)).toBe('-r');
      expect(analyzer.wordAtPoint(document.uri, 0, 47)).toBe("'");

      expect(analyzer.nodeAtPoint(document.uri, 0, 38)!.text).toBe('split');
      expect(analyzer.nodeAtPoint(document.uri, 0, 44)!.text).toBe('-r');
      expect(analyzer.nodeAtPoint(document.uri, 0, 47)!.text).toBe("'");
      expect(analyzer.nodeAtPoint(document.uri, 0, 48)!.text).toBe("'/'");
      logger.setSilent();
    });
  });

  it('nested command nodeAtPoint', () => {
    const document = createFakeLspDocument('conf.d/node-at-point.fish',
      'set -x a (path resolve $PWD/ | string split -r "/")',
      'export PATH="$(path resolve /):/usr/local/bin:$PATH"',
      'alias foo=bar',
    );
    const { root } = analyzer.analyze(document);
    logger.setSilent(false);
    const positions = [
      {
        row: 1,
        column: 12,
        expected: 'path',
      },
      {
        row: 1,
        column: 38,
        expected: '"$(path resolve /):/usr/local/bin:$PATH"',
      },
      {
        row: 2,
        column: 11,
        expected: 'bar',
      },
    ];

    for (const { row, column, expected } of positions) {
      const node = analyzer.nodeAtPoint(document.uri, row, column)!;
      const command = analyzer.commandAtPoint(document.uri, row, column)!;
      const commandName = analyzer.commandNameAtPoint(document.uri, row, column);
      const subcommand = getChildNodes(node).find(n => n.type === 'command_substitution' || isConcatenation(n))!;
      // console.log(getChildNodes(node).map(n => ({text: n.text, type: n.type})));
      console.log({
        node: {
          text: node.text,
          type: node.type,
          range: rangeAsString(getRange(node)),
        },
        commandName,
        word: analyzer.wordAtPoint(document.uri, row, column),
        childNodes: getChildNodes(node).map(n => ({ text: n.text, type: n.type })),
        nestedCommandReference: extractCommands(node, {
          parseParenthesized: true,
          cleanKeywords: true,
          parseCommandSubstitutions: true,
        }),
        nestedCommandReferenceByCommand: getNestedCommandReferenceAtPoint(document.uri, { line: row, character: column }, command),
      });
      console.log(`At position (${row}, ${column}):`);
      console.log(`  Expected node text: "${expected}"`);
      console.log(`  wordAtPoint: "${analyzer.wordAtPoint(document.uri, row, column)}"`);
      console.log(`  nodeAtPoint text: "${node?.text}" (type: ${node?.type})`);
      console.log(`  commandNameAtPoint: "${commandName}"`);
      console.log(`  nestedCommandReferenceAtPoint: ${JSON.stringify(getNestedCommandReferenceAtPoint(document.uri, { line: row, character: column }, node))}`);
      // expect(node?.text).toBe(expected);
    }
  });
  // TODO: test more Analyzer methods
});
