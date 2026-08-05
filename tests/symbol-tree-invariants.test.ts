import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { equalSymbolDefinitions, equalSymbols, equalSymbolScopes, symbolContainsScope } from '../src/parsing/equality-utils';
import { FishSymbol } from '../src/parsing/symbol';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { setLogger } from './helpers';
import TestWorkspace from './test-workspace-utils';

/**
 * Structural invariants of the FishSymbol tree and its equality predicates.
 *
 * These exist because a scope predicate was once built on the assumption that
 * "only functions are internal nodes in the FishSymbol tree" — which had been
 * false since FOR symbols began nesting their body's definitions — and no test
 * failed. Any change to which fishKinds parent other symbols, or to the
 * reflexivity/symmetry of the equality predicates, should fail loudly here.
 */
describe('symbol tree invariants', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  const workspace = TestWorkspace.create().addFiles({
    relativePath: 'shape.fish',
    content: [
      'function shape',
      '    set -f body_var 1',
      '    for i in (seq 3)',
      '        set -a body_var $i',
      '        set -l loop_var $i',
      '    end',
      '    while test -n "$body_var"',
      '        set -l while_var 1',
      '    end',
      '    if test -z "$body_var"',
      '        set -l if_var 1',
      '    end',
      '    set -f sub_var (begin; set -l sub_inner 1; end)',
      '    function shape_inner',
      '        set -f inner_var 1',
      '    end',
      'end',
    ].join('\n'),
  }, {
    relativePath: 'predicates.fish',
    content: [
      'set -gx GLOBAL_VAR 1',
      'set file_var 2',
      'function pred_outer',
      '    set -f fn_var 1',
      '    set -a fn_var 2',
      '    set -ef fn_var',
      '    set -f fn_var 3',
      '    for i in (seq 2)',
      '        set -l shadow $i',
      '    end',
      '    function pred_inner --no-scope-shadowing',
      '        set -a fn_var 4',
      '    end',
      'end',
      "alias pred_alias 'echo hi'",
    ].join('\n'),
  }).initialize();

  const allSymbols = (): FishSymbol[] => [
    ...analyzer.getFlatDocumentSymbols(workspace.getDocument('shape.fish')!.uri),
    ...analyzer.getFlatDocumentSymbols(workspace.getDocument('predicates.fish')!.uri),
  ];

  const describeSymbol = (symbol: FishSymbol): string =>
    `${symbol.name}:${symbol.fishKind}@${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`;

  describe('tree shape', () => {
    it('parents definitions under the fishKinds that actually nest', () => {
      const doc = workspace.getDocument('shape.fish')!;
      const flat = analyzer.getFlatDocumentSymbols(doc.uri);

      const bodyVars = flat.filter(s => s.name === 'body_var' && s.fishKind === 'SET');
      expect(bodyVars.map(s => s.parent?.fishKind).sort()).toEqual(['FOR', 'FUNCTION']);

      const loopVar = flat.find(s => s.name === 'loop_var')!;
      expect(loopVar.parent?.fishKind).toBe('FOR');

      // while/if blocks are NOT internal nodes: their definitions bubble up to
      // the enclosing function symbol
      const whileVar = flat.find(s => s.name === 'while_var')!;
      const ifVar = flat.find(s => s.name === 'if_var')!;
      expect(whileVar.parent?.fishKind).toBe('FUNCTION');
      expect(ifVar.parent?.fishKind).toBe('FUNCTION');

      // a definition inside a command substitution nests under the SET symbol
      const subInner = flat.find(s => s.name === 'sub_inner')!;
      expect(subInner.parent?.fishKind).toBe('SET');
      expect(subInner.parent?.name).toBe('sub_var');
    });

    it('only the expected fishKinds appear as internal nodes', () => {
      const internalKinds = new Set(
        allSymbols()
          .filter(symbol => symbol.children.length > 0)
          .map(symbol => symbol.fishKind),
      );

      expect([...internalKinds].sort()).toEqual(['FOR', 'FUNCTION', 'SET']);
    });

    it('reports the enclosing function as owner regardless of nesting depth', () => {
      const doc = workspace.getDocument('shape.fish')!;
      const flat = analyzer.getFlatDocumentSymbols(doc.uri);

      const shape = flat.find(s => s.name === 'shape' && s.fishKind === 'FUNCTION')!;
      const shapeInner = flat.find(s => s.name === 'shape_inner')!;

      expect(shape.getFunctionOwner()).toBeUndefined();
      expect(shapeInner.getFunctionOwner()?.id).toBe(shape.id);

      for (const name of ['body_var', 'loop_var', 'while_var', 'if_var', 'sub_var', 'sub_inner']) {
        const owned = flat.filter(s => s.name === name);
        expect(owned.length).toBeGreaterThan(0);
        for (const symbol of owned) {
          expect(symbol.getFunctionOwner()?.id).toBe(shape.id);
        }
      }

      const innerVar = flat.find(s => s.name === 'inner_var')!;
      expect(innerVar.getFunctionOwner()?.id).toBe(shapeInner.id);
    });
  });

  describe('equality predicate properties', () => {
    it('every predicate is reflexive for every symbol', () => {
      const failures: string[] = [];
      for (const symbol of allSymbols()) {
        if (!equalSymbols(symbol, symbol)) failures.push(`equalSymbols ${describeSymbol(symbol)}`);
        if (!equalSymbolScopes(symbol, symbol)) failures.push(`equalSymbolScopes ${describeSymbol(symbol)}`);
        if (!symbolContainsScope(symbol, symbol)) failures.push(`symbolContainsScope ${describeSymbol(symbol)}`);
        if (!equalSymbolDefinitions(symbol, symbol)) failures.push(`equalSymbolDefinitions ${describeSymbol(symbol)}`);
      }
      expect(failures).toEqual([]);
    });

    it('equalSymbols and equalSymbolScopes are symmetric over all pairs', () => {
      const symbols = allSymbols();
      const failures: string[] = [];
      for (const a of symbols) {
        for (const b of symbols) {
          if (equalSymbols(a, b) !== equalSymbols(b, a)) {
            failures.push(`equalSymbols ${describeSymbol(a)} vs ${describeSymbol(b)}`);
          }
          if (equalSymbolScopes(a, b) !== equalSymbolScopes(b, a)) {
            failures.push(`equalSymbolScopes ${describeSymbol(a)} vs ${describeSymbol(b)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it('keeps erase-separated re-definitions unequal while merging same-chain writes', () => {
      const doc = workspace.getDocument('predicates.fish')!;
      const fnVars = analyzer.getFlatDocumentSymbols(doc.uri)
        .filter(s => s.name === 'fn_var' && s.fishKind === 'SET' && s.parent?.name === 'pred_outer')
        .sort((a, b) => a.selectionRange.start.line - b.selectionRange.start.line);

      // `set -ef` produces no definition symbol, so pred_outer owns exactly:
      // line 3 (first binding), line 4 (append to it), line 6 (post-erase binding)
      expect(fnVars.map(s => s.selectionRange.start.line)).toEqual([3, 4, 6]);
      const [first, append, postErase] = fnVars as [FishSymbol, FishSymbol, FishSymbol];

      expect(equalSymbolDefinitions(first, append)).toBe(true);
      // Guards against "fixing" predicate reflexivity via scope-node equality:
      // these two share a scope node but sit in different binding lifetimes
      expect(equalSymbolDefinitions(first, postErase)).toBe(false);
      expect(equalSymbolDefinitions(append, postErase)).toBe(false);
    });
  });
});
