import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import TestWorkspace from './test-workspace-utils';

// Regression: a bare-word VALUE in a `set` command must NOT be treated as a
// reference to a same-named variable. Only `$var` expansions / `variable_name`
// nodes are references in `set NAME VALUE...`, plus bare names passed to the
// reference-taking forms `set -q/--query`, `set -e/--erase`, `set -S/--show`.
//
//   set -gx foo
//   set -gx bar $foo foo   #  $foo -> ref ; bare `foo` -> NOT a ref
//   set -l bar foo[1]      #  foo[1] value -> NOT a ref
//   set -q bar foo         #  foo -> ref (query takes bare names)
//   set -e foo             #  foo -> ref (erase takes bare names)
//   set --show foo         #  foo -> ref (show takes bare names)
describe('variable definition cmd\'s value references', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  function refsOf(rel: string, ws: TestWorkspace, line: number, character: number): Set<string> {
    const doc = ws.getDocument(rel)!;
    const refs = analyzer.getReferences(doc, { line, character });
    return new Set(refs.map(r => `${r.range.start.line}:${r.range.start.character}`));
  }

  describe('set', () => {
    describe('bare value words are not references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo',            // 0  def: foo @ 8
          'set -gx bar $foo foo',   // 1  $foo name @ 13 (ref) ; bare foo @ 17 (NOT)
        ].join('\n'),
      }).initialize();

      it('`$foo` expansion is a reference, bare `foo` value is not', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('0:8')).toBe(true);   // definition
        expect(refs.has('1:13')).toBe(true);  // $foo expansion
        expect(refs.has('1:17')).toBe(false); // bare value word — regression
        expect([...refs]).toHaveLength(2);
      });
    });

    describe('indexed value words (`foo[1]`) are not references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo',                // 0  def @ 8
          'set -l bar foo[1] foo[2]',   // 1  foo[1] @ 11, foo[2] @ 18 — both NOT refs
        ].join('\n'),
      }).initialize();

      it('does not treat `foo[1]` / `foo[2]` values as references', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('0:8')).toBe(true);
        expect(refs.has('1:11')).toBe(false);
        expect(refs.has('1:18')).toBe(false);
        expect([...refs]).toHaveLength(1);
      });
    });

    describe('definition names (plain and indexed) are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo',        // 0  def @ 8
          'set -gx foo A B C',  // 1  redefinition name @ 8 (ref)
          'set -gx foo[4] D',   // 2  indexed write name @ 8 (ref)
        ].join('\n'),
      }).initialize();

      it('includes `set foo …` and `set foo[4] …` definition names', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:8')).toBe(true);
        expect(refs.has('2:8')).toBe(true);
      });
    });

    describe('variable expansions (including indexed) are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo',              // 0  def @ 8
          'set bar $foo[1] $foo[2]',  // 1  $foo[1] name @ 9, $foo[2] name @ 17
        ].join('\n'),
      }).initialize();

      it('includes `$foo[1]` and `$foo[2]` value expansions', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:9')).toBe(true);
        expect(refs.has('1:17')).toBe(true);
        expect([...refs]).toHaveLength(3);
      });
    });

    describe('`set -q/--query` bare-name targets are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo',          // 0  def @ 8
          'set -q bar foo',       // 1  foo @ 11 (query target -> ref)
          'set -q foo[1] foo[4]', // 2  foo @ 7 and @ 14 (query targets -> refs)
        ].join('\n'),
      }).initialize();

      it('includes bare names and indexed names passed to `set -q`', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:11')).toBe(true);
        expect(refs.has('2:7')).toBe(true);
        expect(refs.has('2:14')).toBe(true);
        expect([...refs]).toHaveLength(4);
      });
    });

    describe('`set -e/--erase` bare-name targets are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo A',  // 0  def @ 8
          'set -e foo',     // 1  foo @ 7 (erase target -> ref)
        ].join('\n'),
      }).initialize();

      it('includes the bare name passed to `set -e`', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:7')).toBe(true);
        expect([...refs]).toHaveLength(2);
      });
    });

    describe('`set -S/--show` bare-name targets are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo A',   // 0  def @ 8
          'set --show foo',  // 1  foo @ 11 (show target -> ref)
        ].join('\n'),
      }).initialize();

      it('includes the bare name passed to `set --show`', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:11')).toBe(true);
        expect([...refs]).toHaveLength(2);
      });
    });
  });

  // `read` has no bare-name reference-target forms (no -q/-e/-S). The only
  // references in a `read` command are `$var` expansions and the read
  // definition-name targets. Flag VALUES (-p/-d/-n/-c/-P/-R/--delimiter …) are
  // literals, NOT references.
  describe('read', () => {
    describe('flag-argument values are not references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo bar',        // 0  def @ 8
          'read -p foo a',          // 1  prompt value foo @ 8     -> NOT ref
          'read -d foo b',          // 2  delimiter value foo @ 8  -> NOT ref
          'read -n foo c',          // 3  nchars value foo @ 8     -> NOT ref
          'read -P foo e',          // 4  prompt-str value foo @ 8 -> NOT ref
          'read -R foo f',          // 5  right-prompt value foo @ 8 -> NOT ref
          'read --delimiter foo h', // 6  delimiter value foo @ 17 -> NOT ref
        ].join('\n'),
      }).initialize();

      it('does not treat read flag VALUES as references', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('0:8')).toBe(true); // definition only
        expect([...refs]).toHaveLength(1);
      });
    });

    describe('$var expansions in read are references', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo bar',  // 0  def @ 8
          'read -p "$foo" g', // 1  $foo name @ 10 -> ref
        ].join('\n'),
      }).initialize();

      it('includes the `$foo` expansion in a read flag value', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:10')).toBe(true);
        expect([...refs]).toHaveLength(2);
      });
    });

    describe('`read foo` redefinition target is a reference', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: ['set -gx foo bar', 'read foo', 'echo $foo'].join('\n'),
      }).initialize();

      it('the read target and later `$foo` are references', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect(refs.has('1:5')).toBe(true); // read target
        expect(refs.has('2:6')).toBe(true); // $foo
        expect([...refs]).toHaveLength(3);
      });
    });

    describe('`read -l foo` shadows the global', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: ['set -gx foo bar', 'read -l foo', 'echo $foo'].join('\n'),
      }).initialize();

      it('the shadowing local read target is not a reference to the global', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        expect([...refs]).toHaveLength(1); // only the global def
        const localRefs = refsOf('config.fish', ws, 1, 8);
        expect(localRefs.has('1:8')).toBeTruthy();
        expect(localRefs.has('2:6')).toBeTruthy();
        expect([...localRefs]).toHaveLength(2);
      });
    });

    describe('extra `-l` vs `-g` shadowing tests', () => {
      const ws = TestWorkspace.create().addFiles({
        relativePath: 'config.fish',
        content: [
          'set -gx foo 1 2 3',
          '#       ^^^----------------------- global foo',
          'echo $foo \'4\' | read -a -l foo',
          '#     ^^^ ------------------------ global foo',
          '#                          ^^^---- local foo',
          'echo "foo: $foo"',
          '#           ^^^------------------- local foo',
          'set --show foo',
          '#          ^^^-------------------- local foo',
          'set -el foo',
          '#       ^^^----------------------- local foo',
          '',
          'set --show foo',
          '#          ^^^ go to definition line 0 global foo',
        ].join('\n'),
      }).initialize();

      it('global `foo`', () => {
        const refs = refsOf('config.fish', ws, 0, 8);
        // console.log({globalRefs: refs})
        expect(refs.has('0:8')).toBeTruthy();
        expect(refs.has('2:6')).toBeTruthy();
        expect(refs.has('12:11')).toBeTruthy();
        expect([...refs]).toHaveLength(3);
      });

      it('local `foo`', () => {
        const refs = refsOf('config.fish', ws, 2, 27);
        // console.log({localRefs: refs})
        expect(refs.has('2:27')).toBeTruthy();
        expect(refs.has('5:12')).toBeTruthy();
        expect(refs.has('7:11')).toBeTruthy();
        expect(refs.has('9:8')).toBeTruthy();
        expect([...refs]).toHaveLength(4);
      });
    });
  });
});
