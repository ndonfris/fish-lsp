import { LinkedEditingRanges, Position, Range } from 'vscode-languageserver';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { isFunctionDefinition, isStatement, isEnd } from './utils/node-types';
import { SyntaxNode } from 'web-tree-sitter';

/**
 * Get linked editing ranges for a position in a document.
 * Returns ranges that should be edited together, such as:
 * - function keyword and end keyword in function definitions
 * - statement keywords (if, for, while, switch, begin) and their corresponding end keywords
 *
 * @param doc - The document to search
 * @param position - The position to check for linked editing ranges
 * @returns LinkedEditingRanges or null if no linked ranges found
 */
export function getLinkedEditingRanges(
  doc: LspDocument,
  position: Position,
): LinkedEditingRanges | null {
  const current = analyzer.nodeAtPoint(doc.uri, position.line, position.character);

  if (!current) return null;

  // Find the parent statement or function definition
  let targetNode: SyntaxNode | null = null;
  let node: SyntaxNode | null = current;

  while (node) {
    if (isFunctionDefinition(node) || isStatement(node)) {
      targetNode = node;
      break;
    }
    node = node.parent;
  }

  if (!targetNode) return null;

  // Get the first and last children to find the opening and closing keywords
  const firstChild = targetNode.firstChild;
  const lastChild = targetNode.lastChild;

  if (!firstChild || !lastChild) return null;

  // Check that we have a proper block with 'end' keyword
  if (!isEnd(lastChild)) return null;

  const ranges: Range[] = [];

  // Add the opening keyword range (function, if, for, while, switch, begin)
  ranges.push(Range.create(
    doc.positionAt(firstChild.startIndex),
    doc.positionAt(firstChild.endIndex),
  ));

  // Add the end keyword range
  ranges.push(Range.create(
    doc.positionAt(lastChild.startIndex),
    doc.positionAt(lastChild.endIndex),
  ));

  return {
    ranges,
  };
}
