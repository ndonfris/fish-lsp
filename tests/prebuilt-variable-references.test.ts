import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { analyzer, Analyzer } from '../src/analyze';
import { getReferences, getImplementation } from '../src/references';
import { getRenames } from '../src/renames';
import { Position, Location } from 'vscode-languageserver';
import TestWorkspace from './test-workspace-utils';
import { getRange, nodesGen } from '../src/utils/tree-sitter';
import { isNodeExcluded, isNodeIncluded } from '../src/utils/skippable-scopes';
import { FishSymbol } from '../src/parsing/symbol';

const locationsMapUtil = (locations: Location[]) => {
  return locations.map(loc => {
    const relPath = analyzer.getDocument(loc.uri)?.getRelativeFilenameToWorkspace() ?? 'unknown file';
    const line = loc.range.start.line;
    const char = loc.range.start.character;
    const startStr = `(${line}:${char})`;
    const text = analyzer.getTextAtLocation(loc);
    const lineText = analyzer.getDocument(loc.uri)!.getLine(line).trim();
    return `${relPath} (${startStr}) - ${text} - \`${lineText}\``;
  });
};

describe('prebuilt/environment variable references', () => {
  setLogger();

  beforeAll(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('getReferences() for prebuilt variables', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    echo $PATH',
          '    set -l x $HOME',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/bar.fish',
        content: [
          'function bar',
          '    echo $PATH',
          '    if test $status -ne 0',
          '        return 1',
          '    end',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/baz.fish',
        content: [
          'function baz',
          '    echo $HOME',
          '    echo "$HOME"',
          '    echo $USER',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/setup-custom-path-variables.fish',
        content: [
          'set -g PATH $PATH $HOME/custom/bin',
          'set -g MY_VAR $PATH',
          'set -g PATH $PATH /opt/bin $HOME/.local/bin',
          'set -g PATH $PATH /usr/local/bin',
          '',
          'set -gx _fish_conf $HOME/.config/fish/config.fish',
          'set -gx _fish_funcs $HOME/.config/fish/functions',
          'set -gx _fish_completions $HOME/.config/fish/completions',
          'set -gx _fish_confd "$HOME/.config/fish/conf.d"',
        ].join('\n'),
      },
      {
        relativePath: 'conf.d/setup-user-variable.fish',
        content: [
          'function local_home_setup',
          '    set -l HOME /tmp/some_path',
          '    echo "Local home is $HOME"',
          'end',
          'set -lx HOME $HOME/tmp/home',
        ],
      },
      {
        relativePath: 'conf.d/global-paths-vs-local-paths.fish',
        content: [
          'set -lx PATH $PATH:/opt/bin',   // line 0: PATH(local def), $PATH(global ref - self-referencing)
          'echo $PATH',                     // line 1: $PATH(local ref)
          'set -gx PATH $PATH:/usr/bin',    // line 2: PATH(global def), $PATH(local ref)
          'echo $PATH',                     // line 3: $PATH(global ref)
          'set -lx PATH $PATH:/bin',        // line 4: PATH(local def), $PATH(global ref - self-referencing)
        ].join('\n'),
      },
    ).initialize();

    it('should find $PATH references across multiple files', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      // $PATH at line 1, char 10 in foo.fish ("    echo $PATH")
      const pathRefs = getReferences(fooDoc, Position.create(1, 10));
      // Should find $PATH in foo.fish (line 1) and bar.fish (line 1)
      expect(pathRefs.length).toBeGreaterThanOrEqual(2);

      const pathTexts = pathRefs.map(loc => analyzer.getTextAtLocation(loc));
      for (const text of pathTexts) {
        expect(text === '$PATH' || text === 'PATH').toBeTruthy();
      }
    });

    it('should distinguish local definitions from global references in self-referencing $PATH', () => {
      const doc = workspace.getDocument('conf.d/global-paths-vs-local-paths.fish')!;
      const allSymbols = analyzer.getFlatDocumentSymbols(doc.uri);
      const root = analyzer.getRootNode(doc.uri)!;

      // Verify we have the expected symbol counts
      const pathSymbols = allSymbols.filter(s => s.name === 'PATH');
      const localDefs = pathSymbols.filter(s => s.isLocal());
      const globalDefs = pathSymbols.filter(s => s.isGlobal());
      expect(localDefs.length).toBe(2);
      expect(globalDefs.length).toBe(1);

      // Get scope spans via analyzer
      const scopeSpans = analyzer.getScopeSpans(doc, 'PATH');
      expect(scopeSpans.length).toBeGreaterThan(0);

      // Verify self-referencing $PATH nodes are in 'include' spans
      // (line 0: $PATH in `set -lx PATH $PATH:/opt/bin` reads the global)
      for (const ls of localDefs) {
        // The self-referencing expansion within the set command should be included
        const selfRefs = ls.isSelfReferencingVariable();
        if (selfRefs) {
          for (const node of selfRefs) {
            expect(isNodeIncluded(node, scopeSpans)).toBe(true);
          }
        }
      }

      // Verify nodes inside local shadow scopes are excluded
      // (line 1: `echo $PATH` is shadowed by line 0's local def)
      // Walk all nodes and check that excluded nodes are in local scopes
      for (const node of nodesGen(root)) {
        if (node.text !== 'PATH' && node.text !== '$PATH') continue;
        if (isNodeExcluded(node, scopeSpans)) {
          // Excluded nodes should be inside a local symbol's scope
          expect(localDefs.some(ls => ls.scopeContainsNode(node) || ls.containsNode(node))).toBe(true);
        }
      }
    });

    it('should find $status references across multiple files', () => {
      const barDoc = workspace.getDocument('functions/bar.fish')!;
      // $status at line 2, char 14 in bar.fish ("    if test $status -ne 0")
      const refs = getReferences(barDoc, Position.create(2, 17));
      expect(refs.length).toBeGreaterThanOrEqual(1);

      const texts = refs.map(loc => analyzer.getTextAtLocation(loc));

      console.log('Found $status references at:', locationsMapUtil(refs));
      for (const text of texts) {
        expect(text === '$status' || text === 'status').toBeTruthy();
      }
    });

    it('should find $HOME references across multiple files', () => {
      const bazDoc = workspace.getDocument('functions/baz.fish')!;
      // $PATH at line 1, char 10 in foo.fish ("    echo $PATH")
      const pathRefs = getReferences(bazDoc, Position.create(1, 10));
      // Should find $PATH in foo.fish (line 1) and bar.fish (line 1)
      expect(pathRefs.length).toBeGreaterThanOrEqual(2);
      console.log('Found $HOME references at:', locationsMapUtil(pathRefs));

      for (const loc of pathRefs) {
        const def = analyzer.getDefinition(analyzer.getDocument(loc.uri)!, loc.range.start);
        const defUri = def ? def.uri : 'null';
        const range = def ? def.selectionRange : null;
        const { start, end } = range ? range : { start: { line: 'null', character: 'null' }, end: { line: 'null', character: 'null' } };
        const defRange = range ? '(' + [start.line, start.character, end.line, end.character].join(',') + ')' : 'null';
        const defRangeStr = def ? `(${defRange})` : 'null';
        const defText = def ? analyzer.getTextAtLocation(def) : 'null';
        console.log({
          location: loc.uri,
          text: analyzer.getTextAtLocation(loc),
          definition: def ? {
            uri: defUri,
            range: defRangeStr,
            text: defText,
          } : null,
        });
      }
      const pathTexts = pathRefs.map(loc => analyzer.getTextAtLocation(loc));
      for (const text of pathTexts) {
        expect(text).toBe('HOME');
      }
    });

    it('should find $HOME references in a single file', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      // $HOME at line 2, char 18 in foo.fish ("    set -l x $HOME/.config")
      const refs = getReferences(fooDoc, Position.create(2, 15));
      expect(refs.length).toBeGreaterThanOrEqual(1);

      const texts = refs.map(loc => analyzer.getTextAtLocation(loc));
      for (const text of texts) {
        expect(text === '$HOME' || text === 'HOME').toBeTruthy();
      }
    });

    it('self implement test', () => {
      const doc = workspace.getDocument('conf.d/global-paths-vs-local-paths.fish')!;
      const symbols = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.isVariable() && s.name === 'PATH');
      symbols.forEach(s => {
        const refs = s.isSelfReferencingVariable();
        if (refs) {
          console.log(`Symbol ${s.name} is a self-referencing expansion with nodes: ${refs}, ${refs.map(r => doc.getText(getRange(r)) + ' at ' + JSON.stringify(getRange(r), null, 2))}`);
        }
      });
      // const root = analyzer.getRootNode(doc.uri)!;
      //
      // const spans = analyzer.getScopeSpans(doc, 'PATH')
      //
      // spans.forEach(span => {
      //   console.log(`Span: ${span.tag} [${span.startIndex}, ${span.endIndex}]`);
      // })
      // spans.filter(s => s.tag === 'exclude').forEach(span => {
      //   console.log(`Excluded region: [${span.startIndex}, ${span.endIndex}]`);
      // })
    });
  });

  describe('getReferences() for $USER', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'config.fish',
        content: 'echo $USER',
      },
    ).initialize();

    it('should find $USER references', () => {
      const configDoc = workspace.getDocument('config.fish')!;
      // $USER at line 0, char 6
      const refs = getReferences(configDoc, Position.create(0, 6));
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('analyzer.getScopeSpans()', () => {
    describe('global-only variables produce no exclude spans', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/globals.fish',
          content: [
            'set -gx MY_VAR value1',   // line 0: global def
            'echo $MY_VAR',            // line 1: global ref
            'set -gx MY_VAR value2',   // line 2: global redef
            'echo $MY_VAR',            // line 3: global ref
          ].join('\n'),
        },
      ).initialize();

      it('should return all-include spans when no locals shadow', () => {
        const doc = workspace.getDocument('conf.d/globals.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'MY_VAR');
        expect(spans.length).toBe(1);
        expect(spans[0]!.tag).toBe('include');

        // Every node should be included
        const root = analyzer.getRootNode(doc.uri)!;
        for (const node of nodesGen(root)) {
          if (node.text === 'MY_VAR' || node.text === '$MY_VAR') {
            expect(isNodeIncluded(node, spans)).toBe(true);
          }
        }
      });
    });

    describe('local inside function shadows global', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/shadow.fish',
          content: [
            'set -gx MY_VAR global_val',       // line 0: global def
            'echo $MY_VAR',                     // line 1: global ref (include)
            'function inner',                   // line 2
            '    set -l MY_VAR local_val',      // line 3: local def (shadows global)
            '    echo $MY_VAR',                 // line 4: local ref (exclude)
            'end',                              // line 5
            'echo $MY_VAR',                     // line 6: global ref (include)
          ].join('\n'),
        },
      ).initialize();

      it('should exclude the function scope where local shadows global', () => {
        const doc = workspace.getDocument('conf.d/shadow.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'MY_VAR');

        // Should have multiple spans (include/exclude/include)
        expect(spans.length).toBeGreaterThan(1);

        const root = analyzer.getRootNode(doc.uri)!;
        const allNodes: { text: string; line: number; included: boolean; }[] = [];
        for (const node of nodesGen(root)) {
          if (node.text !== 'MY_VAR' && node.text !== '$MY_VAR') continue;
          allNodes.push({
            text: node.text,
            line: node.startPosition.row,
            included: isNodeIncluded(node, spans),
          });
        }

        // line 0 def and line 1 ref should be included (global scope)
        const globalRefs = allNodes.filter(n => n.line === 0 || n.line === 1 || n.line === 6);
        for (const ref of globalRefs) {
          expect(ref.included).toBe(true);
        }

        // line 3 def and line 4 ref should be excluded (inside shadowing function)
        const localRefs = allNodes.filter(n => n.line === 3 || n.line === 4);
        for (const ref of localRefs) {
          expect(ref.included).toBe(false);
        }
      });
    });

    describe('self-referencing expansions punch include holes', () => {
      // When locals shadow inside a FUNCTION, the function scope becomes exclude
      // and self-ref expansions punch include holes
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/self-ref-in-function.fish',
          content: [
            'set -gx PATH /usr/bin',              // line 0: global def
            'echo $PATH',                          // line 1: global ref (include)
            'function setup_path',                 // line 2
            '    set -lx PATH $PATH:/opt/bin',     // line 3: local def, $PATH is self-ref
            '    echo $PATH',                      // line 4: local ref (exclude)
            'end',                                 // line 5
            'echo $PATH',                          // line 6: global ref (include)
          ].join('\n'),
        },
      ).initialize();

      it('should include self-referencing $PATH in set commands within function scopes', () => {
        const doc = workspace.getDocument('conf.d/self-ref-in-function.fish')!;
        const allSymbols = analyzer.getFlatDocumentSymbols(doc.uri);
        const pathSymbols = allSymbols.filter(s => s.isVariable() && s.name === 'PATH');

        const spans = analyzer.getScopeSpans(doc, 'PATH');
        // Function scope creates exclude, self-ref punch creates include
        expect(spans.length).toBeGreaterThan(1);

        const localDefs = pathSymbols.filter(s => s.isLocal());
        expect(localDefs.length).toBe(1);

        // The self-referencing expansion within the set command should be included
        for (const ls of localDefs) {
          const selfRefs = ls.isSelfReferencingVariable();
          if (selfRefs) {
            for (const node of selfRefs) {
              expect(isNodeIncluded(node, spans)).toBe(true);
            }
          }
        }
      });

      it('should have both include and exclude spans', () => {
        const doc = workspace.getDocument('conf.d/self-ref-in-function.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'PATH');
        const excludeSpans = spans.filter(s => s.tag === 'exclude');
        const includeSpans = spans.filter(s => s.tag === 'include');

        expect(excludeSpans.length).toBeGreaterThan(0);
        expect(includeSpans.length).toBeGreaterThan(0);
      });

      it('should exclude function-local refs but include global refs', () => {
        const doc = workspace.getDocument('conf.d/self-ref-in-function.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'PATH');
        const root = analyzer.getRootNode(doc.uri)!;

        const nodesByLine: { line: number; text: string; included: boolean; }[] = [];
        for (const node of nodesGen(root)) {
          if (node.text !== 'PATH' && node.text !== '$PATH') continue;
          nodesByLine.push({
            line: node.startPosition.row,
            text: node.text,
            included: isNodeIncluded(node, spans),
          });
        }

        // Lines 0, 1, 6 should be included (global scope)
        for (const n of nodesByLine.filter(n => [0, 1, 6].includes(n.line))) {
          expect(n.included).toBe(true);
        }

        // Line 4 ($PATH in `echo $PATH`) should be excluded (local scope)
        for (const n of nodesByLine.filter(n => n.line === 4)) {
          expect(n.included).toBe(false);
        }
      });
    });

    describe('program-level local variables (no function scope)', () => {
      // Program-level locals all share the same program scope node,
      // so buildScopeSpans cannot carve out exclude regions (it would
      // exclude the entire file). This is a known limitation — program-level
      // local/global overlaps need position-based span computation.
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/program-level.fish',
          content: [
            'set -lx PATH $PATH:/opt/bin',   // line 0: local def, self-ref
            'echo $PATH',                     // line 1: local ref
            'set -gx PATH $PATH:/usr/bin',    // line 2: global def
            'echo $PATH',                     // line 3: global ref
            'set -lx PATH $PATH:/bin',        // line 4: local def, self-ref
          ].join('\n'),
        },
      ).initialize();

      it('should produce a single include span for program-level locals (known limitation)', () => {
        const doc = workspace.getDocument('conf.d/program-level.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'PATH');

        // All symbols share the program scope — cannot exclude without
        // position-based subdivision, so everything is include
        expect(spans).toHaveLength(1);
        expect(spans[0]!.tag).toBe('include');
      });
    });

    describe('no variable symbols produces single include span', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'functions/empty.fish',
          content: [
            'function empty',
            '    echo hello',
            'end',
          ].join('\n'),
        },
      ).initialize();

      it('should return a single include span for unknown variable', () => {
        const doc = workspace.getDocument('functions/empty.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'NONEXISTENT');
        expect(spans).toHaveLength(1);
        expect(spans[0]!.tag).toBe('include');
      });
    });

    describe('nested function scopes with same variable name', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'conf.d/nested.fish',
          content: [
            'set -gx my_var outer',             // line 0: global def
            'echo $my_var',                      // line 1: global ref (include)
            'function outer_fn',                 // line 2
            '    set -l my_var inner',           // line 3: local shadows global
            '    echo $my_var',                  // line 4: local ref (exclude)
            '    function inner_fn',             // line 5
            '        set -l my_var deep',        // line 6: local shadows local
            '        echo $my_var',              // line 7: deep local ref (exclude)
            '    end',                           // line 8
            'end',                               // line 9
            'echo $my_var',                      // line 10: global ref (include)
          ].join('\n'),
        },
      ).initialize();

      it('should exclude both nested function scopes', () => {
        const doc = workspace.getDocument('conf.d/nested.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'my_var');

        const root = analyzer.getRootNode(doc.uri)!;
        const nodesByLine: { line: number; text: string; included: boolean; }[] = [];
        for (const node of nodesGen(root)) {
          if (node.text !== 'my_var' && node.text !== '$my_var') continue;
          nodesByLine.push({
            line: node.startPosition.row,
            text: node.text,
            included: isNodeIncluded(node, spans),
          });
        }

        // Lines 0, 1, 10 should be included (global scope)
        for (const n of nodesByLine.filter(n => [0, 1, 10].includes(n.line))) {
          expect(n.included).toBe(true);
        }

        // Lines 3, 4, 6, 7 should be excluded (inside shadowing functions)
        for (const n of nodesByLine.filter(n => [3, 4, 6, 7].includes(n.line))) {
          expect(n.included).toBe(false);
        }
      });
    });

    describe('local-only file with no broader definition', () => {
      const workspace = TestWorkspace.create().addFiles(
        {
          relativePath: 'functions/local-only.fish',
          content: [
            'function local_only',
            '    set -l my_var value',
            '    echo $my_var',
            'end',
          ].join('\n'),
        },
      ).initialize();

      it('should not create exclude spans when there is no broader definition', () => {
        const doc = workspace.getDocument('functions/local-only.fish')!;
        const spans = analyzer.getScopeSpans(doc, 'my_var');
        // No broader definition to shadow, so everything is include
        expect(spans.every(s => s.tag === 'include')).toBe(true);
      });
    });
  });

  describe('getRenames() blocks prebuilt variables', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    echo $PATH',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should return empty array when renaming $PATH', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      const renames = getRenames(fooDoc, Position.create(1, 10), 'NEW_PATH');
      expect(renames).toEqual([]);
    });
  });

  describe('getDefinition() returns null for prebuilt variables without workspace definition', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    echo $PATH',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should return null for $PATH definition when no set exists', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      const def = analyzer.getDefinition(fooDoc, Position.create(1, 10));
      expect(def).toBeNull();
    });
  });

  describe('getImplementation() returns empty for prebuilt variables', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    echo $PATH',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should return empty array for $PATH implementation', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      const impls = getImplementation(fooDoc, Position.create(1, 10));
      expect(impls).toEqual([]);
    });
  });
});
