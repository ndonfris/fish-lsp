import * as fs from 'fs';
import { AnalyzedDocument, analyzer, Analyzer, EnsuredAnalyzeDocument } from '../src/analyze';
import { workspaceManager } from '../src/utils/workspace-manager';
import { fail, printClientTree, printLocations, setLogger, TestLspDocument } from './helpers';
import { getChildNodes, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { isCompletionCommandDefinition } from '../src/parsing/complete';
import { isArgumentThatCanContainCommandCalls, isCommand, isCommandWithName, isDefinitionName, isEndStdinCharacter, isOption, isString, isVariable, isVariableDefinitionName } from '../src/utils/node-types';
import { getArgparseDefinitionName, isCompletionArgparseFlagWithCommandName } from '../src/parsing/argparse';
import { getRenames } from '../src/renames';
import { allUnusedLocalReferences, getReferences, getImplementation } from '../src/references';
import { Position, Location } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { documents, LspDocument } from '../src/document';
import * as path from 'path';
import { Workspace } from '../src/utils/workspace';
import { pathToUri } from '../src/utils/translation';
import { filterFirstPerScopeSymbol } from '../src/parsing/symbol';
import { isMatchingOptionValue } from '../src/parsing/options';
import { Option } from '../src/parsing/options';
import { extractCommands, extractMatchingCommandLocations } from '../src/parsing/nested-strings';
import { testChangeDocument, testClearDocuments, testOpenDocument } from './document-test-helpers';

// let currentWorkspace: CurrentWorkspace = new CurrentWorkspace();
// let documents: LspDocument[] = [];

/**
 * @param workspacePath `path.join('__dirname', 'workspaces', 'test_workspace_NAME')`
 * @param docs array of `TestLspDocument` objects to create in the workspace
 */
const setupWorkspace = (workspacePath: string, ...docs: TestLspDocument[]) => {
  if (!workspacePath.includes('/')) {
    workspacePath = path.join(__dirname, 'workspaces', workspacePath);
  }

  const ws = Workspace.syncCreateFromUri(pathToUri(workspacePath))!;

  function setup() {
    return {
      rootPath: workspacePath,
      rootUri: pathToUri(workspacePath),
      beforeAll: async () => {
        testClearDocuments();
        await Analyzer.initialize();
        fs.promises.mkdir(workspacePath, { recursive: true });
        const folders = ['functions', 'completions', 'conf.d'];
        for (const folder of folders) {
          const folderPath = path.join(workspacePath, folder);
          await fs.promises.mkdir(folderPath, { recursive: true });
        }
        for (const doc of docs) {
          const fullPath = path.join(workspacePath, doc.path);
          await fs.promises.writeFile(fullPath, Array.isArray(doc.text) ? doc.text.join('\n') : doc.text);
          testOpenDocument(LspDocument.createFromPath(fullPath));
        }
      },
      beforeEach: async () => {
        await Analyzer.initialize();
        workspaceManager.clear();
        workspaceManager.setCurrent(ws);
        documents.all().forEach(doc => {
          workspaceManager.handleOpenDocument(doc);
          analyzer.analyze(doc);
          workspaceManager.current?.addUri(doc.uri);
        });
        await workspaceManager.analyzePendingDocuments();
      },
      afterAll: async () => {
        await fs.promises.rm(workspacePath, { recursive: true });
      },
      documents: () => {
        return documents;
      },
    };
  }

  const setupObject = setup();

  return {
    ...setupObject,
    setup: (
      beforeEachCallback: () => Promise<void> = async () => {
        return;
      },
      beforeAllCallback: () => Promise<void> = async () => {
        return;
      },
      afterAllCallback: () => Promise<void> = async () => {
        return;
      },
    ) => {
      beforeAll(async () => {
        await setupObject.beforeAll();
        await beforeAllCallback();
      }),
      beforeEach(async () => {
        await setupObject.beforeEach();
        setupObject.documents().all().forEach(doc => {
          testOpenDocument(doc);
        });
        await beforeEachCallback();
      });
      afterAll(async () => {
        await setupObject.afterAll();
        await afterAllCallback();
      });
    },
  };
};

describe('find definition locations of symbols', () => {
  setLogger();
  // logger.setSilent(true);

  beforeEach(async () => {
    await Analyzer.initialize();
  });

  afterEach(() => {
    // parser.delete();
    workspaceManager.clear();
  });

  describe('argparse', () => {
    let functionDoc: LspDocument;
    let completionDoc: LspDocument;
    let confdDoc: LspDocument;

    setupWorkspace('test_argparse_workspace',
      {
        path: 'functions/test.fish',
        text: [
          'function test',
          '  argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
          '  or return',
          '  if set -lq _flag_help',
          '      echo "help_msg"',
          '  end',
          '  if set -lq _flag_name && test -n "$_flag_name"',
          '      echo "$_flag_name"',
          '  end',
          '  if set -lq _flag_quiet',
          '      echo "quiet"',
          '  end',
          '  if set -lq _flag_version',
          '      echo "1.0.0"',
          '  end',
          '  if set -lq _flag_yes',
          '      echo "yes"',
          '  end',
          '  if set -lq _flag_no',
          '      echo "no"',
          '  end',
          '  echo $argv',
          'end',
        ],
      },
      {
        path: 'completions/test.fish',
        text: [
          'complete -c test -s h -l help',
          'complete -c test      -l name',
          'complete -c test -s q -l quiet',
          'complete -c test -s v -l version',
          'complete -c test -s y -l yes',
          'complete -c test -s n -l no',
        ],
      },
      {
        path: 'conf.d/test.fish',
        text: [
          'function __test',
          '   test --yes',
          'end',
        ],
      },
    ).setup(async () => {
      functionDoc = documents.all().find(doc => doc.uri.endsWith('functions/test.fish'))!;
      completionDoc = documents.all().find(doc => doc.uri.endsWith('completions/test.fish'))!;
      confdDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/test.fish'))!;
    });

    it('`{functions,completions,conf.d}/test.fish`', () => {
      expect(documents.all()).toHaveLength(3);
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();
      expect(confdDoc).toBeDefined();
      const nodeAtPoint = analyzer.nodeAtPoint(confdDoc.uri, 1, 10);
      if (nodeAtPoint && isOption(nodeAtPoint)) {
        const result = getReferences(confdDoc, getRange(nodeAtPoint).start);
        expect(result).toHaveLength(4);
      }
    });

    it('test _flag_help', () => {
      const found = analyzer.findNode((n, document) => {
        return document!.uri === functionDoc.uri && n.text === '_flag_help';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(functionDoc, getRange(found).start);
      expect(result).toHaveLength(3);
    });

    it('test _flag_version', () => {
      const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 52)!;
      expect(nodeAtPoint!.text).toBe('v/version');
      const refs = getReferences(functionDoc, Position.create(1, 52));
      expect(refs).toHaveLength(3);
    });

    it('complete -c test -s h -l help', () => {
      const nodeAtPoint = analyzer.nodeAtPoint(completionDoc.uri, 0, 27)!;
      expect(nodeAtPoint).toBeDefined();
      expect(nodeAtPoint!.text).toBe('help');
      if (nodeAtPoint.parent && isCompletionCommandDefinition(nodeAtPoint.parent)) {
        const def = analyzer.findSymbol((s, document) => {
          return functionDoc.uri === document!.uri && s.name === getArgparseDefinitionName(nodeAtPoint);
        })!;
        expect(def).toBeDefined();
      }
      const refs = getReferences(completionDoc, Position.create(0, 27));
      expect(refs).toHaveLength(3);
    });
  });

  describe('set', () => {
    let functionDoc: LspDocument;
    let confdDoc: LspDocument;
    let globalTestDoc: LspDocument;

    setupWorkspace('references_test_set_workspace',
      {
        path: 'conf.d/_foo.fish',
        text: [
          'function test',
          '  set -lx foo bar',
          '  echo $foo',
          'end',
          'test',
        ],
      },
      {
        path: 'functions/test.fish',
        text: [
          'function test',
          '    set -lx foo bar',
          '    set -ql foo',
          '    if test -n "$foo"',
          '        set foo bar2',
          '        echo $foo',
          '    end',
          'end',
        ],
      },
      {
        path: 'conf.d/test.fish',
        text: [
          'function __test',
          '   set -x foo bar',
          'end',
          'function next',
          '   set foo bar',
          'end',
        ],
      },
      {
        path: 'conf.d/global_test.fish',
        text: [
          'set -gx foo bar',
          'echo $foo',
        ],
      },
      {
        path: 'functions/test-other.fish',
        text: [
          'function test-other',
          '    echo $foo',
          'end',
        ],
      },
    ).setup(async () => {
      functionDoc = documents.all().find(doc => doc.uri.endsWith('functions/test.fish'))!;
      confdDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/_foo.fish'))!;
      globalTestDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/global_test.fish'))!;
    });

    it('foo local in conf.d/_foo.fish `2 refs for \'foo\'`', () => {
      expect(documents.all()).toHaveLength(5);
      expect(functionDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === confdDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(confdDoc, getRange(found).start);
      printLocations(result, {
        showLineText: true,
      });
      expect(result).toHaveLength(2);
    });

    it('foo local in functions/test.fish `5 refs for \'foo\'`', () => {
      const node = analyzer.getNodes(functionDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      expect(node).toBeDefined();
      const result = getReferences(functionDoc, getRange(node).start);
      printLocations(result, {
        showText: true,
        showLineText: true,
        showIndex: true,
        rangeVerbose: true,
      });
      for (const loc of result) {
        console.log({
          uri: LspDocument.testUri(loc.uri),
          text: analyzer.getTextAtLocation(loc),
          node: analyzer.nodeAtPoint(loc.uri, loc.range.start.line, loc.range.start.character)?.text,
          symbol: analyzer.getFlatDocumentSymbols(loc.uri).find(s => s.equalsLocation(loc))?.toString(),
        });
      }
      expect(result).toHaveLength(5);
    });

    it('foo global', () => {
      const node = analyzer.getNodes(globalTestDoc.uri).find((n) => n.text === 'foo' && isVariableDefinitionName(n))!;
      expect(node).toBeDefined();
      const result = getReferences(globalTestDoc, getRange(node).start);
      printLocations(result, {
        showText: true,
        showLineText: true,
      });
      expect(result).toHaveLength(3);
      expect(result.map(loc => loc.uri).some(uri => uri.includes('functions/test-other.fish'))).toBeTruthy();
      expect(result.map(loc => loc.uri).some(uri => uri.includes('conf.d/global_test.fish'))).toBeTruthy();
    });
  });

  describe('alias', () => {
    setupWorkspace('references_test_alias_workspace',
      {
        path: 'conf.d/alias.fish',
        text: [
          'alias ls=\'exa\'',
        ],
      },
      {
        path: 'functions/test.fish',
        text: [
          'function test',
          '    set -lx foo bar',
          '    function ls',
          '          builtin ls',
          '    end',
          '    ls',
          'end',
        ],
      },
      {
        path: 'functions/test-other.fish',
        text: [
          'function test-other',
          '    ls $argv',
          'end',
        ],
      },
      {
        path: 'completions/ls-wrapper.fish',
        text: [
          'complete -c ls-wrapper -w \'ls\'',
        ],
      },
      {
        path: 'completions/ls.fish',
        text: [
          'complete -c ls -n \'command -aq ls\'',
        ],
      },
      {
        path: 'functions/ls-wrapper.fish',
        text: [
          'function ls-wrapper -w=ls --wraps \'command ls\'',
          '    argparse -n=ls h/help -- $argv; or return 1',
          '    echo "ls-wrapper"',
          '    ls $argv',
          'end',
        ],
      },
      {

        path: 'functions/user_keybinds.fish',
        text: [
          'function user_keybinds',
          '    bind ctro-o,ctrl-l \'ls\'',
          'end',
        ],
      },
      {
        path: 'conf.d/abbrevaitons.fish',
        text: [
          'abbr -a ll ls -l',
          'abbr -a lt -- ls -t',
          'abbr -a --command=ls lt -- -lt',
        ],
      },
      {

        path: 'functions/local-alias.fish',
        text: [
          'function local-alias',
          '    alias ls=\'ls-wrapper\'',
          '    ls $argv',
          'end',
        ],
      },
    ).setup();

    it('check seen -w/--wraps nodes', () => {
      const values = analyzer.findNodes((n, _) => {
        return isMatchingOptionValue(n, Option.create('-w', '--wraps').withValue());
      }).flatMap(({ nodes }) => nodes);
      expect(values).toHaveLength(3);
    });

    it('check all strings that should be a function call location', () => {
      const symbol = analyzer.findSymbol((s, d) => {
        return !!(s.name === 'ls' && d?.uri.endsWith('conf.d/alias.fish'));
      })!;

      const commandCalls = analyzer.findNodes((n, d) => {
        if (symbol.equalsNode(n, { strict: true })) {
          console.log({
            symbol: symbol.toString(),
            node: n.text,
            uri: d?.uri,
            range: getRange(n),
          });
        }
        const flatSymbols = analyzer.getFlatDocumentSymbols(d.uri).filter(s =>
          s.isLocal()
          && s.name === symbol.name
          && s.kind === symbol.kind,
        );

        if (flatSymbols && flatSymbols.some(s => s.scopeContainsNode(n))) {
          return false;
        }

        if (
          n.parent
          && isCommandWithName(n.parent, symbol.name)
          && n.parent.firstNamedChild?.equals(n)
        ) {
          return true;
        }

        if (isArgumentThatCanContainCommandCalls(n)) {
          if (isString(n) || n.text.includes('=')) {
            return extractCommands(n).some(cmd => cmd === symbol.name);
          }
          return n.text === symbol.name;
        }

        if (isDefinitionName(n)) return false;

        if (n.parent && isCommandWithName(n.parent, 'functions', 'emit', 'trap', 'command', 'bind', 'abbr')) {
          if (n.parent.firstNamedChild?.equals(n)) return false;
          if (isOption(n)) return false;
          if (isString(n)) return extractCommands(n).some(cmd => cmd === symbol.name);
          const firstIndex = isCommandWithName(n.parent, 'bind', 'abbr') ? 2 : 1;
          const endStdinIndex = isCommandWithName(n.parent, 'abbr')
            ? -1
            : n.parent.children.findIndex(c => isEndStdinCharacter(c));
          const children = n.parent.children.slice(firstIndex, endStdinIndex).filter(c => !isOption(c) && !isEndStdinCharacter(c));
          const found = children.find(n => n.text === symbol.name);
          if (found) {
            return found.equals(n);
          }
        }

        return false;
      });
      commandCalls.forEach(({ uri, nodes }, index) => {
        console.log(`commandCall ${index}`, {
          uri: LspDocument.testUri(uri),
          nodes: nodes.map(n => ({
            text: n.text,
            type: n.type,
            startPosition: `{ row: ${n.startPosition.row}, column: ${n.startPosition.column} }`,
            endPosition: `{ row: ${n.endPosition.row}, column: ${n.endPosition.column} }`,
          })),
        });
      });
    });

    it('global alias', () => {
      const searchDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/alias.fish'))!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      const symbol = analyzer.findSymbol((s, _) => {
        if (s.fishKind === 'ALIAS') {
          return s.name === 'ls' && s.uri === searchDoc.uri;
        }
        return false;
      })!;

      const refNodes = analyzer.findNodes((n, d) => {
        // return isCommandWithName(n, searchSymbol.name);
        // return isArgumentThatCanContainCommandCalls(n)
        // if (isCommandName(n)) {
        if (symbol.equalsNode(n, { strict: true })) {
          console.log({
            symbol: symbol.toString(),
            node: n.text,
            uri: d?.uri,
            range: getRange(n),
          });
        }
        const flatSymbols = analyzer.getFlatDocumentSymbols(d.uri).filter(s =>
          s.isLocal()
          && s.name === symbol.name
          && s.kind === symbol.kind,
        );

        if (flatSymbols && flatSymbols.some(s => s.scopeContainsNode(n))) {
          return false;
        }

        if (
          n.parent
          && isCommandWithName(n.parent, symbol.name)
          && n.parent.firstNamedChild?.equals(n)
        ) {
          return true;
        }

        if (isArgumentThatCanContainCommandCalls(n)) {
          if (isString(n) || n.text.includes('=')) {
            return extractCommands(n).some(cmd => cmd === symbol.name);
          }
          return n.text === symbol.name;
        }

        if (isDefinitionName(n)) return false;

        if (n.parent && isCommandWithName(n.parent, 'functions', 'emit', 'trap', 'command')) {
          if (n.parent.firstNamedChild?.equals(n)) return false;
          if (isOption(n)) return false;
          if (isString(n)) return extractCommands(n).some(cmd => cmd === symbol.name);
          return n.parent.children.slice(1).find(n => !isOption(n))?.text === symbol.name;
        }

        return false;
      });

      let i = 0;
      const results: Location[] = [];
      for (const { uri, nodes } of refNodes) {
        console.log(`refNode ${i++}`, {
          uri,
          nodes: nodes.map(n => ({
            text: n.text,
            type: n.type,
            startPosition: `{ row: ${n.startPosition.row}, column: ${n.startPosition.column} }`,
            endPosition: `{ row: ${n.endPosition.row}, column: ${n.endPosition.column} }`,
          })),
        });
        nodes.forEach(n => {
          if (n.text !== symbol.name) {
            const newLocations = extractMatchingCommandLocations(symbol, n, uri);
            results.push(...newLocations);
          } else {
            results.push(Location.create(uri, getRange(n)));
          }
        });
      }
      // // console.log({
      // //   results: results.map(loc => ({
      // //   })
      // // })
      //
      // // const result = getReferences(searchDoc, getRange(found).start);
      // printLocations(results, {
      //   verbose: true,
      // });
      const builtinRefs = getReferences(searchDoc, getRange(found).start);
      console.log('builtinRefs', builtinRefs.length);
      printLocations(builtinRefs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(builtinRefs).toHaveLength(12);

      // expect(result).toHaveLength(2);
      // const result = getReferencesOld(searchDoc, getRange(found).start);
      // expect(result).toHaveLength(2);
    });

    it('local alias', () => {
      const searchDoc = documents.all().find(doc => doc.uri.endsWith('functions/local-alias.fish'))!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'ls=';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(searchDoc, getRange(found).start);
      expect(result).toHaveLength(2);
    });
  });

  describe('functions', () => {
    setupWorkspace(
      'test_references_functions_workspace',
      {
        path: 'conf.d/foo.fish',
        text: [
          'function foo',
          '    echo \'hello there!\'',
          'end',
        ],
      },
      {
        path: 'functions/test.fish',
        text: [
          'function test',
          '    foo --help',
          'end',
        ],
      },
      {
        path: 'functions/test-other.fish',
        text: [
          'function test-other',
          '    function foo',
          '         echo \'general kenobi!\'',
          '    end',
          '    foo',
          'end',
        ],
      },
      {
        path: 'completions/foo.fish',
        text: [
          'complete -c foo -n \'test\' -s h -l help',
        ],
      },
    ).setup();

    it('conf.d/foo.fish ->  foo function definition', () => {
      expect(documents.all()).toHaveLength(4);
      const searchDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/foo.fish'))!;
      expect(searchDoc).toBeDefined();
      const found = analyzer.findNode((n, document) => {
        return document!.uri === searchDoc.uri && n.text === 'foo';
      })!;
      expect(found).toBeDefined();
      const result = getReferences(searchDoc, getRange(found).start);
      expect(result).toHaveLength(3);
      const uris = new Set(result.map(loc => LspDocument.createFromUri(loc.uri).getRelativeFilenameToWorkspace()));
      console.log(uris);
      expect(uris.has('functions/test.fish')).toBeTruthy();
      expect(uris.has('functions/test-other.fish')).toBeFalsy();
      expect(uris.has('completions/foo.fish')).toBeTruthy();
      expect(uris.has('conf.d/foo.fish')).toBeTruthy();
    });
  });

  describe('renames', () => {
    describe('using `conf.d/test.fish` document', () => {
      let cached: EnsuredAnalyzeDocument;
      let document: LspDocument;

      setupWorkspace(
        'test_renames_conf_d_workspace',
        {
          path: 'conf.d/test.fish',
          text: ['function test_1',
            '    argparse --stop-nonopt h/help name= q/quiet v/version y/yes n/no -- $argv',
            '    or return',
            '    if set -lq _flag_help',
            '        echo "help_msg"',
            '    end',
            '    if set -lq _flag_name && test -n "$_flag_name"',
            '        echo "$_flag_name"',
            '    end',
            'end',
            'function test_2',
            '     test_1 --help',
            'end',
            'complete -c test_1 -s h -l help',
            'complete -c test_1      -l name',
            'complete -c test_1 -s q -l quiet',
            'complete -c test_1 -s v -l version',
            'complete -c test_1 -s y -l yes',
          ],
        },
      ).setup(
        async () => {
          document = documents.all().find(doc => doc.uri.endsWith('conf.d/test.fish'))!;
          cached = analyzer.analyze(document).ensureParsed();
        },
      );

      it('child completion nodes', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        console.log(nodeAtPoint?.text);
        expect(nodeAtPoint).toBeDefined();
        const results: SyntaxNode[] = [];
        getChildNodes(cached.tree.rootNode).forEach(node => {
          if (
            isCompletionArgparseFlagWithCommandName(node, 'test_1', 'help') ||
            isCompletionArgparseFlagWithCommandName(node, 'test_1', 'h')
          ) {
            results.push(node);
          }
        });
        expect(results).toHaveLength(2);
      });

      it('argparse references for `h/help` position inside of `help`', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(document.uri, 1, 32);
        console.log(nodeAtPoint?.text);
        expect(nodeAtPoint).toBeDefined();
        const refs = getReferences(cached.document, Position.create(1, 31));
        const resultTexts: string[] = [];
        refs.forEach(loc => {
          if (analyzer.getTextAtLocation(loc).startsWith('_flag_')) {
            loc.range.start.character += '_flag_'.length;
          }
          resultTexts.push(analyzer.getTextAtLocation(loc));
        });
        expect(resultTexts).toHaveLength(4);
        for (const text of resultTexts) {
          if (text !== 'help') fail();
        }
      });
    });

    describe('using \'workspaces/test_renames_workspace/{completions,functions,conf.d}/**.fish\' workspace', () => {
      let functionDoc: LspDocument;
      let completionDoc: LspDocument;
      let confdDoc: LspDocument;
      let configDoc: LspDocument;

      setupWorkspace('test_renames_workspace', {
        path: 'functions/foo_test.fish',
        text: [
          'function foo_test',
          '  argparse --stop-nonopt special-option h/help name= q/quiet v/version y/yes n/no -- $argv',
          '  or return',
          '  if set -lq _flag_help',
          '      echo "help_msg"',
          '  end',
          '  if set -lq _flag_name && test -n "$_flag_name"',
          '      echo "$_flag_name"',
          '  end',
          '  if set -lq _flag_special_option',
          '      echo "special-option"',
          '  end',
          'end',
        ],
      },
      {
        path: 'completions/foo_test.fish',
        text: [
          'complete -c foo_test -s h -l help',
          'complete -c foo_test      -l name',
          'complete -c foo_test -s q -l quiet',
          'complete -c foo_test -s v -l version',
          'complete -c foo_test -s y -l yes',
          'complete -c foo_test -s n -l no',
          'complete -c foo_test -l special-option',
        ],
      },
      {
        path: 'conf.d/__test.fish',
        text: [
          'function __test',
          '   foo_test --yes',
          '   foo_test --special-option',
          '   baz',
          'end',
        ],
      },
      {
        path: 'config.fish',
        text: [
          'set -gx FISH_TEST_CONFIG "test"',
          'set -gx FISH_TEST_CONFIG_2 "test"',
          'function foo_test_wrapper -w foo_test -d "`foo_test --yes` wrapper"',
          '   foo_test --yes $argv',
          '   foo_test --special-option="$argv"',
          'end',
          "alias baz='foo'",
        ],
      }).setup(async () => {
        functionDoc = documents.all().find(doc => doc.uri.endsWith('functions/foo_test.fish'))!;
        completionDoc = documents.all().find(doc => doc.uri.endsWith('completions/foo_test.fish'))!;
        confdDoc = documents.all().find(doc => doc.uri.endsWith('conf.d/__test.fish'))!;
        configDoc = documents.all().find(doc => doc.uri.endsWith('config.fish'))!;
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        expect(confdDoc).toBeDefined();
        expect(configDoc).toBeDefined();
      });

      it('setup test', () => {
        expect(workspaceManager.current?.uris.indexed).toHaveLength(4);
        expect(workspaceManager.current?.uris.all).toHaveLength(4);
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        expect(confdDoc).toBeDefined();
        expect(configDoc).toBeDefined();
      });

      it('argparse rename `name=` -> `na` test', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 49)!;
        expect(nodeAtPoint).toBeDefined();
        console.debug(1, nodeAtPoint?.text);
        const defSymbol = analyzer.getDefinition(functionDoc, Position.create(1, 49));
        const refs = getReferences(functionDoc, Position.create(1, 49));
        console.log('def', {
          defSymbol,
          uri: defSymbol?.uri,
          rangeStart: defSymbol?.selectionRange.start,
          rangeEnd: defSymbol?.selectionRange.end,
          text: defSymbol?.name,
        });
        printLocations(refs, {
          verbose: true,
        });

        const renames = getRenames(functionDoc, Position.create(1, 49), 'na');
        const newTexts: Set<string> = new Set();
        renames.forEach(loc => {
          newTexts.add(loc.newText);
        });
        expect(refs).toHaveLength(5);
        expect(newTexts.size === 1).toBeTruthy();
      });

      it('argparse `special-option` test', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 1, 27);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('special-option');
        console.log(2, nodeAtPoint?.text);
        const renames = getRenames(functionDoc, Position.create(1, 27), 'special-name');
        const newTexts: Set<string> = new Set();
        const uris: Set<string> = new Set();
        renames.forEach(loc => {
          uris.add(loc.uri);
          newTexts.add(loc.newText);
        });
        expect(renames).toHaveLength(5);
        expect(newTexts.size === 2).toBeTruthy();
        expect(newTexts.has('special-name')).toBeTruthy();
        expect(newTexts.has('special_name')).toBeTruthy();
        expect(uris.size).toBe(4);
      });

      it('function `foo_test`', () => {
        const nodeAtPoint = analyzer.nodeAtPoint(functionDoc.uri, 0, 11);
        expect(nodeAtPoint).toBeDefined();
        expect(nodeAtPoint!.text).toBe('foo_test');
        const refs = getRenames(functionDoc, Position.create(0, 11), 'test-rename');
        const newTexts: Set<string> = new Set();
        const refUris: Set<string> = new Set();
        const countPerUri: Map<string, number> = new Map();
        refs.forEach(loc => {
          console.log('location ref', {
            uri: loc.uri,
            rangeStart: loc.range.start,
            rangeEnd: loc.range.end,
            docText: analyzer.getTextAtLocation(loc),
            docLine: analyzer.getDocument(loc.uri)!.getLine(loc.range.start.line),
            text: loc.newText,
          });
          const count = countPerUri.get(loc.uri) || 0;
          countPerUri.set(loc.uri, count + 1);
          newTexts.add(loc.newText);
          refUris.add(loc.uri);
        });
        expect(newTexts.size === 1).toBeTruthy();
        // expect(refs).toHaveLength(13);
        expect(refUris.size).toBe(4);
        expect(countPerUri.get(functionDoc.uri)).toBe(1);
        expect(countPerUri.get(completionDoc.uri)).toBe(7);
        expect(countPerUri.get(confdDoc.uri)).toBe(2);
        expect(countPerUri.get(configDoc.uri)).toBe(3);
      });

      it('config.fish $argv rename', () => {
        const argvNode = analyzer.getNodes(configDoc.uri)
          .find(n => n.text === '$argv' && n.parent && isCommand(n.parent))!;
        console.log({
          argvNode: {
            text: argvNode.text,
            type: argvNode.type,
            startPosition: argvNode.startPosition,
            endPosition: argvNode.endPosition,
          },
          parent: {
            type: argvNode.parent?.type,
            text: argvNode.parent?.text,
          },
          uri: configDoc.uri,
        });
        const pos = pointToPosition(argvNode!.startPosition);
        const renames = getRenames(configDoc, pos, 'test-argv');
        expect(renames.length === 0).toBeTruthy();
      });

      it('alias `baz` references && renames', () => {
        const bazNode = analyzer.getFlatDocumentSymbols(configDoc.uri)
          .find(s => s.name === 'baz' && s.fishKind === 'ALIAS')!;
        console.log({
          bazNode: {
            name: bazNode.name,
            uri: bazNode.uri,
            range: bazNode.range,
            selectionRange: bazNode.selectionRange,
          },
        });
        const bazLocation = bazNode.toLocation();
        const refs = getReferences(configDoc, bazLocation.range.start);
        const renames = getRenames(configDoc, bazLocation.range.start, 'baz_test');
        expect(refs).toHaveLength(2);
        expect(renames).toHaveLength(2);
      });
    });
  });

  describe('references to skip', () => {
    let funcDoc: LspDocument;
    let configDoc: LspDocument;
    setupWorkspace('references_skip_workspace',
      {
        path: 'functions/_test.fish',
        text: [
          'function _test',
          '  set -l argv',
          'end',
        ],
      },
      {
        path: 'config.fish',
        text: [
          'test -d ~/.config/fish &>/dev/null',
          'echo $status',
          'echo $argv',
          'echo $argv[1]',
          'echo $pipestatus',
        ],
      },
    ).setup(
      async () => {
        funcDoc = documents.all().find(doc => doc.uri.endsWith('functions/_test.fish'))!;
        configDoc = documents.all().find(doc => doc.uri.endsWith('config.fish'))!;
      },
    );

    it('variables to skip test', () => {
      const variableNodes = analyzer.getNodes(configDoc.uri).filter(
        n => isVariable(n) && n.type === 'variable_name',
      );
      expect(variableNodes.length).toBe(4);
      variableNodes.forEach(node => {
        const refs = getReferences(configDoc, getRange(node).start);
        expect(refs).toHaveLength(0);
      });
    });

    it('function `test` -> `argv` references w/ `set -l argv`', () => {
      const variableNode = analyzer.getNodes(funcDoc.uri).find(
        n => isVariableDefinitionName(n),
      )!;
      const refs = getReferences(funcDoc, getRange(variableNode).start);
      expect(refs).toHaveLength(1);
    });
  });

  describe('emit event references', () => {
    let focusedDoc1: LspDocument;
    let focusedDoc2: LspDocument;
    let focusedDoc3: LspDocument;
    let customFishDoc: LspDocument;
    let configDoc: LspDocument;
    setupWorkspace('references_emit_event_workspace',
      {
        path: 'event_test.fish',
        text: [
          'function event_test --on-event test_event',
          '    echo event test: $argv',
          'end',
          '',
          'function foo',
          '    function bar',
          '        function baz',
          '            echo baz',
          '            function qux',
          '                echo qux',
          '            end',
          '            qux',
          '        end',
          '        baz',
          '    end',
          '    bar',
          'end',
          'foo',
          '',
          'emit test_event something',
        ],
      },
      {
        path: 'other_event_test.fish',
        text: [
          'function other_event_test --on-event test_event_2',
          '    echo other event test: $argv',
          'end',
          '',
          'emit test_event_2 something',
        ],
      },
      {
        path: 'event_without_emit.fish',
        text: [
          '# NOT an autoloaded file',
          'function _event_without_emit --on-event test_event_a',
          '    echo event without emit',
          'end',
          '',
          'function other_event_without_emit --on-event test_event_b',
          '    echo other event without emit',
          'end',
          'function event_with_emit --on-event test_event_c',
          '    echo event with emit',
          'end',
          'emit test_event_c',
        ],
      },
      {
        path: 'functions/custom_fish_prompt.fish',
        text: [
          'function custom_fish_prompt --on-event fish_prompt',
          '    echo "fish prompt $(pwd) >>>"',
          'end',
          '',
          'function __fish_configure_prompt --on-event reset_fish_prompt',
          '    echo resetting fish prompt',
          '    custom_fish_prompt',
          'end',
        ],
      },
      {
        path: 'config.fish',
        text: [
          'custom_fish_prompt',
          'emit reset_fish_prompt',
        ],
      },

    ).setup(async () => {
      focusedDoc1 = documents.all().find(doc => doc.uri.endsWith('event_test.fish'))!;
      focusedDoc2 = documents.all().find(doc => doc.uri.endsWith('other_event_test.fish'))!;
      focusedDoc3 = documents.all().find(doc => doc.uri.endsWith('event_without_emit.fish'))!;
      customFishDoc = documents.all().find(doc => doc.uri.endsWith('functions/custom_fish_prompt.fish'))!;
      configDoc = documents.all().find(doc => doc.uri.endsWith('config.fish'))!;
      expect(focusedDoc1).toBeDefined();
      expect(focusedDoc2).toBeDefined();
      expect(focusedDoc3).toBeDefined();
      expect(customFishDoc).toBeDefined();
      expect(configDoc).toBeDefined();
    });

    describe('all unused references', () => {
      it('event_test.fish', () => {
        const focusedDoc = focusedDoc1;
        const unusedRefs = allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
      });

      it('other_event_test.fish', () => {
        const focusedDoc = focusedDoc2;
        // const allSymbols = analyzer.getDocumentSymbols(focusedDoc.uri);
        const symbols = filterFirstPerScopeSymbol(focusedDoc);
        printClientTree({ log: true }, ...symbols);
        const unusedRefs = allUnusedLocalReferences(focusedDoc);
        console.log('unused references', unusedRefs.length);
        printLocations(unusedRefs, {
          showIndex: true,
          showText: true,
          showLineText: true,
        });
        expect(unusedRefs).toHaveLength(0);
      });

      it('event_without_emit.fish', () => {
        const focusedDoc = focusedDoc3;
        // const allSymbols = analyzer.getDocumentSymbols(focusedDoc.uri);
        const symbols = filterFirstPerScopeSymbol(focusedDoc);
        printClientTree({ log: true }, ...symbols);
        const unusedRefs = allUnusedLocalReferences(focusedDoc);
        console.log('unused references', unusedRefs.length);
        printLocations(unusedRefs, {
          showIndex: true,
          showText: true,
          showLineText: true,
        });
        expect(unusedRefs).toHaveLength(2);
      });

      it('custom_fish_prompt `--on-event fish_prompt` not emitted but not show unused', () => {
        const focusedDoc = customFishDoc;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isFunction() && s.hasEventHook() && s.name === '__fish_configure_prompt')!;
        const allRefs = getReferences(focusedDoc, focusedSymbol.toPosition());
        // console.log('ALL')
        // printLocations(allRefs, {verbose: true, showText: true, showLineText: true });
        expect(allRefs).toHaveLength(1);
        const unusedRefs = allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
        // console.log('unused references', unusedRefs.length);
        // printLocations(unusedRefs, {
        //   showIndex: true,
        //   showText: true,
        //   showLineText: true,
        // });
      });

      it('config.fish `reset_fish_prompt` emitted', () => {
        const focusedDoc = configDoc;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const allRefs = getReferences(focusedDoc, focusedSymbol.toPosition());
        // console.log('ALL')
        // printLocations(allRefs, {verbose: true, showText: true, showLineText: true });
        expect(allRefs).toHaveLength(2);
        const unusedRefs = allUnusedLocalReferences(focusedDoc);
        expect(unusedRefs).toHaveLength(0);
      });
    });

    describe('goto implementation', () => {
      it('config.fish `emit reset_fish_prompt`', () => {
        const focusedDoc = configDoc;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEmittedEvent() && s.name === 'reset_fish_prompt')!;
        const impls = getImplementation(focusedDoc, focusedSymbol.toPosition());
        printLocations(impls, {
          showIndex: true,
          showText: true,
          showLineText: true,
          verbose: true,
        });
        expect(impls).toHaveLength(1);
      });

      it('functions/custom_fish_prompt.fish -> `emit reset_fish_prompt`', () => {
        const focusedDoc = customFishDoc;
        const focusedSymbol = analyzer.getFlatDocumentSymbols(focusedDoc.uri).find(s => s.isEventHook() && s.name === 'reset_fish_prompt')!;
        const impls = getImplementation(focusedDoc, focusedSymbol.toPosition());
        expect(impls).toHaveLength(1);
      });
    });
  });

  describe('variable references edge cases', () => {
    setupWorkspace('test_v_ref_edge_cases_workspace',
      {
        path: 'functions/local_test_var.fish',
        text: [
          'set -g test_var # definition',
          'set other_test_var',
          'function local_test_var',
          '     set -l test_var local_1',
          '     echo $test_var    # skip',
          '     set -l other_test_var',
          '     echo $other_test_var',
          '     echo $global_test_var',
          '     if test -n "$test_var"  # skip',
          '         set -a test_var local_2',
          '     end',
          '     private_function',
          'end',
          'echo $test_var # outer 1',
          'function private_function',
          '     set test_var     # skip',
          '     set -l other_test_var',
          '     echo $test_var   # skip',
          '     echo $other_test_var',
          '     echo $global_test_var',
          '     set test_var     # skip',
          'end',
          'echo $test_var # outer 2',
          'function no_skip; echo $test_var; end # used in function',
          'function skip -a test_var; echo $test_var; end; # 3',
          'set test_var # global inherit 4',
        ],
      },
      {
        path: 'conf.d/global_test_var.fish',
        text: [
          'set -gx global_test_var',
          'echo $global_test_var',
          'echo $test_var        # global ref 5',
          'set -U universal_v -gx',
          'set -gx global_fake_universal_v --universal',
          'set fake_universal_v --universal',
        ],
      }
      ,
    ).setup();

    it('test global variable w/o local references', () => {
      const doc = documents.all().find(d => d.uri.endsWith('functions/local_test_var.fish'))!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var')!;

      const refs = getReferences(doc, focusedSymbol.toPosition());
      console.log({
        date: new Date().toISOString(),
        refs: refs.length,
      });
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(6);
    });

    it('test global variable w/ local references', () => {
      const doc = documents.all().find(d => d.uri.endsWith('functions/local_test_var.fish'))!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      console.log('focusedSymbol', focusedSymbol.toString());
      const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      console.log('definition', def?.toString());

      const refs = getReferences(doc, focusedSymbol.toPosition());
      // console.log({
      //   date: new Date().toISOString(),
      //   refs: refs.length,
      // });
      const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(4);
    });

    it('test variable w/ local references && {localOnly: true}', () => {
      const doc = documents.all().find(d => d.uri.endsWith('functions/local_test_var.fish'))!;
      expect(doc).toBeDefined();
      const focusedSymbol = analyzer.getFlatDocumentSymbols(doc.uri).find(s => s.name === 'test_var' && s.parent?.name === 'local_test_var')!;
      console.log('focusedSymbol', focusedSymbol.toString());
      const def = analyzer.getDefinition(doc, focusedSymbol.toPosition());
      console.log('definition', def?.toString());

      const refs = getReferences(doc, focusedSymbol.toPosition(), { localOnly: true });
      // console.log({
      //   date: new Date().toISOString(),
      //   refs: refs.length,
      // });
      const matchSymbols = refs.map(loc => analyzer.getSymbolAtLocation(loc));
      console.log('matchSymbols', matchSymbols.map(s => s?.toString()));
      printLocations(refs, {
        showText: true,
        showLineText: true,
        showIndex: true,
      });
      expect(refs).toHaveLength(4);
    });
  });
});

