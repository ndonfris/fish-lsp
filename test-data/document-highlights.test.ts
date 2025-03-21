import { createFakeLspDocument, setLogger } from './helpers';
import { Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { FishDocumentSymbol, getFishDocumentSymbols } from '../src/document-symbol';
import { getDocumentHighlights } from '../src/document-highlight';

import * as Parser from 'web-tree-sitter';
import { DocumentHighlight, DocumentHighlightKind, Position } from 'vscode-languageserver';
import { isCommandName, isCommandWithName, isFunctionDefinitionName, isVariableDefinitionName } from '../src/utils/node-types';
import { getRange } from '../src/utils/tree-sitter';
import { LspDocument } from '../src/document';

/**
 *
 * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.18/specification/#textDocument_documentHighlight
 *
 * The document highlight request is sent from the client to the server to resolve
 * document highlights for a given text document position. For programming languages,
 * this usually highlights all references to the symbol scoped to this file. However,
 * we kept ‘textDocument/documentHighlight’ and ‘textDocument/references’ separate
 * requests since the first one is allowed to be more fuzzy. Symbol matches usually
 * have a DocumentHighlightKind of Read or Write whereas fuzzy or textual matches use
 * Text as the kind.
 *
 *
 *
 * So, there is 3 kinds of documentHighlights:
 *   1. Text (fuzzy or textual matches)
 *   2. Read (like reading from a variable)
 *   3. Write (write access to a symbol, like writing to a variable)
 */

function createHighlightRequest(doc: LspDocument, position: Position) {
  return {
    textDocument: { uri: doc.uri },
    position,
  };
}

let parser: Parser;
let analyzer: Analyzer;
let getHighlights: (params: {
  textDocument: { uri: string; };
  position: { line: number; character: number; };
}) => DocumentHighlight[];

describe('document-highlights test', () => {
  setLogger();
  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
    getHighlights = getDocumentHighlights(analyzer);
  });

  describe.skip('3 basic types of documentHighlights', () => {
    /**
     * A textual occurrence.
     */
    it('test text', () => {

    });

    it('test read', () => {

    });

    it('test write', () => {

    });
  });

  describe('test `text` documentHighlights', () => {
    describe('variable', () => {
      it('definition, and reference', () => {
        const sourceCode = 'set var_1 10; set var_2 20; set var_3 30; echo $var_1';
        const doc = createFakeLspDocument('functions/test.fish', sourceCode);
        analyzer.analyze(doc);
        const searchDefNode = analyzer.getNodes(doc).find((node) => node.text === 'var_1' && isVariableDefinitionName(node))!; // set var_1 10
        const searchRefNode = analyzer.getNodes(doc).find((node) => node.text === 'var_1' && node.type === 'variable_name')!; // echo $var_1

        const requests = [
          searchDefNode,
          searchRefNode,
        ].map((node) => createHighlightRequest(doc, getRange(node).start));

        const results: DocumentHighlight[][] = [];
        requests.forEach((req) => {
          const highlights = getHighlights(req);
          expect(highlights).toHaveLength(2);
          expect(highlights[0]?.kind).toBe(1); // DocumentHighlightKind.Text
          results.push(highlights);
        });
        expect(results[0]).toEqual(results[1]);
      });

      it('universal variable w/o definition', () => {
        const sourceCode = `
if set -q PATH
  echo "PATH is set"
end`;
        const doc = createFakeLspDocument('config.fish', sourceCode);
        analyzer.analyze(doc);
        const searchNode = analyzer.getNodes(doc).find((node) => node.text === 'PATH')!; // set var_1 10
        const requests = [
          searchNode,
        ].map((node) => createHighlightRequest(doc, getRange(node).start));
        const results: DocumentHighlight[][] = [];
        requests.forEach((req) => {
          const highlights = getHighlights(req);
          expect(highlights).toHaveLength(0);
          if (highlights.length === 0) return;
          expect(highlights[0]?.kind).toBe(DocumentHighlightKind.Text); // DocumentHighlightKind.Text
          results.push(highlights);
        });
        expect(results).toHaveLength(0);
      });
    });

    describe('function', () => {
      it('definition, and reference', () => {
        const sourceCode = `
function my_func
  echo "hello"
end
my_func`;
        const doc = createFakeLspDocument('functions/test.fish', sourceCode);
        analyzer.analyze(doc);
        const searchDefNode = analyzer.getNodes(doc).find((node) => node.text === 'my_func' && isFunctionDefinitionName(node))!; // function my_func
        const searchRefNode = analyzer.getNodes(doc).find((node) => node.text === 'my_func' && isCommandName(node))!; // my_func

        const requests = [
          searchDefNode,
          searchRefNode,
        ].map((node) => createHighlightRequest(doc, getRange(node).start));

        const results: DocumentHighlight[][] = [];
        requests.forEach((req) => {
          const highlights = getHighlights(req);
          expect(highlights).toHaveLength(2);
          results.push(highlights);
        });
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual(results[1]);
      });

      it('edge case (BUG: #66)', () => {
        const sourceCode = `function foo
    true
    true
    true
    if true
        true
    end
end`;
        const doc = createFakeLspDocument('functions/foo.fish', sourceCode);
        analyzer.analyze(doc);
        const testPosition = { character: 1, line: 1 };
        const request = {
          textDocument: { uri: doc.uri },
          position: testPosition,
        };
        const highlights = getHighlights(request);
        expect(highlights).toHaveLength(0);
      });
    });
  });

  describe('test `read` documentHighlights', () => {

  });

  describe('test `write` documentHighlights', () => {

  });

  // https://github.com/ndonfris/fish-lsp/issues/66
  describe('Empty test input test cases (BUG: #66)', () => {

  });
});

