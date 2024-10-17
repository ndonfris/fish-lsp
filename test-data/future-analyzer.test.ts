
import * as Parser from 'web-tree-sitter';
import * as LSP from 'vscode-languageserver';
import { createFakeCursorLspDocument, createFakeLspDocument, setLogger } from './helpers';
import { Simple } from './simple';
import {
  FishDocumentSymbol,
  getFishDocumentSymbols,
} from '../src/utils/symbol';
import { execEscapedSync } from '../src/utils/exec';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { isCommandName } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { getChildNodes, getNodeAtPosition, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';
import { SymbolKind } from 'vscode-languageserver';
import { symbolKindToString } from '../src/utils/translation';
import { flattenNested } from '../src/utils/flatten';

setLogger();

describe('analyzer test suite', () => {
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
        const symbols = getFishDocumentSymbols(doc.uri, tree.rootNode, tree.rootNode);
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
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbols(doc.uri, rootNode);
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

  describe('getDefinitionSymbols()', () => {
    function logDefSymbols(defSymbol: FishDocumentSymbol[]) {
      defSymbol.forEach(({ name, uri, scope: _scope, kind: _kind }, idx) => {
        const scope = _scope.tag;
        const kind = symbolKindToString(_kind);
        console.log({ idx, name, uri, scope, kind });
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
      expect(defSymbol.map(s => s.name)).toEqual([
        'foo',
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
      expect(defSymbol.map(s => s.name)).toEqual([
        'foo',
      ]);
    });

    it('private function', () => {
      const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
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
      // logDefSymbols(defSymbol);
      expect(
        defSymbol.map(({ name, selectionRange, uri, kind }) => ({
          name,
          selectionRange,
          uri: uri.split('/').slice(-2).join('/'),
          kind: symbolKindToString(kind),
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
          scope: 'global',
          range: [0, 0, 0, 14],
          selectionRange: [0, 8, 0, 12],
        },
      ]);
    });
    //
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

    describe.skip('fallback', () => {
      it('fallback: exec script', () => {
        const out = execEscapedSync('type -p alias');
        if (out.startsWith('/') && out.endsWith('.fish')) {
          analyzer.analyzeFilepath(out);
        }
        expect(analyzer.uris).toContain(`file://${out}`);
        expect(analyzer.uris.length).toBeGreaterThan(0);
      });

      it('fallback: global', () => {
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
            scope: s.scope.tag,
          })),
        ).toEqual([
          {
            name: 'alias',
            kind: SymbolKind.Function,
            scope: 'global',
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
      it('$argv: script & function', () => {
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

        expect(item.symbols.flat().map(s => s.name)).toEqual([
          'argv',
          'arg-f',
          'argv',
        ]);
      });

      it('$argv: script', () => {
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
        expect(cache.symbols.flat().map(s => s.name)).toEqual(['argv', 'i']);
      });

      it('`argparse \'h/help\' -- $argv; or return`', () => {
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

        expect(item.symbols.flat().map(s => s.name)).toEqual(flatSymbols.map(s => s.name));
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
    it.only('reference symbols: nested function call', () => {
      // const { rootNode, doc, cursorPosition } = testSymbolFiltering('functions/this_test.fish', [
      //   'function this_test',
      //   '     function inner_test',
      //   '         echo "test"',
      //   '     end',
      //   '     inner_test', // should be local test
      //   'end',
      //   '', // should be global test
      // ].join('\n'));

      const { doc, symbols, tree, uri, flatSymbols } = setupSymbols(TestWorkspace.functionsOnly.documents, 'nested.fish');
      if (!uri || !symbols || !flatSymbols || !tree || !doc) fail();

      // console.log(symbols.map(s => s.name));

      // const { root, nodes } = analyzer.analyze(doc);
      // for (const node of nodes) {
      //   console.log(Simple.node(node));
      // }

      const cursorNode = getChildNodes(tree.rootNode).filter((n) => n.text === 'test' && n.type === 'word').at(1) as Parser.SyntaxNode;
      // for (const node of ) {
      //   console.log(Simple.node(node));
      // }
      const result = analyzer.analyze(doc);
      // console.log(result.symbols.map(s => s.name));
      // const { symbols } = analyzer.cached.get(doc.uri)!;
      for (const s of flattenNested(...result.symbols)) {
        if (s.containsPosition(pointToPosition(cursorNode.startPosition)) && s.name === cursorNode.text) {
          console.log(s.toString(), s.getLocalReferences());
          for (const node of s.getDefinitionAndReferences()) {
            console.log(Simple.node(node));
          }
        }
        // console.log(s.toString());
      }

      const def = analyzer.getDefinitionSymbol(doc, pointToPosition(cursorNode.startPosition)).pop();
      console.log({ def: def?.toString() });
      console.log('defAndRef', def?.getDefinitionAndReferences().map(s => Simple.node(s)));

      // TODO: fix
      const refSymbols = analyzer.getReferences(doc, pointToPosition(cursorNode.startPosition));
      console.log('refSymbols', refSymbols.map(s => Simple.location(s)));

      // expect(refSymbols.length).toEqual(2);
      // refSymbols.forEach(s => console.log(Simple.location(s)));
      // expect(refSymbols.map(s => Simple.location(s))).toEqual([
      //   {
      //     uri: 'functions/this_test.fish',
      //     range: [1, 12, 1, 16],
      //   },
      //   {
      //     uri: 'functions/this_test.fish',
      //     range: [4, 3, 4, 7],
      //   },
      // ]);
    });

    it('reference symbols: nested clobbering global', () => {
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

    it('reference symbols: private clobbering variable', () => {
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

    it('reference symbols: private helper function', () => {
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

    it('reference symbols: conf.d function arguments + variable definition', () => {
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
      // console.log('deffff', Simple.symbol(defSym));
      flattenNested(...analyzer.cached.get(doc.uri).symbols).forEach(s => {
        //   if (isFunctionDefinition(s.parent)) {
        //     console.log(`parent`, Simple.nodeVerbose(s.parent));
        //     s.parent.childrenForFieldName('option').forEach(c => {
        //       console.log('+++grammar', c.text)
        //     })
        //   }
        if (s.name === 'test') {
          console.log('node', Simple.nodeVerbose(s.currentNode), Simple.symbol(s), s.getLocalReferences().map(s => Simple.location(s)));
          //   /*
          //    * @see
          //    * scopeNode.parent === function_definition
          //    */
        }
      });

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

    it('reference symbols: conf.d emit variable function name', () => {
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
          // console.log(Simple.node(node));
        }
      });

      // console.log({ lastPosition });
      const defSymbols = analyzer.getDefinitionSymbol(doc, lastPosition);
      // const curr = rootNode.descendantForPosition(lastPosition);
      defSymbols.forEach((s, i) => console.log(i, Simple.symbol(s)));
      // console.log({node: Simple.symbol(defSymbol)});

      const defSymbol = defSymbols.pop();
      const getAllRefs = () => {
        // console.log('test all refs');
        // console.log(Simple.symbol(defSymbol));

      };
      getAllRefs();

      const refSymbols = analyzer.getReferences(doc, lastPosition);
      console.log('test refs');
      refSymbols.forEach((s, i) => console.log('ref', i, Simple.location(s)));
      // console.log();

      // expect(refSymbols.length).toEqual(5);
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
      // it('completions NESTED "test"', () => {
      //   const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
      //   if (!document) fail();
      //
      //   /** after `test` commandName inside `nested` */
      //   let pos = { line: 4, character: 7 };
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'nested',
      //     'test',
      //   ]);
      //
      //   /** after final `end` outside of `nested` */
      //   pos = { line: 5, character: 4 };
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'nested'
      //   ]);
      // });

      // it('completions PRIVATE "test"', () => {
      //   const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
      //   if (!document) fail();
      //
      //   // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      //   // console.log(pos);
      //
      //   // /** after `test` commandName inside `nested` */
      //   //   let pos = {line: 1, character: 8};
      //   //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //   //     'private',
      //   //   ])
      //   //
      //   //   /** after final `end` outside of `nested` */
      //   //   pos = { line: 5, character: 4 };
      //   //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //   //     'private',
      //   //     'test'
      //   //   ]);
      //   // });
      // });

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
    // describe('completion for index', () => {
    //
    //    it('command completion `t`',  () => {
    //
    //    })
    //
    //    it('variable completion `test $t`',  () => {
    //
    //    })
    //
    //    it('variable completion `$`',  () => {
    //
    //    })
    //
    //    it('command multiline: `cmd \\\n--flag`', () => {
    //
    //    })
    //
    //    it('argument index/distance from command', () => {
    //
    //    })
    //
    //    it('command matches string', () => {
    //
    //    })
    //
    //    it('command w/ flag', () => {
    //
    //    })
    // })
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
  });

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
  //   describe('fish-lsp env variables', () => {
  //       it('$fish_lsp_logsfile', () => {
  //
  //       })
  //
  //       it('$fish_lsp_all_indexed_paths', () => {
  //
  //       })
  //       it('$fish_lsp_show_client_popups', () => {
  //
  //       })
  //
  //       it('$fish_lsp_diagnostic_disable_error_codes', () => {
  //
  //       })
  //       it('$fish_lsp_diagnostic_disable_error_codes 2001', () => {
  //
  //       })
  //   })
  // })

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