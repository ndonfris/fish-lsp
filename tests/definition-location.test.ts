import * as os from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as Parser from 'web-tree-sitter';
import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { execCommandLocations } from '../src/utils/exec';
import { env } from '../src/utils/env-manager';
// import { currentWorkspace, findCurrentWorkspace, workspaces } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { createFakeLspDocument, setLogger } from './helpers';
import { getRange } from '../src/utils/tree-sitter';
import { pathToUri } from '../src/utils/translation';
import { isMatchingOption, Option } from '../src/parsing/options';
import { isCompletionCommandDefinition, isCompletionDefinitionWithName, isCompletionSymbol } from '../src/parsing/complete';
import { isCommandWithName, isOption } from '../src/utils/node-types';
import { isArgparseVariableDefinitionName } from '../src/parsing/argparse';
import { getReferences } from '../src/references';
import { config } from '../src/config';
import TestWorkspace, { TestFile } from './test-workspace-utils';

let parser: Parser;
// let currentWorkspace: CurrentWorkspace = new CurrentWorkspace();

describe('find definition locations of symbols', () => {
  setLogger();

  beforeEach(async () => {
    parser = await initializeParser();
    await Analyzer.initialize();
  });

  afterEach(() => {
    parser.delete();
    workspaceManager.clear();
  });

  describe('find analyzed symbol location', () => {
    const TestWorkspaceOne = TestWorkspace.create().addFiles(
      {
        path: 'conf.d/variable-lifetime.fish',
        text: [
          'set -g some_var "active"',
          'echo $some_var',
          'set -eg some_var',
          'echo $some_var',
        ].join('\n'),
      },
      {
        path: 'functions/lifetime_test.fish',
        text: [
          'function lifetime_test',
          '  echo "hello"',
          '  $some_var',
          'end',
        ].join('\n'),
      },
      {
        path: 'conf.d/fallback-global.fish',
        text: [
          'set -g forgit_var "from_confd"',
        ].join('\n'),
      },
    ).initialize();

    it('set -g var should not resolve after matching set -eg var in same scope', () => {
      const doc = TestWorkspaceOne.getDocument('conf.d/variable-lifetime.fish')!;
      analyzer.analyze(doc);

      const beforeErase = analyzer.getDefinition(doc, { line: 1, character: 6 });
      expect(beforeErase).toBeDefined();
      expect(beforeErase?.name).toBe('some_var');
      expect(beforeErase?.selectionRange.start.line).toBe(0);

      const eraseTarget = analyzer.getDefinition(doc, { line: 2, character: 8 });
      expect(eraseTarget).toBeDefined();
      expect(eraseTarget?.name).toBe('some_var');
      expect(eraseTarget?.selectionRange.start.line).toBe(0);

      const afterErase = analyzer.getDefinition(doc, { line: 3, character: 6 });
      expect(afterErase).toBeNull();
    });

    it('falls back to indexed paths when workspace-local definition is missing and single-workspace mode is disabled', () => {
      const prevSingleWorkspace = config.fish_lsp_single_workspace_support;
      const prevIndexedPaths = [...config.fish_lsp_all_indexed_paths];

      try {
        config.fish_lsp_single_workspace_support = false;
        config.fish_lsp_all_indexed_paths = [TestWorkspaceOne.path];
        const confdDoc = TestWorkspaceOne.getDocument('conf.d/fallback-global.fish')!;
        const tmpDoc = createFakeLspDocument(
          '/tmp/fish-lsp-fallback-definition-test.fish',
          'echo $forgit_var',
        );

        analyzer.analyze(tmpDoc);

        const definition = analyzer.getDefinition(tmpDoc, { line: 0, character: 8 });
        expect(definition).toBeDefined();
        expect(definition?.name).toBe('forgit_var');
        expect(definition?.uri).toBe(confdDoc.uri);
      } finally {
        config.fish_lsp_single_workspace_support = prevSingleWorkspace;
        config.fish_lsp_all_indexed_paths = prevIndexedPaths;
      }
    });

    describe('symbol location', () => {
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('test', [
            'function test',
            '  echo "hello"',
            'end',
          ].join('\n')),
          TestFile.function('test2', [
            'function test2',
            '  echo "hello"',
            'end',
          ].join('\n')),
        ).initialize();

      it('should find symbol location', async () => {
        const doc = workspace.getDocument('functions/test.fish')!;
        const symbols = analyzer.getFlatDocumentSymbols(doc.uri);
        expect(symbols).toHaveLength(2);
      });
    });

    describe('function call location', () => {
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('test', [
            'function test',
            '  echo "hello"',
            'end',
          ].join('\n')),
          TestFile.function('test2', [
            'function test2',
            '  echo "hello"',
            'end',
          ].join('\n')),
          TestFile.function('test3', [
            'function test3',
            '  test',
            'end',
          ].join('\n')),
        ).initialize();

      it('should find test location', () => {
        expect(workspace.documents).toHaveLength(3);
        const doc = workspace.getDocument('functions/test3.fish')!;
        const nodes = analyzer.getNodes(doc.uri);
        const node = nodes.find((n) => n.type === 'command' && n.text === 'test')!;
        const defLocations = analyzer.getDefinitionLocation(doc, getRange(node).start);
        expect(defLocations).toHaveLength(1);
        const def = defLocations.at(0)!;
        expect(def.uri).toBe(workspace.getDocument('functions/test.fish')!.uri);
        expect(def.range.start.line).toBe(0);
        expect(def.range.start.character).toBe(9);
        expect(def.range.end.line).toBe(0);
        expect(def.range.end.character).toBe(13);
      });
    });

    describe('completion location', () => {
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('test', [
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
          ].join('\n')),
          TestFile.completion('test', [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ].join('\n')),
        ).initialize();

      it('should find completion location', () => {
        expect(workspace.documents).toHaveLength(2);
        const functionDoc = workspace.getDocument('functions/test.fish')!;
        const completionDoc = workspace.getDocument('completions/test.fish')!;
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        const functionSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri);
        expect(functionSymbols).toHaveLength(13);
        const searchNode = analyzer.getNodes(completionDoc.uri).find(n => isCompletionSymbol(n) && n.text === 'help');
        const result = analyzer.getDefinitionLocation(completionDoc, getRange(searchNode!).start);
        const resultUri = result[0]?.uri;
        if (!resultUri) {
          console.log('resultUri is undefined');
          expect(false).toBeTruthy();
          return;
        }
        expect(result).toHaveLength(1);
        expect(resultUri).toBe(functionDoc.uri);
      });
    });

    describe('command fallback location', () => {
      const commandName = 'test_external_command_definition';
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('caller', [
            'function caller',
            `  ${commandName}`,
            'end',
          ].join('\n')),
        ).initialize();

      it('should resolve command via fish_function_path when no symbol definition exists', () => {
        const originalFunctionPath = env.get('fish_function_path');
        const tempFunctionsDir = join(os.tmpdir(), `fish-lsp-def-loc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const commandPath = join(tempFunctionsDir, `${commandName}.fish`);

        mkdirSync(tempFunctionsDir, { recursive: true });
        writeFileSync(commandPath, [
          `function ${commandName}`,
          '  echo "external"',
          'end',
        ].join('\n'));

        try {
          env.set('fish_function_path', tempFunctionsDir);
          const callerDoc = workspace.getDocument('functions/caller.fish')!;
          const commandNode = analyzer.getNodes(callerDoc.uri)
            .find(n => n.type === 'command' && n.text === commandName);
          expect(commandNode).toBeDefined();

          const result = analyzer.getDefinitionLocation(callerDoc, getRange(commandNode!).start);
          expect(result).toHaveLength(1);
          expect(result[0]?.uri).toBe(pathToUri(commandPath));
          expect(result[0]?.range.start.line).toBe(0);
          expect(result[0]?.range.start.character).toBe(0);
        } finally {
          env.set('fish_function_path', originalFunctionPath);
          rmSync(tempFunctionsDir, { recursive: true, force: true });
        }
      });
    });

    describe.skip('--flag-name location', () => {
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('test', [
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
          ].join('\n')),
          TestFile.completion('test', [
            'complete -c test -s h -l help',
            'complete -c test      -l name',
            'complete -c test -s q -l quiet',
            'complete -c test -s v -l version',
            'complete -c test -s y -l yes',
            'complete -c test -s n -l no',
          ].join('\n')),
          TestFile.confd('test', [
            'function __test',
            '   test --yes',
            'end',
          ].join('\n')),
        ).initialize();

      it('should find --flag-name location', () => {
        expect(workspace.documents).toHaveLength(3);
        const functionDoc = workspace.getDocument('functions/test.fish')!;
        const completionDoc = workspace.getDocument('completions/test.fish')!;
        const confdDoc = workspace.getDocument('conf.d/test.fish')!;
        expect(functionDoc).toBeDefined();
        expect(completionDoc).toBeDefined();
        expect(confdDoc).toBeDefined();
        const nodeAtPoint = analyzer.nodeAtPoint(confdDoc.uri, 1, 10);
        const completionNode = analyzer.findNode((n, doc) => {
          if (doc?.uri === completionDoc.uri && n.parent && isCompletionCommandDefinition(n.parent)) {
            return n.text === 'yes';
          }
          return false;
        });
        const funcNode = analyzer.findNode((n, doc) => {
          if (doc?.uri === functionDoc.uri && isArgparseVariableDefinitionName(n) && n.text.includes('yes')) {
            return true;
          }
          return false;
        });

        console.log('testNode', {
          uri: confdDoc.uri,
          line: 1,
          character: 10,
          node: nodeAtPoint?.type,
          text: nodeAtPoint?.text,
        },
        'completionNode',
        {
          uri: completionDoc.uri,
          line: completionNode!.startPosition.row,
          character: completionNode!.startPosition.column,
          node: completionNode!.type,
          text: completionNode!.text,
        },
        'funcNode',
        {
          uri: functionDoc.uri,
          line: funcNode!.startPosition.row,
          character: funcNode!.startPosition.column,
          node: funcNode!.type,
          text: funcNode!.text,
        },
        );
        if (nodeAtPoint && isOption(nodeAtPoint)) {
          const result = getReferences(confdDoc, getRange(nodeAtPoint).start);
          result.forEach(loc => {
            console.log('location', {
              uri: loc.uri,
              range: loc.range.start,
            });
          });
          expect(result).toHaveLength(4);
          const symbol = analyzer.findSymbol((s) => {
            if (s.parent && s.fishKind === 'ARGPARSE') {
              return nodeAtPoint.parent?.firstNamedChild?.text === s.parent?.name &&
                s.parent?.isGlobal() &&
                nodeAtPoint.text.startsWith(s.argparseFlag);
            }
            return false;
          });

          if (!symbol) {
            console.log('symbol not found');
            return;
          }
          const parentName = symbol.parent?.name || '';
          const matchingNodes = analyzer.findNodes((n, document) => {
            if (
              isCompletionDefinitionWithName(n, parentName, document!)
              && n.text === symbol.argparseFlagName
            ) {
              return true;
            }
            if (
              n.parent
              && isCommandWithName(n.parent, parentName)
              && isOption(n)
              && isMatchingOption(n, Option.fromRaw(symbol?.argparseFlag))
            ) {
              return true;
            }
            if (
              document!.uri === symbol.uri
              && symbol.scopeContainsNode(n)
              && n.text === symbol.name
            ) {
              return true;
            }
            return false;
          });
          for (const { uri, nodes } of matchingNodes) {
            console.log(`nodes ${uri}`);
            console.log(nodes.map(n => n.text));
          }
          expect(true).toBeTruthy();
        }
      });
    });
  });

  describe.skip('update currentWorkspace.current workspace', () => {
    it('should update currentWorkspace', async () => {
      [
        createFakeLspDocument('functions/test.fish',
          'function test',
          '  echo "hello"',
          'end',
        ),
        createFakeLspDocument('functions/test2.fish',
          'function test2',
          '  echo "hello"',
          'end',
        ),
      ].forEach(async (doc) => {
        const newWorkspace = workspaceManager.findContainingWorkspace(doc.uri);
        expect(newWorkspace).toBeDefined();
        workspaceManager.handleOpenDocument(doc);
      });

      expect(workspaceManager.current).toBeDefined();
      expect(workspaceManager.current?.path).toBe(`${os.homedir()}/.config/fish`);
      expect(workspaceManager.current?.getUris()).toHaveLength(1);
    });
  });

  describe('finding global command\'s location path', () => {
    it('`fish_add_path` -> valid', async () => {
      const cmd = 'fish_add_path';
      const locations = execCommandLocations(cmd);
      expect(locations.length).toBeGreaterThanOrEqual(1);
    });
    it('`source` -> INVALID', async () => {
      const cmd = 'source';
      const locations = execCommandLocations(cmd);
      expect(locations).toHaveLength(0);
    });

    it('`alias` -> valid', () => {
      const cmd = 'alias';
      const locations = execCommandLocations(cmd);
      expect(locations.length).toBeGreaterThanOrEqual(1);
      const { uri, path } = locations.at(0)!;
      // console.log({ uri, path })
      expect(uri).toBeDefined();
      expect(path).toBeDefined();
      expect(path.endsWith('alias.fish')).toBeTruthy();
      expect(uri.endsWith('alias.fish')).toBeTruthy();
    });
  });
});
