
import * as Parser from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { createFakeCursorLspDocument, createFakeLspDocument } from './helpers';
import { setLogger } from './logger-setup';
import { Simple } from './simple';
import {
  FishSymbol,
  getScopedFishSymbols,
} from '../src/utils/symbol';
import { execEscapedSync } from '../src/utils/exec';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { isCommandName, isCommandWithName, isOption } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { getChildNodes, getNodeAtPosition, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';
import { SymbolKind } from 'vscode-languageserver';
import { flattenNested } from '../src/utils/flatten';
import * as Locations from '../src/utils/locations';
import { SyntaxNode } from 'web-tree-sitter';
import { PrebuiltDocumentationMap } from '../src/utils/snippets';
import { getPrebuiltSymbol, getPrebuiltSymbolInfo, hasPrebuiltSymbolInfo } from '../src/features/prebuilt-symbol-info';
import { FishCompletionItem } from '../src/utils/completion/types';

describe('analyzer test suite', () => {
  setLogger();

  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function setupSymbols(documents: LspDocument[], findUri: string = '') {
    for (const doc of documents) {
      if (doc.uri.endsWith(findUri)) {
        const tree = parser.parse(doc.getText()) as Parser.Tree;
        const symbols = getScopedFishSymbols(tree.rootNode, doc.uri);
        analyzer.analyze(doc);
        return { uri: doc.uri, symbols, flatSymbols: flattenNested(...symbols), tree, doc };
      }
    }
    return { uri: '', symbols: [], flatSymbols: [], tree: null, doc: null };
  }

  function testSymbolFiltering(filename: string, _input: string) {
    const { doc, cursorPosition, input } = createFakeCursorLspDocument(filename, _input);
    const tree = parser.parse(doc.getText());
    const { rootNode } = tree;
    const symbols = getScopedFishSymbols(tree.rootNode, doc.uri);
    // console.log({ symbols: symbols.map(s => s.name) });
    const flatSymbols = flattenNested(...symbols);
    const nodes = getChildNodes(rootNode);
    let cursorNode = getNodeAtPosition(tree, cursorPosition)!;
    let fixedCursorPos = cursorPosition;
    if (cursorNode.text.startsWith('$')) {
      fixedCursorPos = { line: cursorPosition.line, character: cursorPosition.character + 1 };
      cursorNode = getNodeAtPosition(tree, fixedCursorPos)!;
    }
    // console.log({ flatSymbolsNames: flatSymbols.map(s => s.name) });
    analyzer.analyze(doc);
    return {
      symbols,
      flatSymbols,
      tree: tree,
      rootNode,
      nodes,
      doc,
      cursorPosition: fixedCursorPos,
      cursorNode,
      input,
    };
  }

  function setupAndFind(documents: LspDocument[], findUri: string = '') {
    documents.forEach(doc => {
      analyzer.analyze(doc);
    });
    const document = documents.find(doc => doc.uri.endsWith(findUri)) || null;
    return { documents, document };
  }

  describe.only('getDefinitionSymbols()', () => {
    function logDefSymbols(defSymbol: FishSymbol[]) {
      defSymbol.forEach((symbol, idx) => {
        console.log({
          idx,
          name: symbol.name,
          uri: symbol.uri,
          modifier: symbol.modifier,
          kind: symbol.kindString,
        });
      });
    }

    it('global function', () => {
      testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '   echo "foo test"',
        'end',
      ].join('\n'));
      const { doc, cursorPosition } = testSymbolFiltering('config.fish', [
        'foo█',
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => ({
        name: s.name,
        modifier: s.modifier,
        uri: Simple.relPath(s.uri),
      }))).toEqual([
        {
          name: 'foo',
          modifier: 'GLOBAL',
          uri: 'functions/foo.fish',
        },
      ]);
    });
    //
    it('local function', () => {
      const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '   echo "foo test"',
        'end',
        'foo█',
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => ({
        name: s.name,
        modifier: s.modifier,
      }))).toEqual([
        {
          name: 'foo',
          modifier: 'GLOBAL',
        },
      ]);
    });

    it('private function', () => {
      const { doc, symbols, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '    __bar█',
        'end',
        '',
        'function __bar',
        '    echo "test"',
        'end',
        '',
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // flattenNested(...symbols).forEach(s => {
      //   if (s.name === '__bar') {
      //     console.log(Simple.symbol(s));
      //     s.getLocalCallableRanges().forEach(r => console.log(Simple.range(r)));
      //   }
      // });
      // logDefSymbols(defSymbol);
      expect(
        defSymbol.map(({ name, selectionRange, uri, kindString, modifier }) => ({
          name,
          selectionRange,
          uri: Simple.relPath(uri),
          kind: kindString,
          modifier,
        })),
      ).toEqual([
        {
          name: '__bar',
          selectionRange: {
            start: { line: 4, character: 9 },
            end: { line: 4, character: 14 },
          },
          uri: 'functions/foo.fish',
          kind: 'function',
          modifier: 'FUNCTION',
        },
      ]);
    });

    it('global var', () => {
      testSymbolFiltering('config.fish', [
        'set -gx test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/testvar.fish', [
        'function testvar',
        '    echo $test█ ',
        'end',
      ].join('\n'));
      const defSymbol = analyzer.getDefinitionSymbol(doc, { line: 1, character: 10 });
      // logDefSymbols(defSymbol);
      expect(defSymbol.length).toEqual(1);
      expect(
        defSymbol.map(symbol => Simple.symbol(symbol)),
      ).toEqual([
        {
          name: 'test',
          uri: 'config.fish',
          kind: 'variable',
          modifier: 'GLOBAL',
          range: [0, 0, 0, 14],
          selectionRange: [0, 8, 0, 12],
        },
      ]);
    });

    it('local var', () => {
      testSymbolFiltering('config.fish', [
        'set -g test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/testvar.fish', [
        'function testvar',
        '    set test 1',
        '    echo $test█',
        'end',
      ].join('\n'));

      expect(cursorPosition).toEqual({ line: 2, character: 10 });

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.length).toEqual(1);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual([
        'functions/testvar.fish',
      ]);
    });

    it('private var', () => {
      testSymbolFiltering('config.fish', [
        'set -g test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('conf.d/testvar.fish', [
        'function testvar -a __test',
        '    echo $__test█',
        'end',
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual(['conf.d/testvar.fish']);
    });
    //
    it('nested var', () => {
      testSymbolFiltering('config.fish', [
        'set -gx _test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/nested.fish', [
        'function nested',
        '    function test-nest',
        '        echo "$_test█"',
        '    end',
        'end',
      ].join('\n'));

      // console.log({cursorPosition})
      // console.log({cursorPosition, uris: analyzer.uris, ws: analyzer.workspaceSymbols.get('_test').map(s => s.debugString())});
      // for (const [uri, entry] of analyzer.cachedEntries) {
      //   console.log(uri);
      //   console.log(entry.nodes.map(n => ({'start': n.startPosition, text: n.text, type: n.type})));
      // }
      const defSymbol = analyzer.getDefinitionSymbol(doc, { line: 2, character: 15 });
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual(['config.fish']);
    });

    describe('fallback', () => {
      it('fallback: exec script', () => {
        const out = execEscapedSync('type -p alias');
        if (out.startsWith('/') && out.endsWith('.fish')) {
          analyzer.analyzeFilepath(out);
        }
        expect(analyzer.uris).toContain(`file://${out}`);
        expect(analyzer.uris.length).toBeGreaterThan(0);
      });

      it.only('fallback: global', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'alias█',

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(analyzer.uris.length).toBeGreaterThan(1);
        expect(
          defSymbol.map(s => ({
            name: s.name,
            kind: s.kind,
            modifier: s.modifier,
          })),
        ).toEqual([
          {
            name: 'alias',
            kind: SymbolKind.Function,
            modifier: 'GLOBAL',
          },
        ]);
      });

      it('fallback: Does Not Exist', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'abbr█',

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('fallback: invalid/builtin', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'string█',

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('fallback: command', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'fzf█',
        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('analyzer.getDefinitionSymbol() use fallback', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'fisher█',
        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(1);
        expect(analyzer.uris.length).toBeGreaterThan(1);
      });
    });

    describe('special cases', () => {
      it.only('$argv: script & function', () => {
        const { flatSymbols, doc } = testSymbolFiltering('farg-f.fish', [
          'function arg-f',
          '    echo $argv█',
          'end',
          '',
        ].join('\n'));

        expect(flatSymbols.length).toEqual(3);
        expect(flatSymbols.map(s => s.name)).toEqual([
          'argv',
          'arg-f',
          'argv',
        ]);
        const item = analyzer.cached.get(doc.uri);
        if (!item) fail();

        expect(flattenNested(...item.symbols).map(s => s.name)).toEqual([
          'argv',
          'arg-f',
          'argv',
        ]);
      });

      it.only('$argv: script', () => {
        const { doc } = testSymbolFiltering('scripts/arg-s.fish', [
          '#!/usr/bin/env fish',
          'echo $argv█',
          'printf',
          'for i in (seq 1 10)',
          '    echo $i',
          'end',
        ].join('\n'));
        const cache = analyzer.cached.get(doc.uri);
        if (!cache) fail();
        expect(flattenNested(...cache.symbols).map(s => s.name)).toEqual(['argv', 'i']);
      });

      it.only('`argparse \'h/help\' -- $argv; or return`', () => {
        const { flatSymbols, doc } = testSymbolFiltering('functions/argparse-test.fish', [
          'function argparse-test',
          '    argparse --name=argparse-test h/help \'n/name=\' \'p/path=!test -d "$_flag_value"\' s long -- $argv',
          '    or return█',
          'end',
        ].join('\n'));

        expect(flatSymbols.length).toEqual(10);
        expect(flatSymbols.map(s => s.name)).toEqual([
          'argparse-test',
          'argv',
          '_flag_h',
          '_flag_help',
          '_flag_n',
          '_flag_name',
          '_flag_p',
          '_flag_path',
          '_flag_s',
          '_flag_long',
        ]);

        const item = analyzer.cached.get(doc.uri);
        if (!item) fail();

        expect(flattenNested(...item.symbols).map(s => s.name)).toEqual(flatSymbols.map(s => s.name));
      });

      /**
       * the next two variables we don't include in the Symbols Array
       *  because they duplicate input list
       */
      //   it('$status', () => {
      //     const { flatSymbols, doc } = testSymbolFiltering('functions/_status.fish', [
      //       'function _status',
      //       '    set -q unknown_variable',
      //       '    echo "status: $status█"',
      //       'end',
      //     ].join('\n'));
      //     expect(flatSymbols.length).toEqual(1);
      //     expect(flatSymbols.map(s => s.name)).toEqual(['status']);
      //     const item = analyzer.cached.get(doc.uri);
      //     if (!item) fail();
      //     expect(item.symbols.flat().map(s => s.name)).toEqual(['status']);
      //   })
      //
      //   it('$pipestatus', () => {
      //   })
    });
  });

  // @TODO
  describe('getReferences()', () => {
    // it.only('reference symbols: nested function call', () => {
    //   // const { rootNode, doc, cursorPosition } = testSymbolFiltering('functions/this_test.fish', [
    //   //   'function this_test',
    //   //   '     function inner_test',
    //   //   '         echo "test"',
    //   //   '     end',
    //   //   '     inner_test', // should be local test
    //   //   'end',
    //   //   '', // should be global test
    //   // ].join('\n'));
    //
    //   const { doc, symbols, tree, uri, flatSymbols } = setupSymbols(TestWorkspace.functionsOnly.documents, 'nested.fish');
    //   if (!uri || !symbols || !flatSymbols || !tree || !doc) fail();
    //
    //   // console.log(symbols.map(s => s.name));
    //
    //   // const { root, nodes } = analyzer.analyze(doc);
    //   // for (const node of nodes) {
    //   //   console.log(Simple.node(node));
    //   // }
    //
    //   const cursorNode = getChildNodes(tree.rootNode).filter((n) => n.text === 'test' && n.type === 'word').at(1) as Parser.SyntaxNode;
    //   // for (const node of ) {
    //   //   console.log(Simple.node(node));
    //   // }
    //   const result = analyzer.analyze(doc);
    //   // console.log(result.symbols.map(s => s.name));
    //   // const { symbols } = analyzer.cached.get(doc.uri)!;
    //   for (const s of flattenNested(...result.symbols)) {
    //     if (s.containsPosition(pointToPosition(cursorNode.startPosition)) && s.name === cursorNode.text) {
    //       console.log(s.toString(), s.getLocalReferences());
    //       for (const node of s.getDefinitionAndReferences()) {
    //         console.log(Simple.node(node));
    //       }
    //     }
    //     // console.log(s.toString());
    //   }
    //
    //   const def = analyzer.getDefinitionSymbol(doc, pointToPosition(cursorNode.startPosition)).pop();
    //   console.log({ def: def?.toString() });
    //   console.log('defAndRef', def?.getDefinitionAndReferences().map(s => Simple.node(s)));
    //
    //   // TODO: fix
    //   const refSymbols = analyzer.getReferences(doc, pointToPosition(cursorNode.startPosition));
    //   console.log('refSymbols', refSymbols.map(s => Simple.location(s)));
    //
    //   // expect(refSymbols.length).toEqual(2);
    //   // refSymbols.forEach(s => console.log(Simple.location(s)));
    //   // expect(refSymbols.map(s => Simple.location(s))).toEqual([
    //   //   {
    //   //     uri: 'functions/this_test.fish',
    //   //     range: [1, 12, 1, 16],
    //   //   },
    //   //   {
    //   //     uri: 'functions/this_test.fish',
    //   //     range: [4, 3, 4, 7],
    //   //   },
    //   // ]);
    // });

    it.only('reference symbols: nested clobbering global', () => {
      const cached_1 = testSymbolFiltering('conf.d/nested.fish', [
        'function nested',
        '   function test',
        '       echo "test"',
        '   end',
        '   test',
        'end',
        'set -gx global_arg 1',
      ].join('\n'));
      analyzer.analyze(cached_1.doc);
      const { flatSymbols, doc, cursorPosition } = testSymbolFiltering('farg-f.fish', [
        'function farg-f',
        '    echo $global_arg█',
        'end',
        '',
      ].join('\n'));

      // expect(flatSymbols.length).toEqual(3);
      const refSymbols = analyzer.getReferences(doc, { line: 1, character: 10 });
      expect(refSymbols.map(s => Simple.location(s))).toEqual([
        { uri: 'conf.d/nested.fish', range: [6, 8, 6, 18] },
        { uri: 'fish/farg-f.fish', range: [1, 10, 1, 20] },
      ]);
    });

    it.only('reference symbols: private clobbering variable', () => {
      analyzer.analyze(createFakeLspDocument('conf.d/public.fish', [
        'set -gx test 1',
      ].join('\n')));

      const { doc, cursorPosition } = testSymbolFiltering('functions/private.fish', [
        'function private',
        '    set -l test 1',
        '    echo $test█',
        'end',
      ].join('\n'));
      const refSymbols = analyzer.getReferences(doc, cursorPosition);
      // refSymbols.forEach(s => console.log(Simple.location(s)));
      expect(refSymbols.map(s => Simple.location(s))).toEqual([
        { uri: 'functions/private.fish', range: [1, 11, 1, 15] },
        { uri: 'functions/private.fish', range: [2, 10, 2, 14] },
      ]);
    });

    it.only('reference symbols: private helper function', () => {
      const { doc, cursorPosition } = testSymbolFiltering('functions/public.fish', [
        'function public',
        '    private█',
        'end',
        'function private',
        '    set -l test 1',
        '    echo $test',
        'end',
      ].join('\n'));

      const refSymbols = analyzer.getReferences(doc, cursorPosition);
      // refSymbols.forEach(s => console.log(Simple.location(s)));
      expect(refSymbols.map(s => Simple.location(s))).toEqual([
        { uri: 'functions/public.fish', range: [1, 4, 1, 11] },
        { uri: 'functions/public.fish', range: [3, 9, 3, 16] },
      ]);
    });

    it.only('reference symbols: conf.d function arguments + variable definition', () => {
      const { doc, cursorPosition } = testSymbolFiltering('conf.d/public.fish', [
        'function public -a test',
        '    $test█',
        'end',
        '',
        'set -l test 1',
        'public $test',
        '',
      ].join('\n'));

      const refSymbols = analyzer.getReferences(doc, cursorPosition);
      // refSymbols.forEach(s => console.log(Simple.location(s)));
      expect(refSymbols.map(s => Simple.location(s))).toEqual([
        { uri: 'conf.d/public.fish', range: [0, 19, 0, 23] },
        { uri: 'conf.d/public.fish', range: [1, 5, 1, 9] },
      ]);
    });

    // TODO: error in getReferences
    it.only('reference symbols: conf.d variable definition - function arguments', () => {
      const { rootNode, doc, cursorPosition } = testSymbolFiltering('conf.d/public.fish', [
        'function public -a test',
        '    $test',
        'end',
        '',
        'set -l test 1',
        'public $test█',
        '',
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);

      // expect(defSymbol.map(s => Simple.symbol(s))).toEqual([ {
      //   name: 'test',
      //   uri: 'conf.d/public.fish',
      //   kind: 'variable',
      //   scope: 'local',
      //   range: [ 4, 0, 4, 13 ],
      //   selectionRange: [ 4, 7, 4, 11 ]
      // } ]);
      //

      const defSym = defSymbol.pop();
      expect(Simple.symbol(defSym)).toEqual({
        name: 'test',
        uri: 'conf.d/public.fish',
        kind: 'variable',
        modifier: 'LOCAL',
        range: [4, 0, 4, 13],
        selectionRange: [4, 7, 4, 11],
      });
      // if (defSym) {
      //   console.log(
      //     'deffff',
      //     Simple.symbol(defSym),
      //     analyzer.getReferences(doc, cursorPosition).map(s => Simple.location(s)),
      //   );
      // }
      const refSyms = analyzer.getReferences(doc, cursorPosition);
      expect(refSyms.map(s => Simple.location(s))).toEqual([
        { uri: 'conf.d/public.fish', range: [4, 7, 4, 11] },
        { uri: 'conf.d/public.fish', range: [5, 8, 5, 12] },
      ]);

      // flattenNested(...analyzer.cached.get(doc.uri).symbols).forEach(s => {
      //   //   if (isFunctionDefinition(s.parent)) {
      //   //     console.log(`parent`, Simple.nodeVerbose(s.parent));
      //   //     s.parent.childrenForFieldName('option').forEach(c => {
      //   //       console.log('+++grammar', c.text)
      //   //     })
      //   //   }
      //   // if (s.name === 'test') {
      //   //   console.log('node', Simple.nodeVerbose(s.node), Simple.symbol(s), s.getLocalCallableRanges().map(r => Simple.range(r)));
      //   //   //   /*
      //   //   //    * @see
      //   //   //    * scopeNode.parent === function_definition
      //   //   //    */
      //   // }
      // });

      // const refSymbols = analyzer.getReferences(doc, cursorPosition);
      //
      // analyzer.findLocalLocations(doc, cursorPosition).forEach((s: LSP.Location) => {
      //   const node = rootNode.descendantForPosition(TreeSitterUtils.rangeToPoint(s.range));
      //   // if (isVariable(node)) {
      //   // console.log('s', Simple.node(node));
      //   // }
      // });
      // console.log('a', Simple.node(node));
      // })
      // const analyzer.findLocalLocations(doc, cursorPosition)

      // CAUSES ERROR:
      // refSymbols.forEach(s => console.log('s', Simple.location(s)));
      // console.log();

      // expect(refSymbols.map(s => Simple.location(s))).toEqual([
      //   { uri: 'conf.d/public.fish', range: [ 4, 7, 4, 11 ] },
      //   { uri: 'conf.d/public.fish', range: [ 5, 8, 5, 12 ] }
      // ]);
    });

    it.only('reference symbols: conf.d emit variable function name', () => {
      const { rootNode, doc /*, cursorPosition, cursorNode*/ } = testSymbolFiltering('conf.d/beep.fish', [
        'function notify',
        '    set -l job (jobs -l -g)',
        '    or begin; echo "There are no jobs" >&2; return 1; end',
        '    ',
        '    function _notify_job_$job --on-job-exit $job --inherit-variable job',
        '        echo -n \\a # beep',
        '        functions -e _notify_job_$job',
        '    end',
        'end',
        '',
      ].join('\n'));

      analyzer.analyze(doc);

      let lastPosition: LSP.Position;
      getChildNodes(rootNode).forEach(node => {
        if (node.text === 'job') {
          lastPosition = pointToPosition(node.startPosition);
        }
      });

      const defSymbols = analyzer.getDefinitionSymbol(doc, lastPosition);
      expect(defSymbols.map(d => Simple.symbol(d))).toEqual([
        {
          name: 'job',
          uri: 'conf.d/beep.fish',
          kind: 'variable',
          modifier: 'LOCAL',
          range: [1, 4, 1, 27],
          selectionRange: [1, 11, 1, 14],

        },
      ]);
      // defSymbols.forEach((s, i) => console.log(i, Simple.symbol(s)));

      // const defSymbol = defSymbols.pop();
      const refSymbols = analyzer.getReferences(doc, lastPosition);
      expect(refSymbols.length).toEqual(5);
      expect(refSymbols.map(ref => Simple.location(ref))).toEqual([
        { uri: 'conf.d/beep.fish', range: [1, 11, 1, 14] },
        { uri: 'conf.d/beep.fish', range: [4, 26, 4, 29] },
        { uri: 'conf.d/beep.fish', range: [4, 45, 4, 48] },
        { uri: 'conf.d/beep.fish', range: [4, 68, 4, 71] },
        { uri: 'conf.d/beep.fish', range: [6, 34, 6, 37] },
      ]);
    });
  });

  // @TODO: implement WorkspaceSymbol
  describe('WorkspaceSymbol', () => {
    it('simple `.hasWorkspaceSymbols`', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/inner.fish');
      const keys = Array.from(analyzer.workspaceSymbols.keys());
      expect(keys).toBeInstanceOf(Array);
      expect(keys).toEqual([
        'test',
        'foo',
        'nested',
        'private',
      ]);
    });

    it('global workspaceSymbols `test` def', () => {
      const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/foo.fish');

      if (!document) fail();
      const _cached = analyzer.cached.get(document.uri);
      const { root: rootNode, document: doc } = _cached!;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos);
      // console.log(defSymbol?.map(s => s.detail));
      expect(defSymbol?.map(s => s.name)).toEqual([
        'test',
      ]);
    });

    it('query: ""', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = '';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test',
        'foo',
        'nested',
        'private',
      ]);
    });

    it('query: "t"', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = 't';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test',
      ]);
    });
  });

  // @TODO: implement completions tests
  describe('completions', () => {
    describe('completions from FishDocumentSymbol', () => {
      it('completions NESTED "test"', () => {
        const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
        if (!document) fail();

        /** after `test` commandName inside `nested` */
        let pos = { line: 4, character: 7 };
        expect(analyzer.getCompletionSymbols(document, pos).map(s => s.label)).toEqual([
          'nested',
          'test',
        ]);

        /** after final `end` outside of `nested` */
        pos = { line: 5, character: 4 };
        expect(analyzer.getCompletionSymbols(document, pos).map(s => s.label)).toEqual([
          'nested',
        ]);
      });

      it.only('completions PRIVATE "test"', () => {
        const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
        if (!document) fail();
        const nodes = analyzer.cached.get(document.uri)?.nodes || [];

        let pos = Locations.Position.fromSyntaxNode(nodes.find(s => isCommandName(s) && s.text === 'test'));
        const result: FishCompletionItem[] = analyzer.getCompletionSymbols(document, pos);
        console.log(result.length);

        // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
        // console.log(pos);

        // /** after `test` commandName inside `nested` */
        pos = { line: 1, character: 8 };
        console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.label));
        //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        //     'private',
        //   ])
        //
        //   /** after final `end` outside of `nested` */
        //   pos = { line: 5, character: 4 };
        //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
        //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        //     'private',
        //     'test'
        //   ]);
        // });
      });

      /**
       * WRONG!!!
       */
      // it('completions VARIABLES "test"', () => {
      //
      //   setupAndFind(TestWorkspace.functionsOnly.documents);
      //
      //   const { document } = analyzer.analyze(createFakeLspDocument('functions/var.fish', [
      //     'function var',
      //     '   set -l test 1',
      //     '   ',
      //     'end',
      //     '',
      //     ''
      //   ].join('\n')));
      //
      //   if (!document) fail();
      //
      //   // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      //   // console.log(pos);
      //
      //   // /** after `test` commandName inside `nested` */
      //   let pos = { line: 2, character: 3 };
      //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'var',
      //     'test',
      //   ])
      //
      //   /** after final `end` outside of `nested` */
      //   pos = { line: 4, character: 0 };
      //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'var',
      //   ]);
      // });
    });

    //
    // @TODO: implement tests
    describe('completion for index', () => {
      it.only('command completion `t`', () => {
        const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/foo.fish');
        if (!document) fail();
        const { doc, cursorPosition } = testSymbolFiltering('functions/testvar.fish', [
          'function testvar',
          '    set test 1',
          '    echo $test█',
          'end',
        ].join('\n'));

        const cmd = analyzer.commandNodeAtPoint(doc.uri, cursorPosition.line, cursorPosition.character);
        // console.log(cmd.text);
        const argumentIdx = analyzer.commandArgumentIndexAtPoint(doc.uri, cursorPosition.line, cursorPosition.character);
        // console.log({ argumentIdx });
        const cmdName = analyzer.commandNameAtPoint(doc.uri, cursorPosition.line, cursorPosition.character);
        // console.log({ cmdName });
        expect(cmdName).toEqual('echo');
        expect(argumentIdx).toEqual(1);
        expect(cmd.text).toEqual('echo $test');
      });

      it('variable completion `test $t`', () => {
        let input = 'echo a';

        const { doc, cursorPosition } = testSymbolFiltering('config.fish', input);
        const pos = Locations.Position.create(0, 5);
        analyzer.analyze(doc);

        const cmd = analyzer.commandNodeAtPoint(doc.uri, pos.line, pos.character);
        const cmdName = analyzer.commandNameAtPoint(doc.uri, pos.line, pos.character);
        const argumentIdx = analyzer.commandArgumentIndexAtPoint(doc.uri, pos.line, pos.character);
        console.log({
          text: cmd?.text ?? '',
          cmdName,
          argumentIdx,
          pos: pos,
          input: input.length,
        });
        input += ' b';
        testSymbolFiltering('config.fish', input);
        let newPos = Locations.Position.create(0, input.length - 1);
        let argIdx = analyzer.commandArgumentIndexAtPoint(doc.uri, newPos.line, newPos.character);
        console.log({ argIdx, newPos });
        input += ' ';
        const { doc: document } = testSymbolFiltering('config.fish', input);
        newPos = Locations.Position.create(0, input.length - 2);
        const line = document.getLineBeforeCursor(newPos);
        console.log({ line });
        const cmdNode = analyzer.commandNodeAtPoint(doc.uri, newPos.line, newPos.character);
        argIdx = analyzer.commandArgumentIndexAtPoint(doc.uri, newPos.line, newPos.character);
        console.log({ text: cmdNode.text, argIdx, newPos });
      });

      it.only('variable completion `$`', () => {
        const wrapInput = (input: string) => {
          const { doc, rootNode } = testSymbolFiltering('config.fish', input);
          const cursorPosition = Locations.Position.create(0, input.length - 1);
          return { doc, rootNode, cursorPosition };
        };
        const res: SyntaxNode[] = [];
        [
          'echo a',
          'echo a ',
          'echo a b',
          'echo a b c',
          'echo a b c;',
          'echo a b c;\\nfunction f',
          'echo a b c;\\nfunction f ',
        ].forEach((input, i) => {
          const { doc, rootNode, cursorPosition } = wrapInput(input);
          analyzer.analyze(doc);
          const { /* argumentIndex, commandName, isLastNode, lastCommand, */ lastNode } =
            analyzer.analyzeCursorPosition(doc.uri, cursorPosition.line, cursorPosition.character);
          res.push(lastNode);
          // console.log({
          //   i,
          //   text: doc.getText(),
          //   doc: { uri: doc.uri, version: doc.version },
          //   pos: cursorPosition,
          //   argumentIndex,
          //   commandName,
          //   // isLastAfterNode: isAfterLastNode.toString(),
          //   isLastNode: isLastNode?.toString(),
          //   lastCommand: lastCommand?.text.toString(),
          //   lastNode: lastNode?.text.toString(),
          //   lastNodePos: {
          //     start: lastNode.startPosition,
          //     end: lastNode.endPosition,
          //   },
          // });
        });
        expect(res.map(n => n.text)).toEqual([
          'a',
          'a',
          'b',
          'c',
          'c',
          'f',
          'f',
        ]);
      });
    });

    it('command multiline: `cmd \\\n--flag`', () => {

    });

    it('argument index/distance from command', () => {

    });

    it('command matches string', () => {

    });

    it('command w/ flag', () => {

    });
  });
  //
  // @TODO: implement tests
  // describe('special coses', () => {
  //   it('`$argv`', () => {
  //
  //   })
  //   it('`$status`', () => {
  //
  //   })
  //   it('`$pipestatus`', () => {
  //
  //   })
  //   it('`argparse` inside function', () => {
  //
  //   })
  //   it('`argparse` autoloaded completion from uri', () => {
  //
  //   })
  //   it('`complete -c ${_}` autoloaded uri name', () => {
  //
  //   })
  //   it('sort locality', () => {
  //
  //   })
  // })
  //
  // });

  // @TODO
  // describe('getHover()', () => {
  //   it('builtin echo', () =. {
  //
  //   })
  //   it('command ls', () =. {
  //
  //   })
  //   it('pipe |', () =. {
  //
  //   })
  //   it('redirect &>', () =. {
  //
  //   })
  //   it('return 1', () =. {
  //
  //   })
  //
  //   it('variable $argv', () => {
  //
  //   })
  //   it('variable $status', () => {
  //
  //   })
  //   it('variable $pipestatus', () => {
  //
  //   })
  //
  //   it('cmd --flag', () => {
  //
  //   })
  //
  //   it('cmd -f', () => {
  //
  //   })
  //
  //   it('cmd subcmd', () => {
  //
  //   })
  //
  //   it(`if cmd1; and`, () => {
  //
  //   })
  //
  //   if(`for i in (seq 1 10); echo $i`, () => {
  //
  //   })
  //
  //   if(`for i in (seq 1 10); echo $i; end`, () => {
  //
  //   })
  //
  //   it('special function: `fish_greeting`', () => {
  //
  //   })
  //
  //   it(`special string: \`status\` doesn't overwrite $status`, () => {
  //
  //   })
  //
  //   it(`special sequence: \`cmd \\\n --flag\``, () => {
  //
  //   })
  //
  //   it(`special sequence: (regexString) \`string match -r '\w\``, () => {
  //
  //   })
  //
  //   it(`special sequence: (escape) \`printf %\``, () => {
  //
  //   })
  //
  //   it(`special sequence: \`#comment\``, () => {
  //     // skip comments
  //   })
  //
  describe('fish-lsp env variables', () => {
    it('$fish_lsp_enabled_handlers', () => {
      const { doc, rootNode, symbols } = testSymbolFiltering('config.fish', ` 
  set -x fish_lsp_enabled_handlers 'formatting' 'complete' 'hover' # 'rename' 'definition' 'references' 'diagnostics' 'signatureHelp' 'codeAction' 'index'
       `);

      const focusedItem = getChildNodes(rootNode).find((n) => {
        return n.text === '\'hover\'';
      });

      // console.log(focusedItem?.text, focusedItem?.startPosition, focusedItem?.endPosition);
      const loc = Locations.Position.fromPoint(focusedItem!.startPosition);
      const cmd = analyzer.commandNodeAtPoint(doc.uri, loc.line, loc.character)!;
      console.log(cmd.text, '|', cmd.type);
      if (isCommandWithName(cmd, 'set', 'read')) {
        const v = cmd.childrenForFieldName('argument').find(n => !isOption(n));
        console.log('v', v?.text);
        cmd?.descendantsOfType('argument').forEach(a => {
          console.log(a.text, '|', a.type);
        });
        console.log();
      }

      const fishLspEnvVariable = flattenNested(...symbols).find((sym) => {
        if (sym.isFunction()) return false;
        return sym.isVariable() && ['set', 'read'].includes(sym.getParentKeyword())
          && Locations.Range.containsRange(
            Locations.Range.fromNode(sym.parentNode),
            Locations.Range.fromNode(focusedItem),
          ) && PrebuiltDocumentationMap.getByName(sym.name);
      });

      console.log(getPrebuiltSymbolInfo(fishLspEnvVariable));
      // const hover = analyzer.getHover(doc);
      // console.log(hover);
    });

    it.only('$fish_lsp_all_indexed_paths', () => {
      const { doc, rootNode, symbols } = testSymbolFiltering('config.fish', ` 
set -x fish_lsp_all_indexed_paths $HOME/.config/fish/ /usr/share/fish $HOME/.local/share/fish
       `);

      const focusedItem = getChildNodes(rootNode).find((n) => {
        return n.text === '$HOME/.local/share/fish';
      });
      const isPrebuiltSymbol = hasPrebuiltSymbolInfo(focusedItem, flattenNested(...symbols));
      const symbol = getPrebuiltSymbol(focusedItem, flattenNested(...symbols));
      if (isPrebuiltSymbol) {
        // console.log(getPrebuiltSymbolInfo(symbol));
        expect(getPrebuiltSymbolInfo(symbol))
          .toMatch(`\`\`\`fish
$fish_lsp_all_indexed_paths
\`\`\`
___
fishlsp variable

fish file paths to include as workspaces (default: ['/usr/share/fish', '$HOME/.config/fish'])
___
**Path:** *~/.config/fish/config.fish*
**Scope:** GLOBAL
**Exported:** true
___
\`\`\`fish
set -x fish_lsp_all_indexed_paths $HOME/.config/fish/ /usr/share/fish $HOME/.local/share/fish
\`\`\``,
          );
      }
    });

    it.only('$fish_lsp_show_client_popups', () => {
      const { doc, rootNode, symbols } = testSymbolFiltering('config.fish', ` 
set -x fish_lsp_show_client_popups true
       `);
      const focusedItem = getChildNodes(rootNode).find((n) => {
        return n.text === 'true';
      });
      const isPrebuiltSymbol = hasPrebuiltSymbolInfo(focusedItem, flattenNested(...symbols));
      const symbol = getPrebuiltSymbol(focusedItem, flattenNested(...symbols));
      expect(isPrebuiltSymbol).toBeTruthy();
      if (isPrebuiltSymbol) {
        // console.log(getPrebuiltSymbolInfo(symbol));
        expect(getPrebuiltSymbolInfo(symbol)).toBeTruthy();
      }
    });

    it.only('fish_add_path', () => {
      const { doc, rootNode, symbols } = testSymbolFiltering('config.fish', ` 
fish_add_path --append $HOME/.local/bin
fish_add_path --append /usr/local/bin
       `);

      const focusedItem = getChildNodes(rootNode).find((n) => {
        return n.text === '/usr/local/bin';
      });
      // const isPrebuiltSymbol = hasPrebuiltSymbolInfo(focusedItem, flattenNested(...symbols));
      const symbol = analyzer.getPrebuiltSymbol(doc, Locations.Position.fromPoint(focusedItem?.endPosition));
      // console.log(symbol);
      expect(symbol).toBeTruthy();
      if (symbol) {
        // console.log(getPrebuiltSymbolInfo(symbol));
        expect(getPrebuiltSymbolInfo(symbol)).toBeTruthy();
      }
    });

    // it('$fish_lsp_diagnostic_disable_error_codes', () => {
    //
    // });
    // it('$fish_lsp_diagnostic_disable_error_codes 2001', () => {
    //
    // });
  });

  // @TODO
  // describe('getSignatureHelp()', () => {
  // })

  // @TODO
  // describe('public properties', () => {
  //     it('cached', () => {
  //
  //     })
  //     it('cachedEntries', () => {
  //
  //     })
  //     it('workspaceSymbols', () => {
  //
  //     })
  //     it('documents', () => {
  //
  //     })
  //     it('uris', () => {
  //
  //     })
  //     it('symbols', () => {
  //
  //     })
  //     it('sourcedFiles', () => {
  //
  //     })
  //
  // })

  // @TODO
  // describe('analyzeFilepath(filepath: string)', () => {
  //
  //     it('analyzeFilepath: normal', () => {
  //
  //     })
  //     it('analyzeFilepath: `config.fish` function', () => {
  //
  //     })
  //     it('analyzeFilepath: `config.fish` variable', () => {
  //
  //     })
  //     it('analyzeFilepath: invalid', () => {
  //
  //     })
  //     it('analyzeFilepath: empty', () => {
  //
  //     })
  //     it('analyzeFilepath: non-existent', () => {
  //
  //     })
  //
  //     it('analyzeFilepath + findDefinition()', () => {
  //
  //     })
  // })

  // @TODO
  // describe('initializeBackgroundAnalysis()', () => {
  //     it('small', () => {
  //
  //     })
  //     it('medium', () => {
  //
  //     })
  //     it('large', () => {
  //
  //     })
  // })

  // @TODO
  // describe(`config change`, () => {
  //    it('source: `fish_lsp_diagnostic_disable_error_codes`', () => {
  //
  //    })
  //
  //    it('source: `fish_lsp_show_client_popups`', () => {
  //
  //    })
  //
  //    it('client: fish-lsp.diagnostic.disableErrorCodes', () => {
  //
  //    })
  //
  //    it('client: fish-lsp.showClientPopups', () => {
  //
  //    })
  // })

  // @TODO
  // describe('rename/textEdit', () => {
  // })
  //
  // @TODO
  // describe('FishDocumentSymbol[]', () => {
  //    it('document: `functions/inner.fish`', () => {
  //
  //    })
  //    it('document: `functions/nested.fish`', () => {
  //
  //    })
  //    it('document: `functions/private.fish`', () => {
  //
  //    })
  //    it('onFoldingRange()', () => {
  //
  //    })
  //
  //    it('onDocumentSymbol()', () => {
  //
  //    })
  // })

  // @TODO
  // describe('inlayHint', () => {
  //
  // })
});