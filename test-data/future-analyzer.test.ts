
import os from 'os';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  FishDocumentSymbol,
  filterDocumentSymbolInScope,
  filterWorkspaceSymbol,
  flattenNested,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { Position, SymbolKind } from 'vscode-languageserver';
import { isCommandName, isFunctionDefinitionName, isSourceFilename } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { SyncFileHelper } from '../src/utils/file-operations';
import { Range } from '../src/utils/locations';
import { containsRange, getNodeAtPosition, getRange } from '../src/utils/tree-sitter';

import { Analyzer } from '../src/future-analyze';

setLogger();

describe('analyzer test suite', () => {
  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function setupTest(filename: string, content: string) {
    const doc = createFakeLspDocument(filename, content);
    const { rootNode } = parser.parse(doc.getText());
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(doc.uri, rootNode);
    const flatSymbols = flattenNested(...symbols);
    analyzer.analyze(doc);

    return {
      symbols,
      flatSymbols,
      rootNode,
      doc,
      tree: parser.parse(content),
    };

  }

  function buildWorkspaceOne() {
    const docTest = setupTest('functions/test.fish', [
      'function test',
      '    echo hi',
      'end'
    ].join('\n'));
    const docFoo = setupTest('functions/foo.fish', [
      'function foo',
      '   test',
      'end'
    ].join('\n'));
    const docNested = setupTest('functions/nested.fish', [
      'function nested',
      '   function test',
      '       echo "inside test"',
      '   end',
      '   test',
      'end'
    ].join('\n'));

    const docPrivate = setupTest('functions/private.fish', [
      'function private',
      '   test',
      'end',
      'function test',
      '    echo "inside test"',
      'end',
    ].join('\n'));


    return { docTest, docFoo, docNested, docPrivate };
  }

  describe('workspace symbols', () => {
    it('has workspaceSymbols', () => {
      buildWorkspaceOne();
      const keys = Array.from(analyzer.workspaceSymbols.keys());
      expect(keys).toBeInstanceOf(Array);
      expect(keys).toEqual([
        'test',
        'foo',
        'nested',
        'private'
      ]);
    });

    it('workspaceSymbols `test` def', () => {
      const { docFoo } = buildWorkspaceOne();
      const { doc, rootNode } = docFoo;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos);
      // console.log(defSymbol?.map(s => s.detail));
      expect(defSymbol?.map(s => s.name)).toEqual([
        'test'
      ]);
    });

    it('local NESTED workspace def `test`', () => {
      const { docNested } = buildWorkspaceOne();
      const { tree, doc, rootNode, flatSymbols, symbols } = docNested;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;

      // const currentNode = getNodeAtPosition(tree, pos)!;
      const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
        symbols,
        pos
      );

      // console.log(localSymbols.map(s => s.name));
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos);
      expect(defSymbol?.map(s => s.uri)).toEqual([
        `${doc.uri}`
      ]);
    });

    it('local PRIVATE workspace def `test`', () => {
      const { docPrivate } = buildWorkspaceOne();
      const { tree, doc, rootNode, flatSymbols, symbols } = docPrivate;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;

      // const currentNode = getNodeAtPosition(tree, pos)!;
      const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
        symbols,
        pos
      );

      // console.log(localSymbols.map(s => s.name));
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos);
      // console.log(defSymbol.map(s => s.uri));
      expect(defSymbol?.map(s => s.uri)).toEqual([doc.uri]);
      const symbolUri = defSymbol.map(s => s.uri).pop()!
      expect(symbolUri.endsWith('private.fish')).toBeTruthy()
    });

    it('reference symbols', () => {
      const { docPrivate } = buildWorkspaceOne();
      const { tree, doc, rootNode, flatSymbols, symbols } = docPrivate;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isFunctionDefinitionName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos)
       if (symbol) {
    const doc = analyzer.getDocument(symbol.uri)!;
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
      console.log(defSymbol.map(s => s.name + s.scope.scopeTag));

    })
  });

})





