import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import { getReferences, getImplementation, allUnusedLocalReferences } from '../src/references';
import { getRenames } from '../src/renames';
// import { FishSymbol } from '../src/parsing/symbol';
import TestWorkspace from './test-workspace-utils';

describe('--no-scope-shadowing', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('A/B/C - all using --no-scope-shadowing', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/A.fish',
        content: [
          'function A --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    B',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/B.fish',
        content: [
          'function B --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    C',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/C.fish',
        content: [
          'function C --no-scope-shadowing',
          '    set var (math $var + 1)',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/A.fish')).toBeDefined();
      expect(workspace.getDocument('functions/B.fish')).toBeDefined();
      expect(workspace.getDocument('functions/C.fish')).toBeDefined();
    });

    it('should determine A/B/C function symbols with --no-scope-shadowing', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;

      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);
      const symbolsC = analyzer.getFlatDocumentSymbols(docC.uri);

      // Each file should have a function symbol as the top-level symbol
      const funcA = symbolsA.find(s => s.name === 'A' && s.isFunction());
      const funcB = symbolsB.find(s => s.name === 'B' && s.isFunction());
      const funcC = symbolsC.find(s => s.name === 'C' && s.isFunction());

      expect(funcA).toBeDefined();
      expect(funcB).toBeDefined();
      expect(funcC).toBeDefined();

      // All three functions should have --no-scope-shadowing
      expect(funcA!.isFunctionWithNoScopeShadowing()).toBe(true);
      expect(funcB!.isFunctionWithNoScopeShadowing()).toBe(true);
      expect(funcC!.isFunctionWithNoScopeShadowing()).toBe(true);

      // Each function should contain a 'var' variable symbol as a child
      const varInA = symbolsA.find(s => s.name === 'var' && s.isVariable());
      const varInB = symbolsB.find(s => s.name === 'var' && s.isVariable());
      const varInC = symbolsC.find(s => s.name === 'var' && s.isVariable());

      expect(varInA).toBeDefined();
      expect(varInB).toBeDefined();
      expect(varInC).toBeDefined();

      // var symbols should be children of their respective function symbols
      expect(varInA!.parent?.name).toBe('A');
      expect(varInB!.parent?.name).toBe('B');
      expect(varInC!.parent?.name).toBe('C');
    });

    it('should populate analyzer.noScopeShadowing cache with A/B/C', () => {
      // All three functions should be in the noScopeShadowing cache
      expect(analyzer.noScopeShadowing.has('A')).toBe(true);
      expect(analyzer.noScopeShadowing.has('B')).toBe(true);
      expect(analyzer.noScopeShadowing.has('C')).toBe(true);

      // Each should have exactly one entry
      expect(analyzer.noScopeShadowing.find('A')).toHaveLength(1);
      expect(analyzer.noScopeShadowing.find('B')).toHaveLength(1);
      expect(analyzer.noScopeShadowing.find('C')).toHaveLength(1);

      // The cached symbols should be function symbols with --no-scope-shadowing
      const cachedA = analyzer.noScopeShadowing.findFirst('A')!;
      const cachedB = analyzer.noScopeShadowing.findFirst('B')!;
      const cachedC = analyzer.noScopeShadowing.findFirst('C')!;
      expect(cachedA.isFunctionWithNoScopeShadowing()).toBe(true);
      expect(cachedB.isFunctionWithNoScopeShadowing()).toBe(true);
      expect(cachedC.isFunctionWithNoScopeShadowing()).toBe(true);
    });

    it('should locate `var` definition position inside function A', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      // Find the `var` variable symbol inside function A
      const varInA = symbolsA.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInA).toBeDefined();

      // `set var (math $var + 1)` is on line 1, `var` starts at column 8
      //   line 0: `function A --no-scope-shadowing`
      //   line 1: `    set var (math $var + 1)`
      //                   ^^^
      const varPosition = varInA.selectionRange.start;
      expect(varPosition.line).toBe(1);
      expect(varPosition.character).toBe(8);

      // The variable's parent should be function A
      expect(varInA.parent?.name).toBe('A');
      expect(varInA.parent?.isFunctionWithNoScopeShadowing()).toBe(true);
    });

    it('should find cross-file references for `var` across A/B/C', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);

      const varInA = symbolsA.find(s => s.name === 'var' && s.isVariable())!;
      const varPosition = varInA.selectionRange.start;

      const refs = getReferences(docA, varPosition);
      const refUris = refs.map(loc => loc.uri);

      // References should span across all three files
      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
      expect(refUris).toContain(docC.uri);

      // Each file has `set var ...` (definition) and `$var` (usage) = 2 refs per file = 6 total
      expect(refs.length).toBeGreaterThanOrEqual(6);
    });

    it('should find cross-file references for `var` when queried from B.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;
      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);

      const varInB = symbolsB.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInB).toBeDefined();
      expect(varInB.parent?.name).toBe('B');
      expect(varInB.parent?.isFunctionWithNoScopeShadowing()).toBe(true);

      const varPosition = varInB.selectionRange.start;
      const refs = getReferences(docB, varPosition);
      const refUris = refs.map(loc => loc.uri);

      // References should span across all three files (same as querying from A)
      expect(refUris).toContain(docA.uri);
      expect(refUris).toContain(docB.uri);
      expect(refUris).toContain(docC.uri);

      // Each file has `set var ...` (definition) and `$var` (usage) = 2 refs per file = 6 total
      expect(refs.length).toBeGreaterThanOrEqual(6);
    });

    it('goto-definition of `$var` from A/B/C should resolve to A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;

      // `$var` position in each file (line 1, col 19 — inside the `$var` token)
      //   line 0: `function X --no-scope-shadowing`
      //   line 1: `    set var (math $var + 1)`
      //                              ^^^  col 19
      const varUsagePos = { line: 1, character: 19 };

      const locFromA = analyzer.getDefinitionLocation(docA, varUsagePos);
      const locFromB = analyzer.getDefinitionLocation(docB, varUsagePos);
      const locFromC = analyzer.getDefinitionLocation(docC, varUsagePos);

      // All should resolve to A.fish's var definition (line 1, col 8)
      expect(locFromA).toHaveLength(1);
      expect(locFromA[0]!.uri).toBe(docA.uri);

      expect(locFromB).toHaveLength(1);
      expect(locFromB[0]!.uri).toBe(docA.uri);

      expect(locFromC).toHaveLength(1);
      expect(locFromC[0]!.uri).toBe(docA.uri);
    });

    it('go-to implementation of `var` from B.fish should find A.fish', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;

      // B.fish line 1: `    set var (math $var + 1)`
      //                     ^^^ col 8 (definition name)
      const varDefPos = { line: 1, character: 8 };
      const impls = getImplementation(docB, varDefPos);

      // Implementation should resolve to A.fish (the root caller)
      expect(impls).toHaveLength(1);
      expect(impls[0]!.uri).toBe(docA.uri);
    });

    it('go-to implementation of `var` from C.fish should NOT include C.fish', () => {
      const docC = workspace.getDocument('functions/C.fish')!;

      const varDefPos = { line: 1, character: 8 };
      const impls = getImplementation(docC, varDefPos);

      // Implementation filters to external URIs — should not return C itself
      expect(impls.every(loc => loc.uri !== docC.uri)).toBe(true);
    });

    it('rename `var` from A.fish should propagate across A/B/C', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const symbolsA = analyzer.getFlatDocumentSymbols(docA.uri);
      const varInA = symbolsA.find(s => s.name === 'var' && s.isVariable())!;

      const renames = getRenames(docA, varInA.selectionRange.start, 'counter');

      // Build shorthand: [uri_basename, line, character, newText]
      const shorthand = renames.map(r => [
        r.uri.split('/').pop(),
        r.range.start.line,
        r.range.start.character,
        r.newText,
      ]);

      // Each file has 2 occurrences: `set var` (col 8) and `$var` (col 19) on line 1
      // A.fish: set var ..., $var
      // B.fish: set var ..., $var
      // C.fish: set var ..., $var
      expect(shorthand).toContainEqual(['A.fish', 1, 8, 'counter']);
      expect(shorthand).toContainEqual(['A.fish', 1, 19, 'counter']);
      expect(shorthand).toContainEqual(['B.fish', 1, 8, 'counter']);
      expect(shorthand).toContainEqual(['B.fish', 1, 19, 'counter']);
      expect(shorthand).toContainEqual(['C.fish', 1, 8, 'counter']);
      expect(shorthand).toContainEqual(['C.fish', 1, 19, 'counter']);
      expect(renames).toHaveLength(6);
    });

    it('rename `var` from B.fish should NOT include locations outside A/B/C', () => {
      const docB = workspace.getDocument('functions/B.fish')!;

      const symbolsB = analyzer.getFlatDocumentSymbols(docB.uri);
      const varInB = symbolsB.find(s => s.name === 'var' && s.isVariable())!;

      const renames = getRenames(docB, varInB.selectionRange.start, 'counter');
      const renameFiles = renames.map(r => r.uri.split('/').pop());

      // Only A.fish, B.fish, C.fish — no other files
      expect(renameFiles.every(f => ['A.fish', 'B.fish', 'C.fish'].includes(f!))).toBe(true);
    });

    it('`var` inside --no-scope-shadowing functions should NOT be flagged as unused', () => {
      const docA = workspace.getDocument('functions/A.fish')!;
      const docB = workspace.getDocument('functions/B.fish')!;
      const docC = workspace.getDocument('functions/C.fish')!;

      const unusedA = allUnusedLocalReferences(docA);
      const unusedB = allUnusedLocalReferences(docB);
      const unusedC = allUnusedLocalReferences(docC);

      // `var` is used across files — should not appear as unused in any file
      expect(unusedA.find(s => s.name === 'var')).toBeUndefined();
      expect(unusedB.find(s => s.name === 'var')).toBeUndefined();
      expect(unusedC.find(s => s.name === 'var')).toBeUndefined();
    });
  });

  describe('D/E/F - --no-scope-shadowing with config.fish calling functions', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/D.fish',
        content: [
          'function D --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    E',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/E.fish',
        content: [
          'function E --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    F',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/F.fish',
        content: [
          'function F --no-scope-shadowing',
          '    set var (math $var + 1)',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'config.fish',
        content: [
          'D',
          '',
          'set -g var 10',
          'D',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/D.fish')).toBeDefined();
      expect(workspace.getDocument('functions/E.fish')).toBeDefined();
      expect(workspace.getDocument('functions/F.fish')).toBeDefined();
      expect(workspace.getDocument('config.fish')).toBeDefined();
    });

    it('should find cross-file references for `var` from D.fish across D/E/F and config.fish', () => {
      const docD = workspace.getDocument('functions/D.fish')!;
      const docE = workspace.getDocument('functions/E.fish')!;
      const docF = workspace.getDocument('functions/F.fish')!;
      const docConfig = workspace.getDocument('config.fish')!;
      const symbolsD = analyzer.getFlatDocumentSymbols(docD.uri);

      const varInD = symbolsD.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInD).toBeDefined();

      const refs = getReferences(docD, varInD.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // D/E/F all have --no-scope-shadowing, so var references span all three
      expect(refUris).toContain(docD.uri);
      expect(refUris).toContain(docE.uri);
      expect(refUris).toContain(docF.uri);

      // config.fish `set -g var 10` also matches since the search is workspace-wide
      expect(refUris).toContain(docConfig.uri);

      // 2 refs per function file (definition + $var) + 1 in config.fish = 7
      expect(refs.length).toBe(7);
    });

    it('should find cross-file references for `var` when queried from config.fish global', () => {
      const docD = workspace.getDocument('functions/D.fish')!;
      const docE = workspace.getDocument('functions/E.fish')!;
      const docF = workspace.getDocument('functions/F.fish')!;
      const docConfig = workspace.getDocument('config.fish')!;
      const symbolsConfig = analyzer.getFlatDocumentSymbols(docConfig.uri);

      const varInConfig = symbolsConfig.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInConfig).toBeDefined();

      const refs = getReferences(docConfig, varInConfig.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // config.fish `set -g var 10` is global; D/E/F use --no-scope-shadowing
      // so they inherit the caller's scope — var inside them is the same variable
      expect(refUris).toContain(docConfig.uri);
      expect(refUris).toContain(docD.uri);
      expect(refUris).toContain(docE.uri);
      expect(refUris).toContain(docF.uri);

      // 1 in config.fish (definition) + 2 per function file = 7
      expect(refs.length).toBe(7);
    });

    it('goto-definition of `$var` from D/E/F should resolve to D.fish', () => {
      const docD = workspace.getDocument('functions/D.fish')!;
      const docE = workspace.getDocument('functions/E.fish')!;
      const docF = workspace.getDocument('functions/F.fish')!;

      // `$var` position: line 1, col 19
      //   line 1: `    set var (math $var + 1)`
      //                              ^^^
      const varUsagePos = { line: 1, character: 19 };

      const locFromD = analyzer.getDefinitionLocation(docD, varUsagePos);
      const locFromE = analyzer.getDefinitionLocation(docE, varUsagePos);
      const locFromF = analyzer.getDefinitionLocation(docF, varUsagePos);

      // D is the root of the call chain (D → E → F), all --no-scope-shadowing
      // config.fish defines `set -g var 10` but D is the first --no-scope-shadowing
      // function that defines var, so goto-def should resolve to D.fish
      expect(locFromD).toHaveLength(1);
      expect(locFromD[0]!.uri).toBe(docD.uri);

      expect(locFromE).toHaveLength(1);
      expect(locFromE[0]!.uri).toBe(docD.uri);

      expect(locFromF).toHaveLength(1);
      expect(locFromF[0]!.uri).toBe(docD.uri);
    });
  });

  describe('G/H/I - --no-scope-shadowing with var scope changing per function', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/G.fish',
        content: [
          'function G --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    H',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/H.fish',
        content: [
          'function H --no-scope-shadowing',
          '    set -l var (math $var + 1)',
          '    I',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/I.fish',
        content: [
          'function I --no-scope-shadowing',
          '    set -f var (math $var + 1)',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/G.fish')).toBeDefined();
      expect(workspace.getDocument('functions/H.fish')).toBeDefined();
      expect(workspace.getDocument('functions/I.fish')).toBeDefined();
    });

    it('should find cross-file references for `var` from G.fish (set var)', () => {
      const docG = workspace.getDocument('functions/G.fish')!;
      const docH = workspace.getDocument('functions/H.fish')!;
      const docI = workspace.getDocument('functions/I.fish')!;
      const symbolsG = analyzer.getFlatDocumentSymbols(docG.uri);

      const varInG = symbolsG.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInG).toBeDefined();

      const refs = getReferences(docG, varInG.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // All three files share the same `var` via --no-scope-shadowing
      expect(refUris).toContain(docG.uri);
      expect(refUris).toContain(docH.uri);
      expect(refUris).toContain(docI.uri);
      expect(refs.length).toBe(6);
    });

    it('should find cross-file references for `var` from H.fish (set -l var)', () => {
      const docG = workspace.getDocument('functions/G.fish')!;
      const docH = workspace.getDocument('functions/H.fish')!;
      const docI = workspace.getDocument('functions/I.fish')!;
      const symbolsH = analyzer.getFlatDocumentSymbols(docH.uri);

      const varInH = symbolsH.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInH).toBeDefined();
      // set -l still reports as local, but --no-scope-shadowing makes it transparent
      expect(varInH.isLocal()).toBe(true);
      expect(varInH.parent?.isFunctionWithNoScopeShadowing()).toBe(true);

      const refs = getReferences(docH, varInH.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // Despite -l flag, --no-scope-shadowing means var is shared across G/H/I
      expect(refUris).toContain(docG.uri);
      expect(refUris).toContain(docH.uri);
      expect(refUris).toContain(docI.uri);
      expect(refs.length).toBe(6);
    });

    it('should find cross-file references for `var` from I.fish (set -f var)', () => {
      const docG = workspace.getDocument('functions/G.fish')!;
      const docH = workspace.getDocument('functions/H.fish')!;
      const docI = workspace.getDocument('functions/I.fish')!;
      const symbolsI = analyzer.getFlatDocumentSymbols(docI.uri);

      const varInI = symbolsI.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInI).toBeDefined();
      // set -f still reports as local, but --no-scope-shadowing makes it transparent
      expect(varInI.isLocal()).toBe(true);
      expect(varInI.parent?.isFunctionWithNoScopeShadowing()).toBe(true);

      const refs = getReferences(docI, varInI.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // Despite -f flag, --no-scope-shadowing means var is shared across G/H/I
      expect(refUris).toContain(docG.uri);
      expect(refUris).toContain(docH.uri);
      expect(refUris).toContain(docI.uri);
      expect(refs.length).toBe(6);
    });

    it('goto-definition of `$var` from G/H/I should resolve to G.fish', () => {
      const docG = workspace.getDocument('functions/G.fish')!;
      const docH = workspace.getDocument('functions/H.fish')!;
      const docI = workspace.getDocument('functions/I.fish')!;

      // `$var` position: line 1, col 19
      //   line 1: `    set var (math $var + 1)`  (G.fish)
      //   line 1: `    set -l var (math $var + 1)`  (H.fish, col 22)
      //   line 1: `    set -f var (math $var + 1)`  (I.fish, col 22)
      const varUsagePosG = { line: 1, character: 19 };
      const varUsagePosH = { line: 1, character: 22 };
      const varUsagePosI = { line: 1, character: 22 };

      const locFromG = analyzer.getDefinitionLocation(docG, varUsagePosG);
      const locFromH = analyzer.getDefinitionLocation(docH, varUsagePosH);
      const locFromI = analyzer.getDefinitionLocation(docI, varUsagePosI);

      // G is the root of the call chain (G → H → I), all --no-scope-shadowing
      expect(locFromG).toHaveLength(1);
      expect(locFromG[0]!.uri).toBe(docG.uri);

      expect(locFromH).toHaveLength(1);
      expect(locFromH[0]!.uri).toBe(docG.uri);

      expect(locFromI).toHaveLength(1);
      expect(locFromI[0]!.uri).toBe(docG.uri);
    });
  });

  describe('J/K/L - L without --no-scope-shadowing', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/J.fish',
        content: [
          'function J --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    K',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/K.fish',
        content: [
          'function K --no-scope-shadowing',
          '    set var (math $var + 1)',
          '    L',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/L.fish',
        content: [
          'function L',
          '    set var (math $var + 1)',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should have all workspace documents', () => {
      expect(workspace.getDocument('functions/J.fish')).toBeDefined();
      expect(workspace.getDocument('functions/K.fish')).toBeDefined();
      expect(workspace.getDocument('functions/L.fish')).toBeDefined();
    });

    it('should only cache J and K in noScopeShadowing, not L', () => {
      expect(analyzer.noScopeShadowing.has('J')).toBe(true);
      expect(analyzer.noScopeShadowing.has('K')).toBe(true);
      expect(analyzer.noScopeShadowing.has('L')).toBe(false);
    });

    it('should find cross-file references for `var` from J.fish across J/K only', () => {
      const docJ = workspace.getDocument('functions/J.fish')!;
      const docK = workspace.getDocument('functions/K.fish')!;
      const docL = workspace.getDocument('functions/L.fish')!;
      const symbolsJ = analyzer.getFlatDocumentSymbols(docJ.uri);

      const varInJ = symbolsJ.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInJ).toBeDefined();

      const refs = getReferences(docJ, varInJ.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // J and K share scope via --no-scope-shadowing
      expect(refUris).toContain(docJ.uri);
      expect(refUris).toContain(docK.uri);
      // L has normal scoping — its var is a separate local variable
      expect(refUris).not.toContain(docL.uri);
      expect(refs.length).toBe(4);
    });

    it('should find cross-file references for `var` from K.fish across J/K only', () => {
      const docJ = workspace.getDocument('functions/J.fish')!;
      const docK = workspace.getDocument('functions/K.fish')!;
      const docL = workspace.getDocument('functions/L.fish')!;
      const symbolsK = analyzer.getFlatDocumentSymbols(docK.uri);

      const varInK = symbolsK.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInK).toBeDefined();

      const refs = getReferences(docK, varInK.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      expect(refUris).toContain(docJ.uri);
      expect(refUris).toContain(docK.uri);
      expect(refUris).not.toContain(docL.uri);
      expect(refs.length).toBe(4);
    });

    it('should find only local references for `var` from L.fish (no --no-scope-shadowing)', () => {
      const docJ = workspace.getDocument('functions/J.fish')!;
      const docK = workspace.getDocument('functions/K.fish')!;
      const docL = workspace.getDocument('functions/L.fish')!;
      const symbolsL = analyzer.getFlatDocumentSymbols(docL.uri);

      const varInL = symbolsL.find(s => s.name === 'var' && s.isVariable())!;
      expect(varInL).toBeDefined();
      expect(varInL.isLocal()).toBe(true);
      expect(varInL.parent?.isFunctionWithNoScopeShadowing()).toBe(false);

      const refs = getReferences(docL, varInL.selectionRange.start);
      const refUris = refs.map(loc => loc.uri);

      // L has normal scoping — var is local to L.fish only
      expect(refUris).toContain(docL.uri);
      expect(refUris).not.toContain(docJ.uri);
      expect(refUris).not.toContain(docK.uri);
      expect(refs.length).toBe(2);
    });

    it('goto-definition of `$var` from J/K should resolve to J.fish, from L should stay in L.fish', () => {
      const docJ = workspace.getDocument('functions/J.fish')!;
      const docK = workspace.getDocument('functions/K.fish')!;
      const docL = workspace.getDocument('functions/L.fish')!;

      // `$var` position: line 1, col 19
      //   line 1: `    set var (math $var + 1)`
      //                              ^^^
      const varUsagePos = { line: 1, character: 19 };

      const locFromJ = analyzer.getDefinitionLocation(docJ, varUsagePos);
      const locFromK = analyzer.getDefinitionLocation(docK, varUsagePos);
      const locFromL = analyzer.getDefinitionLocation(docL, varUsagePos);

      // J is the root of the --no-scope-shadowing chain (J → K)
      expect(locFromJ).toHaveLength(1);
      expect(locFromJ[0]!.uri).toBe(docJ.uri);

      expect(locFromK).toHaveLength(1);
      expect(locFromK[0]!.uri).toBe(docJ.uri);

      // L has normal scoping — goto-def stays within L.fish
      expect(locFromL).toHaveLength(1);
      expect(locFromL[0]!.uri).toBe(docL.uri);
    });
  });
});
