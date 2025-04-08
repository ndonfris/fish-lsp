
import { Analyzer } from './analyze';
import { getRange } from './utils/tree-sitter';
import { DocumentHighlight, DocumentHighlightKind, DocumentHighlightParams, Location } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isCommandName, isFunctionDefinitionName, isVariableDefinitionName } from './utils/node-types';
import { LspDocument } from './document';
import { getReferences } from './references';

/**
 * TODO:
 *    ADD DocumentHighlightKind.Read | DocumentHighlightKind.Write support
 */
export function getDocumentHighlights(analyzer: Analyzer) {
  function isSymbolReference(node: SyntaxNode): boolean {
    return node.type === 'variable_name' || isVariableDefinitionName(node) || isFunctionDefinitionName(node);
  }

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
    const node = analyzer.nodeAtPoint(uri, line, character);
    if (!node || !node.isNamed) return [];
    const symbols = analyzer.getFlatDocumentSymbols(uri);

    // check if the node is a reference to a symbol
    if (isSymbolReference(node)) {
      const refLocations = getReferences(analyzer, doc, params.position);
      if (!refLocations) return [];
      return convertSymbolLocationsToHighlights(doc, refLocations);
    // check if the node is a command name (node with node.parent.type === 'command')
    } else if (isCommandName(node)) {
      // check if the command name is a symbol reference
      const defLocation = symbols.find(symbol => symbol.name === node.text);
      if (defLocation) {
        const refLocations = getReferences(analyzer, doc, defLocation.selectionRange.start);
        return convertSymbolLocationsToHighlights(doc, refLocations);
      }
      // not a symbol reference, just a command name
      const matchingCommandNodes =
        analyzer.getNodes(doc)
          .filter(n => isCommandName(n) && n.text === node.text);

      return matchingCommandNodes.map(n => {
        return {
          range: getRange(n),
          kind: DocumentHighlightKind.Text,
        };
      });
    }
    return [];
  };
}
