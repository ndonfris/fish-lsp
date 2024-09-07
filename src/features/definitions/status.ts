import { SymbolKind } from 'vscode-languageserver-protocol';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../../utils/definition-scope';
import { FishDocumentSymbol } from '../../utils/symbol';
import { getRange } from '../../utils/tree-sitter';



/**
 * contextual improvements provided by the `FishDocumentSymbol` class are currently not
 * worth the performance hit of creating a new instance of the class for each symbol.
 *
 * use the ../../utils/snippets/*.json instead to provide contextual improvements
 */
export function createStatusDocumentSymbol(uri: string, node: SyntaxNode): FishDocumentSymbol {

  // return a result
  return FishDocumentSymbol.create({
    name: 'status',
    kind: SymbolKind.Variable,
    uri,
    range: getRange(node),
    selectionRange: getRange(node),
    scope: DefinitionScope.create(
      node,
      'local'
    ),
    node,
    parent: node,
    children: []
  })
}