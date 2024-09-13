
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  FishDocumentSymbol,
  filterDocumentSymbolInScope,
  flattenNested,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { isCommandName } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { getRange } from '../src/utils/tree-sitter';

import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';
import { SymbolKind } from 'vscode-languageserver';
import { symbolKindToString } from '../src/utils/translation';

setLogger();

describe('analyzer test suite', () => {
  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function setupAndFind(documents: LspDocument[], findUri: string = '') {
    documents.forEach(doc => {
      analyzer.analyze(doc);
    });
    const document = documents.find(doc => doc.uri.endsWith(findUri)) || null;
    return { documents, document };
  }

  describe('workspace symbols', () => {
    it('has workspaceSymbols', () => {

      setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/inner.fish');
      const keys = Array.from(analyzer.workspaceSymbols.keys());
      expect(keys).toBeInstanceOf(Array);
      expect(keys).toEqual([
        'test',
        'foo',
        'nested',
        'private'
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
        'test'
      ]);
    });

    it('local NESTED workspace def `test`', () => {
      const _setup = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
      if (!_setup.document) fail();
      const _cached = analyzer.cached.get(_setup.document.uri!);
      // const { root: rootNode, document: doc } = _cached!;
      if (!_cached) fail();
      const { document, root, symbols } = _cached;
      const focus = TreeSitterUtils.getChildNodes(root).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;

      // const currentNode = getNodeAtPosition(tree, pos)!;
      const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
        symbols,
        pos
      );

      // console.log(localSymbols.map(s => s.name));
      const defSymbol = analyzer.getDefinitionSymbol(document, pos);
      expect(defSymbol?.map(s => s.uri)).toEqual([
        `${document.uri}`
      ]);
    });

    it('local PRIVATE workspace def `test`', () => {
      const _setup = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
      if (!_setup.document) fail();
      const _cached = analyzer.cached.get(_setup.document.uri!);
      if (!_cached) fail();
      const { document, root, symbols } = _cached;

      const focus = TreeSitterUtils.getChildNodes(root).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;

      // const currentNode = getNodeAtPosition(tree, pos)!;
      const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
        symbols,
        pos
      );

      // console.log(localSymbols.map(s => s.name));
      const defSymbol = analyzer.getDefinitionSymbol(document, pos);
      // console.log(defSymbol.map(s => s.uri));
      expect(defSymbol?.map(s => s.uri)).toEqual([ document.uri ]);
      const symbolUri = defSymbol.map(s => s.uri).pop()!;
      expect(symbolUri.endsWith('private.fish')).toBeTruthy();
    });

    it('reference symbols', () => {
      // const { docPrivate } = buildWorkspaceOne();
      const thisTest = createFakeLspDocument('functions/this_test.fish', [
        'function this_test',
        '   function test',
        '       echo "test"',
        '   end',
        '   test', // should be local test
        'end',
        'test' // should be global test
      ].join('\n'));

      const { symbols } = analyzer.analyze(thisTest);
      // console.log(flattenNested(...symbols).map(n => n.name + ' ' + n.scope.scopeTag + '::' + n.scope.scopeNode!.text.split(' ').slice(0, 2).join(' ') + '...'));


      // const { tree, doc, rootNode, flatSymbols, symbols } = docPrivate;
      // const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isFunctionDefinitionName(node) && node.text === 'test')!;
      // const pos = getRange(focus).start;
      // const defSymbol = analyzer.getDefinitionSymbol(doc, pos)
      // 
      //
      //
      // /* is defSymbol `local` or `global` scope*/
      // /** if `global` get all references of a symbol in workspace */
      // const location = analyzer.getValidNodes(doc, defSymbol[0]!)
      // for (const l of location) {
      //   const n = getNodeAtPosition(tree, l.range.start);
      //   console.log(n?.text);
      // }


      // switch (defSymbol[0].scope.scopeTag) {
      //   case 'universal':
      //   case 'global':
      //     /* handle global symbols */
      //     break;
      //   case 'local':
      //   default:
      //     /* handle local symbols */
      //     break;
      // }


      // if (symbol) {
      // const doc = analyzer.getDocument(symbol.uri)!;
      //   /** refactor inside analyzer */
      //   const { scopeTag } = symbol.scope;
      //       switch (scopeTag) {
      //         case 'global':
      //         case 'universal':
      //           return findGlobalLocations(analyzer, doc, symbol.selectionRange.start);
      //         case 'local':
      //         default:
      //           return findLocalLocations(analyzer, document, symbol.selectionRange.start);
      //       }
      // }
      //         position
      //     for (const sym of defSymbol) {
      //       if (sym.scope.scopeTag === 'local') {
      //
      //       }
      //     }


      /* if no local Symbols */
      /** get all references of a symbol in workspace */

      // workspaceSymbols.get(currentNode.text) || [];

      // console.log(defSymbol.map(s => s.name + s.scope.scopeTag));

    });

    it('query: ""', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = '';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test',
        'foo',
        'nested',
        'private'
      ]);
    });

    it('query: "t"', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = 't';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test'
      ]);
    });

    it('completions NESTED "test"', () => {
      const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
      if (!document) fail();

      /** after `test` commandName inside `nested` */
      let pos = { line: 4, character: 7 };
      expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        'nested',
        'test',
      ]);

      /** after final `end` outside of `nested` */
      pos = { line: 5, character: 4 };
      expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        'nested'
      ]);
    });

    it('completions PRIVATE "test"', () => {
      const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
      if (!document) fail();

      // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      // console.log(pos);

      // /** after `test` commandName inside `nested` */
      //   let pos = {line: 1, character: 8};
      //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
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
    it('completions VARIABLES "test"', () => {

      setupAndFind(TestWorkspace.functionsOnly.documents);

      const { document } = analyzer.analyze(createFakeLspDocument('functions/var.fish', [
        'function var',
        '   set -l test 1',
        '   ',
        'end',
        '',
        ''
      ].join('\n')));

      if (!document) fail();

      // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      // console.log(pos);

      // /** after `test` commandName inside `nested` */
      let pos = { line: 2, character: 3 };
      // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        'var',
        'test',
      ])

      /** after final `end` outside of `nested` */
      pos = { line: 4, character: 0 };
      // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
        'var',
      ]);
    });
  });
});