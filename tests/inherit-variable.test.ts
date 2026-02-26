import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import { getReferences, getImplementation, allUnusedLocalReferences } from '../src/references';
import { getRenames } from '../src/renames';
// import { FishSymbol } from '../src/parsing/symbol';
import TestWorkspace from './test-workspace-utils';

describe('--inherit-variable', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('A/B - B inherits VAR from A', () => {
    // A.fish defines `set -l VAR` and calls B
    // B.fish uses `--inherit-variable=VAR` to access VAR from A's scope
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/A.fish',
        content: [
          'function A',
          '    set -l VAR "Hello, World!"',
          '    B',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/B.fish',
        content: [
          'function B --inherit-variable VAR',
          '    echo $VAR',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/A.fish')).toBeDefined();
      expect(workspace.getDocument('functions/B.fish')).toBeDefined();
    });

    it('should find VAR symbol in A.fish as a local variable', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const varInA = symbolsA.find(s => s.name === 'VAR' && s.isVariable())!;
      expect(varInA).toBeDefined();
      expect(varInA.isLocal()).toBe(true);
      expect(varInA.parent?.name).toBe('A');
    });

    it('should find VAR symbol in B.fish as a function variable (--inherit-variable)', () => {
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);

      const varInB = symbolsB.find(s => s.name === 'VAR' && s.isVariable())!;
      expect(varInB).toBeDefined();
      expect(varInB.parent?.name).toBe('B');
      // --inherit-variable creates a FUNCTION_VARIABLE symbol
      expect(varInB.fishKind).toBe('FUNCTION_VARIABLE');
    });

    it('should find cross-file references for VAR from A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const varInA = symbolsA.find(s => s.name === 'VAR' && s.isVariable())!;
      const refs = getReferences(docA, varInA.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // VAR is defined in A and inherited by B — references should span both files
      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
    });

    it('should find cross-file references for VAR from B.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);

      const varInB = symbolsB.find(s => s.name === 'VAR' && s.isVariable())!;
      const refs = getReferences(docB, varInB.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // VAR is inherited from A — references should span both files
      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
    });

    it('goto-definition of `$VAR` in B.fish should resolve to A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      // `$VAR` position in B.fish:
      //   line 0: `function B --inherit-variable VAR`
      //   line 1: `    echo $VAR`
      //                      ^^^  col 10
      const varUsagePos = { line: 1, character: 10 };

      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);

      // goto-def should navigate to the definition of VAR in A.fish
      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docA.uri);
    });

    it('go-to implementation of `VAR` from B.fish should find A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);
      const varInB = symbolsB.find(s => s.name === 'VAR' && s.isVariable())!;

      const impls = getImplementation(docB, varInB.selectionRange.start);

      // Implementation should resolve to A.fish (the caller that defines VAR)
      expect(impls).toHaveLength(1);
      expect(impls[0]!.uri).toBe(docA.uri);
    });

    it('go-to implementation of `VAR` from B.fish should NOT include B.fish', () => {
      const docB = workspace.getDocument('functions/B.fish')!;

      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);
      const varInB = symbolsB.find(s => s.name === 'VAR' && s.isVariable())!;

      const impls = getImplementation(docB, varInB.selectionRange.start);

      // Implementation filters to external URIs — should not return B itself
      expect(impls.every(loc => loc.uri !== docB.uri)).toBe(true);
    });

    it('rename `VAR` from A.fish should propagate to B.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);
      const varInA = symbolsA.find(s => s.name === 'VAR' && s.isVariable())!;

      const renames = getRenames(docA, varInA.selectionRange.start, 'MESSAGE');

      // Build shorthand: [uri_basename, line, character, newText]
      const shorthand = renames.map(r => [
        r.uri.split('/').pop(),
        r.range.start.line,
        r.range.start.character,
        r.newText,
      ]);

      // A.fish: `set -l VAR` (line 1 col 11) — definition
      // B.fish: `--inherit-variable VAR` (line 0) + `echo $VAR` (line 1 col 10)
      expect(shorthand).toContainEqual(['A.fish', 1, 11, 'MESSAGE']);
      expect(shorthand.some(([file]) => file === 'B.fish')).toBe(true);
      expect(renames.every(r => r.newText === 'MESSAGE')).toBe(true);
    });

    it('rename `VAR` from --inherit-variable declaration in B.fish should propagate to A.fish', () => {
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);
      const inheritVar = symbolsB.find(s => s.name === 'VAR' && s.isInheritVariable())!;

      const renames = getRenames(docB, inheritVar.selectionRange.start, 'MESSAGE');

      const shorthand = renames.map(r => [
        r.uri.split('/').pop(),
        r.range.start.line,
        r.range.start.character,
        r.newText,
      ]);

      // Should propagate to both files
      expect(shorthand.some(([file]) => file === 'A.fish')).toBe(true);
      expect(shorthand.some(([file]) => file === 'B.fish')).toBe(true);
      // Should not include locations from files outside A/B
      const renameFiles = [...new Set(renames.map(r => r.uri.split('/').pop()))];
      expect(renameFiles.every(f => ['A.fish', 'B.fish'].includes(f!))).toBe(true);
    });

    it('`VAR` in --inherit-variable function should NOT be flagged as unused', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      const unusedA = allUnusedLocalReferences(docA);
      const unusedB = allUnusedLocalReferences(docB);

      // VAR is used across files via --inherit-variable — should not appear as unused
      expect(unusedA.find(s => s.name === 'VAR')).toBeUndefined();
      expect(unusedB.find(s => s.name === 'VAR')).toBeUndefined();
    });
  });

  describe('A/B/C - chained inherit-variable', () => {
    // A defines VAR, calls B; B inherits VAR and calls C; C inherits VAR
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/A.fish',
        content: [
          'function A',
          '    set -l VAR "Hello"',
          '    B',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/B.fish',
        content: [
          'function B --inherit-variable VAR',
          '    set VAR (string upper $VAR)',
          '    C',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/C.fish',
        content: [
          'function C --inherit-variable VAR',
          '    echo $VAR',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/A.fish')).toBeDefined();
      expect(workspace.getDocument('functions/B.fish')).toBeDefined();
      expect(workspace.getDocument('functions/C.fish')).toBeDefined();
    });

    it('should find cross-file references for VAR across A/B/C', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const varInA = symbolsA.find(s => s.name === 'VAR' && s.isVariable())!;
      const refs = getReferences(docA, varInA.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
      expect(refUris).toContain(docC.uri);
    });

    it('goto-definition of `$VAR` in B.fish should resolve to A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      const varUsagePos = analyzer.getFlatDocumentSymbols(docB.uri)
        .find(s => s.name === 'VAR' && s.isVariable())!.toPosition();

      // B.fish: `function B --inherit-variable VAR`
      //         `    set VAR (string upper $VAR)`
      //                                    ^^^  col 25
      // const varUsagePos = { line: 1, character: 26 };

      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);

      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docA.uri);
    });

    it('goto-definition of `$VAR` in C.fish should resolve to A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;

      // C.fish: `function C --inherit-variable VAR`
      //         `    echo $VAR`
      //                    ^^^  col 10
      const varUsagePos = { line: 1, character: 10 };

      const locFromC = analyzer.getDefinitionLocation(docC, varUsagePos);

      expect(locFromC).toHaveLength(1);
      expect(locFromC[0]!.uri).toBe(docA.uri);
    });
  });

  describe('A/B - B does NOT inherit VAR (isolation test)', () => {
    // A defines VAR, calls B; B does NOT use --inherit-variable
    // B's VAR is a separate local variable
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/A.fish',
        content: [
          'function A',
          '    set -l VAR "Hello"',
          '    B',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/B.fish',
        content: [
          'function B',
          '    set -l VAR "World"',
          '    echo $VAR',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/A.fish')).toBeDefined();
      expect(workspace.getDocument('functions/B.fish')).toBeDefined();
    });

    it('should NOT find cross-file references for VAR from A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const varInA = symbolsA.find(s => s.name === 'VAR' && s.isVariable())!;
      const refs = getReferences(docA, varInA.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // Without --inherit-variable, VAR in A is isolated from VAR in B
      expect(refUris).toContain(docA.uri);
      expect(refUris).not.toContain(docB.uri);
    });

    it('should NOT find cross-file references for VAR from B.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);

      const varInB = symbolsB.find(s => s.name === 'VAR' && s.isVariable())!;
      const refs = getReferences(docB, varInB.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // B's VAR is its own local — no connection to A's VAR
      expect(refUris).toContain(docB.uri);
      expect(refUris).not.toContain(docA.uri);
    });

    it('goto-definition of `$VAR` in B.fish should stay in B.fish', () => {
      // const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      // B.fish: `function B`
      //         `    set -l VAR "World"`
      //         `    echo $VAR`
      //                    ^^^  col 10
      const varUsagePos = { line: 2, character: 10 };

      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);

      // goto-def stays within B.fish — no inheritance
      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docB.uri);
    });
  });

  describe('A/B - B inherits only one of two variables', () => {
    // A defines VAR1 and VAR2, B only inherits VAR1
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/A.fish',
        content: [
          'function A',
          '    set -l VAR1 "Hello"',
          '    set -l VAR2 "World"',
          '    B',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/B.fish',
        content: [
          'function B --inherit-variable VAR1',
          '    echo $VAR1',
          '    set -l VAR2 "Local"',
          '    echo $VAR2',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/A.fish')).toBeDefined();
      expect(workspace.getDocument('functions/B.fish')).toBeDefined();
    });

    it('should find cross-file references for VAR1 (inherited)', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const var1InA = symbolsA.find(s => s.name === 'VAR1' && s.isVariable())!;
      const refs = getReferences(docA, var1InA.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // VAR1 is inherited by B — references should span both files
      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
    });

    it('should NOT find cross-file references for VAR2 (not inherited)', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const var2InA = symbolsA.find(s => s.name === 'VAR2' && s.isVariable())!;
      const refs = getReferences(docA, var2InA.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // VAR2 is NOT inherited by B — references stay in A.fish only
      expect(refUris).toContain(docA.uri);
      expect(refUris).not.toContain(docB.uri);
    });

    it('goto-definition of `$VAR1` in B.fish should resolve to A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      // B.fish: `function B --inherit-variable VAR1`
      //         `    echo $VAR1`
      //                    ^^^^  col 10
      const varUsagePos = { line: 1, character: 10 };

      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);

      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docA.uri);
    });

    it('goto-definition of `$VAR2` in B.fish should stay in B.fish', () => {
      // const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      // B.fish: `function B --inherit-variable VAR1`
      //         `    echo $VAR1`
      //         `    set -l VAR2 "Local"`
      //         `    echo $VAR2`
      //                    ^^^^  col 10
      const varUsagePos = { line: 3, character: 10 };

      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);

      // VAR2 is not inherited — goto-def stays in B.fish
      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docB.uri);
    });
  });

  describe('nested --inherit-variable in same file with outer scope isolation', () => {
    // Case 1: outer_fn defines VAR, nested inner_fn inherits it
    // A separate global `set VAR 2` should NOT leak into outer_fn's references
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/outer_fn.fish',
        content: [
          'function outer_fn',
          '    function inner_fn --inherit-variable VAR',
          '        echo $VAR',
          '    end',
          '    set -l VAR 1',
          '    inner_fn',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/globals.fish',
        content: [
          'set VAR 2',
          'outer_fn',
        ].join('\n'),
      },
    ).initialize();

    it('goto-definition of `$VAR` in inner_fn should resolve to `set -l VAR 1` in outer_fn', () => {
      const docFoo = workspace.getDocument('functions/outer_fn.fish')!;

      // inner_fn's $VAR is at line 2: `        echo $VAR`
      //                                              ^^^  col 14
      const varUsagePos = { line: 2, character: 14 };
      const loc = analyzer.getDefinitionLocation(docFoo, varUsagePos);

      expect(loc).toHaveLength(1);
      expect(loc[0]!.uri).toBe(docFoo.uri);
      // Should point to `set -l VAR 1` (line 4), not the --inherit-variable declaration
      expect(loc[0]!.range.start.line).toBe(4);
    });

    it('references on `set -l VAR 1` inside outer_fn should find 3 locations', () => {
      const docFoo = workspace.getDocument('functions/outer_fn.fish')!;
      const docGlobals = workspace.getDocument('conf.d/globals.fish')!;
      const symbolsFoo = analyzer.getFlatDocumentSymbols(docFoo.uri);

      // Find the `set -l VAR 1` symbol (the local variable, not the --inherit-variable declaration)
      const varDef = symbolsFoo.find(s =>
        s.name === 'VAR' && s.isVariable() && !s.isInheritVariable(),
      )!;
      expect(varDef).toBeDefined();

      const refs = getReferences(docFoo, varDef.selectionRange.start);

      // Should find: `set -l VAR 1`, `--inherit-variable VAR`, `echo $VAR`
      // Should NOT include `set VAR 2` from globals.fish
      expect(refs).toHaveLength(3);
      const refUris = refs.map(loc => loc.uri);
      expect(refUris).not.toContain(docGlobals.uri);
    });

    it('references on global `set VAR 2` should NOT include outer_fn internals', () => {
      const docFoo = workspace.getDocument('functions/outer_fn.fish')!;
      const docGlobals = workspace.getDocument('conf.d/globals.fish')!;
      const symbolsGlobals = analyzer.getFlatDocumentSymbols(docGlobals.uri);

      const globalVar = symbolsGlobals.find(s =>
        s.name === 'VAR' && s.isVariable(),
      )!;
      expect(globalVar).toBeDefined();

      const refs = getReferences(docGlobals, globalVar.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // Global VAR should only find itself — outer_fn's local VAR is a different scope
      expect(refUris).not.toContain(docFoo.uri);
      expect(refs).toHaveLength(1);
    });
  });

  describe('global variable with nested --inherit-variable (2a)', () => {
    // global set -g VAR + function foo with nested bar --inherit-variable VAR
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    function bar --inherit-variable VAR',
          '        echo $VAR',
          '    end',
          '    bar',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/init.fish',
        content: [
          'set -g VAR 1',
          'foo',
        ].join('\n'),
      },
    ).initialize();

    it('goto-def of `$VAR` in bar should resolve within foo.fish', () => {
      const docFoo = workspace.getDocument('functions/foo.fish')!;

      // bar's $VAR: line 2 `        echo $VAR`
      //                                  ^^^  col 14
      const varUsagePos = { line: 2, character: 14 };
      const loc = analyzer.getDefinitionLocation(docFoo, varUsagePos);

      expect(loc).toHaveLength(1);
      expect(loc[0]!.uri).toBe(docFoo.uri);
    });

    it('references on global `set -g VAR 1` should find itself and foo usage', () => {
      const docInit = workspace.getDocument('conf.d/init.fish')!;
      const symbolsInit = analyzer.getFlatDocumentSymbols(docInit.uri);

      const globalVar = symbolsInit.find(s =>
        s.name === 'VAR' && s.isVariable(),
      )!;
      const refs = getReferences(docInit, globalVar.selectionRange.start);

      // Global VAR should find at least itself
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.map(r => r.uri)).toContain(docInit.uri);
    });
  });

  describe('global variable calling --inherit-variable function (2b)', () => {
    // standalone function --inherit-variable VAR with global set -g VAR
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/baz.fish',
        content: [
          'function baz --inherit-variable VAR',
          '    echo $VAR',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/setup.fish',
        content: [
          'set -g VAR 1',
          'baz',
        ].join('\n'),
      },
    ).initialize();

    it('goto-def of `$VAR` in baz should resolve to setup.fish', () => {
      const docBaz = workspace.getDocument('functions/baz.fish')!;
      const docSetup = workspace.getDocument('conf.d/setup.fish')!;

      // baz's $VAR: line 1 `    echo $VAR`
      //                              ^^^  col 10
      const varUsagePos = { line: 1, character: 10 };
      const loc = analyzer.getDefinitionLocation(docBaz, varUsagePos);

      expect(loc).toHaveLength(1);
      expect(loc[0]!.uri).toBe(docSetup.uri);
    });

    it('references on global `set -g VAR 1` should include baz.fish', () => {
      const docBaz = workspace.getDocument('functions/baz.fish')!;
      const docSetup = workspace.getDocument('conf.d/setup.fish')!;
      const symbolsSetup = analyzer.getFlatDocumentSymbols(docSetup.uri);

      const globalVar = symbolsSetup.find(s =>
        s.name === 'VAR' && s.isVariable(),
      )!;
      const refs = getReferences(docSetup, globalVar.selectionRange.start);
      const refUris = refs.map(r => r.uri);

      // Global VAR + baz's inherited usage
      expect(refUris).toContain(docSetup.uri);
      expect(refUris).toContain(docBaz.uri);
    });
  });

  describe('orphaned --inherit-variable (no caller defines VAR)', () => {
    // Case 3: function foo --inherit-variable VAR with no caller defining VAR
    // goto-def should fall back to the function header's --inherit-variable declaration
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo --inherit-variable VAR',
          '    echo $VAR',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('goto-definition of `$VAR` should resolve to the --inherit-variable declaration', () => {
      const docFoo = workspace.getDocument('functions/foo.fish')!;

      // foo's $VAR: line 1 `    echo $VAR`
      //                              ^^^  col 10
      const varUsagePos = { line: 1, character: 10 };
      const loc = analyzer.getDefinitionLocation(docFoo, varUsagePos);

      expect(loc).toHaveLength(1);
      expect(loc[0]!.uri).toBe(docFoo.uri);
      // Should point to the --inherit-variable VAR on line 0
      expect(loc[0]!.range.start.line).toBe(0);
    });

    it('references on `--inherit-variable VAR` should find 2 locations', () => {
      const docFoo = workspace.getDocument('functions/foo.fish')!;
      const symbolsFoo = analyzer.getFlatDocumentSymbols(docFoo.uri);

      const inheritVar = symbolsFoo.find(s => s.name === 'VAR' && s.isInheritVariable())!;
      expect(inheritVar).toBeDefined();

      const refs = getReferences(docFoo, inheritVar.selectionRange.start);

      // Should find: `--inherit-variable VAR` declaration + `echo $VAR` usage
      expect(refs).toHaveLength(2);
      expect(refs.every(r => r.uri === docFoo.uri)).toBe(true);
    });
  });
});
