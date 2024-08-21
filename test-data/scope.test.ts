import Parser from 'web-tree-sitter';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  FishDocumentSymbol,
  flattenNested,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import { initializeParser } from '../src/parser';
import { LspDocument } from '../src/document';

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

  describe('unit tests', () => {
    // describe('creating scopes', () => {
    // })

    // describe('using scopes', () => {
    // })

    // describe('special scopes', () => {
    // })

    // describe('scope analysis', () => {
    // })
  })

  // describe('integration tests', () => {
  //   // describe('document symbols', () => {
  //   //   it('all document symbols', () => {
  //   //   })
  //   //
  //   //   it('document symbols in scope', () => {
  //   //   })
  //   // })
  //   //
  //   // describe('workspace symbols', () => {
  //   //   it('all workspace symbols', () => {
  //   //   })
  //   //
  //   //   it('workspace symbols in scope', () => {
  //   //   })
  //   // });
  // })

  // describe('e2e tests', () => {
  // })

  describe('smoke tests', () => {
    it('WorkspaceOne: `buildWorkspaceOne()`', () => {
      expect(buildWorkspaceOne()).toBeDefined();
    })

    it('analyzer: `analyzer.analyze()`', () => {
      const { docTest } = buildWorkspaceOne();
      expect(analyzer.analyze(docTest.doc)).toBeInstanceOf(Analyzer);
      expect(analyzer.analyze(docTest.doc)).toBeDefined();

      const {document, root, nodes, sourcedFiles, symbols, tree} = analyzer.analyze(docTest.doc);
      expect(document).toBeInstanceOf(LspDocument);
      expect(root).toBeInstanceOf(Parser.SyntaxNode);
      expect(nodes).toBeDefined();
      expect(sourcedFiles).toBeDefined();
      expect(symbols).toBeDefined();
      expect(tree).toBeDefined();
    })

    // it('analyzer: `analyzer.getScopeAtPosition()`', () => {
    // })
  })
})

