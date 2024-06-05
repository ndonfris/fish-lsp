
import { toSymbolKind } from './utils/translation';
import { equalRanges, getNodeAtPosition, getRange } from './utils/tree-sitter';
import { DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';

/**
 * TODO:
 *    ADD DocumentHighlightKind.Read | DocumentHighlightKind.Write support 
 */
export function getDocumentHighlights(tree: Tree, node: SyntaxNode): DocumentHighlight[] {
  const highlights: DocumentHighlight[] = [];

  const nodeSymbolKind = toSymbolKind(node)


  function visitNode(currentNode: SyntaxNode) {
    if (!currentNode) return;

    const currSymbolKind = toSymbolKind(currentNode)
    const equalKinds = (currSymbolKind === nodeSymbolKind || currentNode.type === node.type)
    if (equalKinds && currentNode.text === node.text) {
      highlights.push({
        range: {
          start: {
            line: currentNode.startPosition.row,
            character: currentNode.startPosition.column,
          },
          end: {
            line: currentNode.endPosition.row,
            character: currentNode.endPosition.column,
          },
        },
        // kind: DocumentHighlightKind.Text,
        kind: equalRanges(getRange(currentNode), getRange(node)) 
          ? DocumentHighlightKind.Read 
          : DocumentHighlightKind.Text
      });
    }
    currentNode.children.forEach(child => visitNode(child));
  }

  visitNode(tree.rootNode);
  return highlights;
}
