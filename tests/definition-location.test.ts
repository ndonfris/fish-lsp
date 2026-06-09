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
import { createFakeLspDocument, createTestServer, setLogger, type TestServerHandle } from './helpers';
import { DefinitionParams } from 'vscode-languageserver';
import FishServer from '../src/server';
import { getRange } from '../src/utils/tree-sitter';
import { pathToUri } from '../src/utils/translation';
import { isMatchingOption, Option } from '../src/parsing/options';
import { isCompletionCommandDefinition, isCompletionDefinitionWithName, isCompletionSymbol } from '../src/parsing/complete';
import { isCommandWithName, isOption } from '../src/utils/node-types';
import { isArgparseVariableDefinitionName } from '../src/parsing/argparse';
import { config } from '../src/config';
import TestWorkspace, { TestFile } from './test-workspace-utils';

let parser: Parser;
// let currentWorkspace: CurrentWorkspace = new CurrentWorkspace();
const canQueryGlobalCommandLocations = (() => {
  try {
    execCommandLocations('alias');
    return true;
  } catch {
    return false;
  }
})();

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

    it('set -g var still resolves after set -eg var (globals are not lifetime-bounded)', () => {
      // Globals/universals are a single shared entity, so `set -eg` does not end
      // their lifetime for resolution — keeping go-to-definition consistent with
      // find-references (both treat every in-scope use as the same global).
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
      expect(afterErase).toBeDefined();
      expect(afterErase?.name).toBe('some_var');
      expect(afterErase?.selectionRange.start.line).toBe(0);
    });

    // Mirrors the `set -e` lifetime guard above for the function side: a local
    // function shadowing should stop covering call sites once it's torn down
    // with `functions -e`.
    it('local function should not resolve after matching functions -e in same scope', () => {
      const doc = createFakeLspDocument(
        '/tmp/fish-lsp-functions-lifetime-program.fish',
        [
          'function ls; command ls --color $argv; end',
          'ls before',
          'functions -e ls',
          'ls after',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const beforeErase = analyzer.getDefinition(doc, { line: 1, character: 0 });
      expect(beforeErase).toBeDefined();
      expect(beforeErase?.name).toBe('ls');
      expect(beforeErase?.selectionRange.start.line).toBe(0);

      const afterErase = analyzer.getDefinition(doc, { line: 3, character: 0 });
      // No global `ls` exists in the test analyzer state, so the only
      // candidate is the local shadow — which is now out of lifetime.
      expect(afterErase).toBeNull();
    });

    it('local function shadow inside another function respects functions -e boundary', () => {
      const doc = createFakeLspDocument(
        '/tmp/fish-lsp-functions-lifetime-nested.fish',
        [
          'function outer',
          '    function ls; command ls --color $argv; end',
          '    ls before',
          '    functions -e ls',
          '    ls after',
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const beforeErase = analyzer.getDefinition(doc, { line: 2, character: 4 });
      expect(beforeErase).toBeDefined();
      expect(beforeErase?.name).toBe('ls');
      expect(beforeErase?.selectionRange.start.line).toBe(1);

      const afterErase = analyzer.getDefinition(doc, { line: 4, character: 4 });
      expect(afterErase).toBeNull();
    });

    it('getReferences from a local function excludes call sites past its functions -e boundary', () => {
      const doc = createFakeLspDocument(
        '/tmp/fish-lsp-functions-lifetime-refs.fish',
        [
          'function ls; command ls --color $argv; end',
          'ls one',
          'ls two',
          'functions -e ls',
          'ls three',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const refs = analyzer.getReferences(doc, { line: 0, character: 9 });
      const lines = refs.map(r => r.range.start.line);
      // Pre-erase call sites must be present.
      expect(lines).toContain(1);
      expect(lines).toContain(2);
      // The post-erase call must NOT be present — the lifetime ends at the
      // `functions -e ls` command on line 3.
      expect(lines).not.toContain(4);
    });

    // Combined scenario: a top-level `_foo` is referenced by an alias body and
    // then explicitly erased with `functions -e _foo`. After the erase, a new
    // `_foo` is defined inside `main` (an independent symbol) and a `_bar -S`
    // (--no-scope-shadowing) reads/writes `argv`. Verifies:
    //   1. The top-level `_foo`'s references include the alias-body usages
    //      and the erase target, but stop at the `functions -e _foo` line.
    //   2. The nested `_foo` (inside `main`) is its own symbol whose refs
    //      do not bleed back to the top-level def.
    //   3. `argv` inside `set -f argv 1` (the `_bar -S` body) must NOT
    //      resolve to the erased top-level `_foo`'s implicit argv.
    describe('functions -e _foo across an alias and a nested shadow', () => {
      const SOURCE = [
        'function _foo',          // 0
        'end',                    // 1
        '',                       // 2
        "alias b='_foo _foo'",    // 3
        '',                       // 4
        'functions -e _foo',      // 5
        '',                       // 6
        'function main',          // 7
        '    function _foo',      // 8
        '        _bar',           // 9
        '        set --show argv', // 10
        '',                       // 11
        '    end',                // 12
        '',                       // 13
        '    function _bar -S',   // 14
        '        set -f argv 1',  // 15
        '    end',                // 16
        '',                       // 17
        '    _foo',               // 18
        'end',                    // 19
        'main',                   // 20
      ].join('\n');

      it('refs from top-level _foo include alias body + erase, exclude nested + post-erase usages', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-toplevel.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        const topFoo = analyzer.getFlatDocumentSymbols(doc.uri).find(s =>
          s.name === '_foo' && s.isFunction() && !s.parent,
        );
        expect(topFoo).toBeDefined();

        const refs = analyzer.getReferences(doc, topFoo!.selectionRange.start);
        const lines = refs.map(r => r.range.start.line);

        // Def itself + alias body reference + the `functions -e _foo` target.
        expect(lines).toContain(0);
        expect(lines).toContain(3);
        expect(lines).toContain(5);

        // Must NOT include the nested `function _foo` (line 8) — that's its
        // own symbol — or the call to it (line 18), which is past the erase.
        expect(lines).not.toContain(8);
        expect(lines).not.toContain(18);
      });

      it('the nested _foo inside main is an independent symbol with its own refs', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-nested.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        const nestedFoo = analyzer.getFlatDocumentSymbols(doc.uri).find(s =>
          s.name === '_foo' && s.isFunction() && s.parent?.name === 'main',
        );
        expect(nestedFoo).toBeDefined();
        expect(nestedFoo!.selectionRange.start.line).toBe(8);

        const refs = analyzer.getReferences(doc, nestedFoo!.selectionRange.start);
        const lines = refs.map(r => r.range.start.line);

        // Def at line 8 + the call at line 18 — and nothing from the erased
        // top-level `_foo`'s sphere (line 0/3/5).
        expect(lines).toContain(8);
        expect(lines).toContain(18);
        expect(lines).not.toContain(0);
        expect(lines).not.toContain(3);
        expect(lines).not.toContain(5);
      });

      it('goto-definition on the top-level _foo line works pre-erase', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-pre.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        // `alias b='_foo _foo'` — cursor on the first `_foo` (col 10 inside the string)
        const def = analyzer.getDefinition(doc, { line: 3, character: 10 });
        expect(def).toBeDefined();
        expect(def!.name).toBe('_foo');
        expect(def!.selectionRange.start.line).toBe(0);
      });

      it('goto-definition on the post-erase `_foo` call resolves to the nested def, not the erased top-level one', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-post.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        // `    _foo` at line 18 — cursor on `_foo` (col 4-7)
        const def = analyzer.getDefinition(doc, { line: 18, character: 5 });
        expect(def).toBeDefined();
        expect(def!.name).toBe('_foo');
        // Must be the nested def at line 8, not the erased top-level def at line 0.
        expect(def!.selectionRange.start.line).toBe(8);
      });

      // Documents the argv-resolution bug the user flagged:
      //   `set -f argv 1` inside `function _bar -S` (no-scope-shadowing)
      //   should NOT resolve `argv` to the erased top-level `_foo`'s
      //   implicit `argv`. The expected target is either the SET's own
      //   `argv` selection range or — via the no-scope-shadowing walk —
      //   the caller's implicit `argv` (nested `_foo` at line 8).
      it('argv inside `_bar -S` does not resolve to the erased _foo`s implicit argv', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-argv.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        // `        set -f argv 1` — `argv` spans cols 15..18 on line 15
        const def = analyzer.getDefinition(doc, { line: 15, character: 16 });
        expect(def).toBeDefined();
        expect(def!.name).toBe('argv');
        // The forbidden answer is the erased top-level `_foo`'s implicit
        // argv (selRange line 0, parent=`_foo`, no further parent).
        const isErasedFooArgv =
          def!.selectionRange.start.line === 0
          && def!.parent?.name === '_foo'
          && !def!.parent?.parent;
        expect(isErasedFooArgv).toBe(false);
      });
    });

    // Same shape as above, but the no-scope-shadowing chain is two hops deep:
    //   nested `_foo` → `_bar -S` → `_baz -S` → `set -la argv 2`.
    // The erased top-level `_foo` shares a name with the nested `_foo`, so a
    // by-name caller match would land on the wrong (erased) implicit `argv`.
    // The walk must use parent-identity, ending at the nearest non-`-S`
    // ancestor (nested `_foo` at line 8).
    describe('argv via two-hop -S chain with name-shadowed parent', () => {
      const SOURCE = [
        'function _foo',           // 0
        'end',                     // 1
        '',                        // 2
        "alias b='_foo _foo'",     // 3
        '',                        // 4
        'functions -e _foo',       // 5
        '',                        // 6
        'function main',           // 7
        '    function _foo',       // 8
        '        _bar',            // 9
        '        set --show argv', // 10
        '',                        // 11
        '    end',                 // 12
        '',                        // 13
        '    function _bar -S',    // 14
        '        _baz',            // 15
        '',                        // 16
        '    end',                 // 17
        '',                        // 18
        '    function _baz -S',    // 19
        '        set -la argv 2',  // 20
        '    end',                 // 21
        '',                        // 22
        '    _foo',                // 23
        'end',                     // 24
        'main',                    // 25
      ].join('\n');

      it('goto-def on `argv` inside `_baz -S` walks through `_bar -S` to the nested `_foo`s implicit argv', () => {
        const doc = createFakeLspDocument(
          '/tmp/fish-lsp-foo-lifetime-baz-argv.fish',
          SOURCE,
        );
        analyzer.analyze(doc);

        // `        set -la argv 2` — `argv` spans cols 16..19 on line 20
        for (const character of [16, 17, 18, 19]) {
          const def = analyzer.getDefinition(doc, { line: 20, character });
          expect(def).toBeDefined();
          expect(def!.name).toBe('argv');

          // Must NOT resolve to the erased top-level `_foo`'s implicit argv.
          const isErasedFooArgv =
            def!.selectionRange.start.line === 0
            && def!.parent?.name === '_foo'
            && !def!.parent?.parent;
          expect(isErasedFooArgv).toBe(false);

          // Should resolve to the nested `_foo`'s implicit argv (selRange on
          // the nested `function _foo` header, line 8). The nested `_foo`'s
          // parent is `main`, which disambiguates it from the erased top-level
          // `_foo` (which has no parent).
          expect(def!.selectionRange.start.line).toBe(8);
          expect(def!.parent?.name).toBe('_foo');
          expect(def!.parent?.parent?.name).toBe('main');
        }
      });
    });

    // Regression: tree-sitter parses `cmd --flag="value"` as a `concatenation`
    // wrapping a `word("--flag=")` + the quoted string. The flag is a `word`
    // (not an `option`), and `node.parent` is the concatenation rather than
    // the enclosing `command`, so the previous goto-def code (which used
    // `node.parent` + a `text.startsWith(s.argparseFlag)` match) failed to
    // resolve the argparse symbol. The bare-space form `cmd --flag "value"`
    // wasn't affected because tree-sitter emits the flag directly under the
    // `command` node.
    describe('argparse `--flag="value"` (single-token equals form)', () => {
      const testWorkspace = TestWorkspace.create().addFiles({
        relativePath: 'argparse-flag-equals.fish',
        content: [
          'function greet -d "Greet someone by name"',          // 0
          "    argparse 'n/name=' -- $argv",                    // 1
          '    or return 1',                                    // 2
          '',                                                   // 3
          '    not set -ql _flag_name',                         // 4
          '    and set _flag_name "world"',                     // 5
          '',                                                   // 6
          '    echo "Hello, $_flag_name!"',                     // 7
          'end',                                                // 8
          '',                                                   // 9
          'greet --name="fish-lsp user"',                       // 10  equals form
          'greet --name "fish-lsp user"',                       // 11  control: space form
        ].join('\n'),
      }).initialize();

      it('resolves cursor on `--name=` to the argparse `_flag_name` symbol', () => {
        const doc = testWorkspace.getDocument('argparse-flag-equals.fish')!;
        analyzer.analyze(doc);

        // `--name=` spans cols 6..12 (`--name`) + `=` at col 12 (within the
        // word `--name=`, cols 6..13). Every cursor position over those cols
        // should land on `_flag_name`.
        for (const character of [6, 7, 8, 9, 10, 11, 12]) {
          const def = analyzer.getDefinition(doc, { line: 10, character });
          expect(def).toBeDefined();
          expect(def!.name).toBe('_flag_name');
          expect(def!.fishKind).toBe('ARGPARSE');
        }
      });

      it('still resolves cursor on `--name` (space form) — regression guard', () => {
        const doc = testWorkspace.getDocument('argparse-flag-equals.fish')!;
        analyzer.analyze(doc);

        for (const character of [6, 7, 8, 9, 10, 11]) {
          const def = analyzer.getDefinition(doc, { line: 11, character });
          expect(def).toBeDefined();
          expect(def!.name).toBe('_flag_name');
          expect(def!.fishKind).toBe('ARGPARSE');
        }
      });
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
          const result = analyzer.getReferences(confdDoc, getRange(nodeAtPoint).start);
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

  describe.skipIf(!canQueryGlobalCommandLocations)('finding global command\'s location path', () => {
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

  describe('command locs', () => {
    const workspace = TestWorkspace.create()
      .addFiles(
        {
          path: 'conf.d/npm.fish',
          text: [
            'npx',
            'npm',
            'yarn',
          ].join('\n'),
        },
        {
          path: 'functions/yarn.fish',
          text: [
            'function yarn',
            '  echo "yarn from functions"',
            'end',
          ].join('\n'),
        },
      ).initialize();

    it('should find npx location', () => {
      const doc = workspace.getDocument('conf.d/npm.fish')!;
      const npxNode = analyzer.getNodes(doc.uri).find(n => n.type === 'command' && n.text === 'npx');
      const npxDef = analyzer.getDefinition(doc, { line: 0, character: 0 });
      const npxDefLocations = analyzer.getDefinitionLocation(doc, { line: 0, character: 0 });
      expect(npxNode).toBeDefined();
      expect(npxDef === null).toBeTruthy();
      expect(npxDef?.uri).toBeUndefined();
      expect(npxDefLocations).toHaveLength(0);
    });

    it('should find yarn location', () => {
      const doc = workspace.getDocument('conf.d/npm.fish')!;
      const yarnNode = analyzer.getNodes(doc.uri).find(n => n.type === 'command' && n.text === 'yarn');
      const yarnDef = analyzer.getDefinition(doc, { line: 2, character: 0 });
      const yarnDefLocations = analyzer.getDefinitionLocation(doc, { line: 2, character: 0 });
      expect(yarnNode).toBeDefined();
      expect(yarnDef).toBeDefined();
      expect(yarnDef?.uri).toBe(workspace.getDocument('functions/yarn.fish')!.uri);
      expect(yarnDefLocations).toHaveLength(1);
    });

    it("should not find 'echo' location", () => {
      const doc = workspace.getDocument('functions/yarn.fish')!;
      const echoNode = analyzer.getNodes(doc.uri).find(n => n.parent?.type === 'command' && n.text === 'echo');
      const echoDef = analyzer.getDefinition(doc, getRange(echoNode!).start);
      const echoDefLocations = analyzer.getDefinitionLocation(doc, getRange(echoNode!).start);
      console.log({
        echoNode: echoNode ? { type: echoNode.type, text: echoNode.text, startPosition: echoNode.startPosition } : null,
        echoDef: echoDef ? { name: echoDef.name, uri: echoDef.uri, selectionRange: echoDef.selectionRange } : null,
        echoDefLocations: echoDefLocations.map(loc => ({ uri: loc.uri, range: loc.range })),
      });
      expect(echoNode).toBeDefined();
      expect(echoDef === null).toBeTruthy();
      expect(echoDef?.uri).toBeUndefined();
      expect(echoDefLocations).toHaveLength(0);
    });
  });
});

describe('server onDefinition - inline (command-local) variables', () => {
  setLogger();

  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  // `name=value cmd` sets `name` for the lifetime of that single command only
  // (an inline/override variable). A later `$var_a` usage is NOT a reference to
  // it — inline variables are only visible within the command they prefix — so
  // go-to-definition on that later `$var_a` must NOT jump back to the inline
  // definition on the `var_a=(whoami) ls` line.
  const workspace = TestWorkspace.create().addFiles(
    {
      relativePath: 'playground.fish',
      content: [
        '#/tmp/playground.fish',     // 0
        'var_a=(whoami) ls',         // 1  inline (command-local) definition
        '',                          // 2
        "string match -rq '\\d+'",   // 3
        '',                          // 4
        'fish_config theme',         // 5
        '',                          // 6
        '$var_a',                    // 7  bad reference - no definition in scope
        '',                          // 8
        'set -g real_var hello',     // 9  real (global) definition
        'echo $real_var',            // 10 valid reference -> resolves to line 9
      ].join('\n'),
    },
  ).initialize();

  it('does not resolve a later `$var_a` to the inline definition', async () => {
    const doc = workspace.getDocument('playground.fish')!;

    const params: DefinitionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 7, character: 1 }, // inside `var_a` of `$var_a`
    };

    const defs = await server.onDefinition(params);

    // The inline `var_a` definition lives on line 1. It must not be returned as
    // a definition for the out-of-scope `$var_a` on line 7.
    const inlineDefLines = defs.filter(d => d.uri === doc.uri).map(d => d.range.start.line);
    expect(inlineDefLines).not.toContain(1);
    expect(defs).toHaveLength(0);
  });

  // Control: proves the server path is wired up (document registered + analyzed)
  // so the assertion above isn't a false pass from a missing document.
  it('still resolves a real `$real_var` reference through the same server path', async () => {
    const doc = workspace.getDocument('playground.fish')!;

    const params: DefinitionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 10, character: 8 }, // inside `real_var` of `echo $real_var`
    };

    const defs = await server.onDefinition(params);

    const defLines = defs.filter(d => d.uri === doc.uri).map(d => d.range.start.line);
    expect(defLines).toContain(9);
  });

  // The exclusion above is enforced by the inline variable's lifetime ending at
  // the end of the command it prefixes — not merely by scope containment — so
  // every lifetime-aware lookup path drops it. Assert that bound directly.
  it('inline variable lifetime ends at the end of its command', () => {
    const doc = workspace.getDocument('playground.fish')!;
    analyzer.analyze(doc);

    const inlineVar = analyzer
      .getFlatDocumentSymbols(doc.uri)
      .find(s => s.name === 'var_a' && s.fishKind === 'INLINE_VARIABLE')!;
    expect(inlineVar).toBeDefined();

    // Within its command (line 1) the variable is alive; after it (line 7) it
    // is not.
    expect(inlineVar.isWithinDefinitionLifetime({ line: 1, character: 16 }, doc.uri)).toBe(true);
    expect(inlineVar.isWithinDefinitionLifetime({ line: 7, character: 1 }, doc.uri)).toBe(false);
  });
});

// A bare command argument that merely shares a global variable's name is NOT a
// reference to that variable — variables are only referenced via `$var` (or a
// definition name / `set -q/-e/-S` target). Regression for go-to-definition
// jumping from `fish_config theme` to a `set -g theme` definition.
describe('server onDefinition - bare argument matching a global variable name', () => {
  setLogger();

  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  const workspace = TestWorkspace.create().addFiles(
    {
      relativePath: 'conf.d/theme.fish',
      content: [
        'set -gx theme onetheme',   // 0  global variable definition
        'fish_config theme',        // 1  `theme` is a subcommand arg, NOT a ref
        'echo $theme',              // 2  valid reference -> resolves to line 0
      ].join('\n'),
    },
  ).initialize();

  it('does not resolve the `fish_config theme` argument to the `set -gx theme` definition', async () => {
    const doc = workspace.getDocument('conf.d/theme.fish')!;
    const params: DefinitionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 13 }, // inside the `theme` argument
    };

    const defs = await server.onDefinition(params);
    expect(defs).toHaveLength(0);
  });

  it('still resolves a real `$theme` expansion to the `set -gx theme` definition', async () => {
    const doc = workspace.getDocument('conf.d/theme.fish')!;
    const params: DefinitionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 2, character: 7 }, // inside `theme` of `echo $theme`
    };

    const defs = await server.onDefinition(params);
    const defLines = defs.filter(d => d.uri === doc.uri).map(d => d.range.start.line);
    expect(defLines).toContain(0);
  });
});
