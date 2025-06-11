import { Analyzer } from './analyze';
import { getRange } from './utils/tree-sitter';
import { DocumentHighlight, DocumentHighlightKind, DocumentHighlightParams, Location } from 'vscode-languageserver';
import { isCommandName } from './utils/node-types';
import { LspDocument } from './document';
import { getReferences } from './references';
import { isBuiltin } from './utils/builtins';

/**
 * TODO:
 *    ADD DocumentHighlightKind.Read | DocumentHighlightKind.Write support
 */
export function getDocumentHighlights(analyzer: Analyzer) {
  function convertSymbolLocationsToHighlights(doc: LspDocument, locations: Location[]): DocumentHighlight[] {
    return locations
      .filter(loc => loc.uri === doc.uri)
      .map(loc => {
        return {
          range: loc.range,
          kind: DocumentHighlightKind.Text,
        };
      });
  }

  return function(params: DocumentHighlightParams): DocumentHighlight[] {
    const { uri } = params.textDocument;
    const { line, character } = params.position;
    const doc = analyzer.getDocument(uri);
    if (!doc) return [];

    const word = analyzer.wordAtPoint(uri, line, character);
    if (!word || word.trim() === '') return [];

    const nodes = analyzer.getNodes(uri);

    // check if the word is a builtin function
    if (isBuiltin(word)) {
      return nodes
        .filter(n => isBuiltin(n.text) && n.text === word)
        .map(n => {
          return {
            range: getRange(n),
            kind: DocumentHighlightKind.Text,
          };
        });
    }

    const symbol = analyzer.getDefinition(doc, params.position);
    const node = analyzer.nodeAtPoint(uri, line, character);
    if (!node || !node.isNamed) return [];

    // check if a node is a command name
    if (!symbol && isCommandName(node)) {
      const matchingCommandNodes =
        nodes.filter(n => isCommandName(n) && n.text === node.text);

      return matchingCommandNodes.map(n => {
        return {
          range: getRange(n),
          kind: DocumentHighlightKind.Text,
        };
      });
    }

    // use local symbol reference locations
    if (symbol) {
      const refLocations = getReferences(doc, symbol.selectionRange.start, true);
      if (!refLocations) return [];
      return convertSymbolLocationsToHighlights(doc, refLocations);
    }

    return [];
  };
}
