import { SelectionRange, Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { isPositionInNode, getRange } from './utils/tree-sitter';

/**
 * Provides smart selection ranges for fish shell code.
 *
 * This allows users to incrementally expand their selection based on the
 * syntactic structure of the code (e.g., word → argument → command → block → function).
 *
 * The selection hierarchy follows the tree-sitter parse tree structure.
 */

/**
 * Find the smallest node containing the position
 */
function findSmallestNode(node: SyntaxNode, position: Position): SyntaxNode | null {
  if (!isPositionInNode(position, node)) {
    return null;
  }

  // Try to find a smaller child node
  for (const child of node.namedChildren) {
    const result = findSmallestNode(child, position);
    if (result) {
      return result;
    }
  }

  // Skip whitespace and newline nodes for selection
  if (node.type === '\\n' || node.type === ' ') {
    return node.parent || node;
  }

  return node;
}

/**
 * Determine if a node type should be included in the selection hierarchy
 */
function shouldIncludeInHierarchy(node: SyntaxNode): boolean {
  // Skip these node types as they don't provide meaningful selection boundaries
  const skipTypes = ['\\n', ' ', '(', ')', '[', ']', '{', '}', '"', "'", '$'];
  return !skipTypes.includes(node.type);
}

/**
 * Build the selection range hierarchy from a node upwards
 */
function buildSelectionHierarchy(node: SyntaxNode): SelectionRange {
  const range = getRange(node);

  // Find the next meaningful parent in the hierarchy
  let parent = node.parent;
  let parentRange: SelectionRange | undefined = undefined;

  while (parent) {
    // Only include meaningful nodes in the hierarchy
    if (shouldIncludeInHierarchy(parent)) {
      // Avoid creating redundant parent selections with identical ranges
      const parentLspRange = getRange(parent);
      if (
        parentLspRange.start.line !== range.start.line ||
        parentLspRange.start.character !== range.start.character ||
        parentLspRange.end.line !== range.end.line ||
        parentLspRange.end.character !== range.end.character
      ) {
        parentRange = buildSelectionHierarchy(parent);
        break;
      }
    }
    parent = parent.parent;
  }

  return {
    range,
    parent: parentRange,
  };
}

/**
 * Get selection ranges for the given positions in the document
 */
export function getSelectionRanges(
  document: LspDocument,
  positions: Position[],
): SelectionRange[] {
  const result: SelectionRange[] = [];

  const rootNode = analyzer.getRootNode(document.uri);
  if (!rootNode) {
    return result;
  }

  for (const position of positions) {
    const node = findSmallestNode(rootNode, position);
    if (node) {
      result.push(buildSelectionHierarchy(node));
    }
  }

  return result;
}
