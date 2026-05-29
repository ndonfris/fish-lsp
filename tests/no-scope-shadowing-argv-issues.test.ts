import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import TestWorkspace from './test-workspace-utils';

describe('--no-scope-shadowing argv/args scope issues', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  // ISSUE 1: a `set --show args` at program/global scope is incorrectly
  // reported as a reference of the `args` defined inside `main -> _foo`.
  // The inner `args` is local to `_foo` (and shared into the `-S` callees
  // `_bar`/`_baz`), so the outer (file-level) `args` is OUT of scope and
  // must NOT be a reference.
  describe('Issue 1: outer `set --show args` is out of scope', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/main.fish',
      content: [
        'function main',                       // 0
        '    function _foo',                   // 1
        '        set --local args',            // 2  def: args @ col 20
        '        _bar',                        // 3
        '        set --show args',             // 4  usage @ col 19
        '    end',                             // 5
        '',                                    // 6
        '    function _bar -S',                // 7
        '        set -f args 1',               // 8  @ col 15
        '        _baz',                        // 9
        '    end',                             // 10
        '',                                    // 11
        '    function _baz -S',                // 12
        '        set -fa args 2',              // 13 @ col 16
        '    end',                             // 14
        '',                                    // 15
        '    _foo',                            // 16
        '    functions -e _foo _bar _baz',     // 17
        'end',                                 // 18
        'main',                                // 19
        '',                                    // 20
        'set --show args',                     // 21 outer/global @ col 11
      ].join('\n'),
    }).initialize();

    it('references of `_foo.args` exclude the outer `set --show args`', () => {
      const doc = workspace.getDocument('functions/main.fish')!;
      const symbols = analyzer.getFlatDocumentSymbols(doc.uri);
      const argsInFoo = symbols.find(s =>
        s.name === 'args' && s.isVariable() && s.parent?.name === '_foo',
      )!;
      expect(argsInFoo).toBeDefined();

      const refs = analyzer.getReferences(doc, argsInFoo.selectionRange.start);
      const refLines = refs.map(r => r.range.start.line).sort((a, b) => a - b);

      // Should NOT include the outer/global `set --show args` on line 21.
      expect(refLines).not.toContain(21);
      // Should include the in-scope sites: def (2), inner usage (4),
      // and the `-S` callees (8, 13).
      expect(refLines).toContain(2);
    });

    // The actual reported bug: requesting references *from* the outer
    // `set --show args` (line 21) — which has no in-scope definition — must
    // NOT pull in the inner, scoped `_foo`/`_bar`/`_baz` `args` (lines
    // 2/4/8/13). It used to fall into the prebuilt-variable name-match path
    // and return every `args` token in the file.
    it('references from the outer `set --show args` do not include inner-scope args', () => {
      const doc = workspace.getDocument('functions/main.fish')!;
      const refs = analyzer.getReferences(doc, { line: 21, character: 11 });
      const refLines = refs.map(r => r.range.start.line).sort((a, b) => a - b);
      expect(refLines).not.toContain(2);
      expect(refLines).not.toContain(4);
      expect(refLines).not.toContain(8);
      expect(refLines).not.toContain(13);
    });

    it('goto-definition from the outer `set --show args` does not resolve into _foo', () => {
      const doc = workspace.getDocument('functions/main.fish')!;
      // outer `set --show args` -> `args` token at line 21, col 11
      const locs = analyzer.getDefinitionLocation(doc, { line: 21, character: 11 });
      // The outer args has no in-scope definition; it must not point at _foo's
      // line-2 definition.
      expect(locs.every(l => l.range.start.line !== 2)).toBe(true);
    });
  });

  // ISSUE 2: in a script file, `main` defines its own local `argv`
  // (`set -l argv`). The `-S` callees `_A`/`_B`/`_C` share main's scope, so
  // `argv` inside them must resolve UP to main's `set -l argv` (line 2), not
  // to the implicit file-global `$argv`.
  describe('Issue 2: script-local argv resolves through -S chain to main', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'foo.fish',
      content: [
        'function main',                 // 0
        '    set --show argv',           // 1
        '    set -l argv',               // 2  def: argv @ col 11
        '    _A',                        // 3
        '    set --show argv',           // 4
        'end',                           // 5
        '',                              // 6
        'function _A -S',                // 7
        '    set -fa argv 1',            // 8  @ col 12
        '    _B',                        // 9
        'end',                           // 10
        '',                              // 11
        'function _B -S',                // 12
        '    set -fa argv 2',            // 13 @ col 12
        '    _C',                        // 14
        'end',                           // 15
        '',                              // 16
        'function _C -S',                // 17
        '    set -fa argv 3',            // 18 @ col 12
        'end',                           // 19
        '',                              // 20
        'main',                          // 21
      ].join('\n'),
    }).initialize();

    // The cursor's `argv` resolves up the -S chain to main. The acceptable
    // target is main's own `argv` — either the `set -l argv` write (line 2)
    // or the function header's implicit `argv` (line 0, char 9). It must NOT
    // be the script's file-level `argv` at {0,0}, which represents the
    // *script's* arguments, a distinct variable from main's `$argv`.
    const resolvesToMainArgv = (loc: { line: number; character: number; }) => {
      const isFileGlobal = loc.line === 0 && loc.character === 0;
      const isMainHeader = loc.line === 0 && loc.character === 9;
      const isMainSet = loc.line === 2;
      return !isFileGlobal && (isMainHeader || isMainSet);
    };

    it('goto-definition of `argv` inside _A resolves to main, not file-global', () => {
      const doc = workspace.getDocument('foo.fish')!;
      const locs = analyzer.getDefinitionLocation(doc, { line: 8, character: 12 });
      expect(locs).toHaveLength(1);
      expect(resolvesToMainArgv(locs[0]!.range.start)).toBe(true);
    });

    it('goto-definition of `argv` inside _B resolves to main, not file-global', () => {
      const doc = workspace.getDocument('foo.fish')!;
      const locs = analyzer.getDefinitionLocation(doc, { line: 13, character: 12 });
      expect(locs).toHaveLength(1);
      expect(resolvesToMainArgv(locs[0]!.range.start)).toBe(true);
    });

    it('goto-definition of `argv` inside _C resolves to main, not file-global', () => {
      const doc = workspace.getDocument('foo.fish')!;
      const locs = analyzer.getDefinitionLocation(doc, { line: 18, character: 12 });
      expect(locs).toHaveLength(1);
      expect(resolvesToMainArgv(locs[0]!.range.start)).toBe(true);
    });

    it('goto-definition of main `set -l argv` resolves within main, not file-global', () => {
      const doc = workspace.getDocument('foo.fish')!;
      const locs = analyzer.getDefinitionLocation(doc, { line: 2, character: 11 });
      expect(locs).toHaveLength(1);
      expect(resolvesToMainArgv(locs[0]!.range.start)).toBe(true);
    });
  });

  // Regression guard for the owning-function-identity scope rule: a nested
  // function declaring `--inherit-variable var` shares the *enclosing*
  // function's `var`. This is resolved by the dedicated inherit-variable path
  // (not by scope-containment equality), so the owner rule must not disturb
  // it: `$var` inside the inner function still resolves to the outer
  // `set -l var 1`.
  describe('nested --inherit-variable resolves to the enclosing definition', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/foo.fish',
      content: [
        'function foo',                          // 0
        '    set -l var 1',                      // 1  def @ col 11
        '    function bar --inherit-variable var', // 2
        '        set -a var 2',                  // 3
        '        echo $var',                     // 4  usage @ col 14
        '    end',                               // 5
        '    bar',                               // 6
        'end',                                   // 7
      ].join('\n'),
    }).initialize();

    it('goto-definition of `$var` in bar resolves to foo `set -l var 1`', () => {
      const doc = workspace.getDocument('functions/foo.fish')!;
      const locs = analyzer.getDefinitionLocation(doc, { line: 4, character: 14 });
      expect(locs).toHaveLength(1);
      expect(locs[0]!.range.start.line).toBe(1);
    });
  });
});
