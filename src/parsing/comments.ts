import { SyntaxNode } from 'web-tree-sitter';
import { isComment } from '../utils/node-types';
import { analyzer } from '../analyze';
import { getChildNodes } from '../utils/tree-sitter';
import { LspDocument } from '../document';

export const INDENT_COMMENT_REGEX = /^#\s*@fish_indent(?::\s*(off|on)?)?$/;

export function isIndentComment(node: SyntaxNode): boolean {
  if (!isComment(node)) return false;
  return INDENT_COMMENT_REGEX.test(node.text.trim());
}

export interface IndentComment {
  node: SyntaxNode;
  indent: 'on' | 'off';
  line: number;
}

export function parseIndentComment(node: SyntaxNode): IndentComment | null {
  if (!isIndentComment(node)) return null;
  const match = node.text.trim().match(INDENT_COMMENT_REGEX);
  if (!match) return null;
  return {
    node,
    indent: match[1] === 'off' ? 'off' : 'on',
    line: node.startPosition.row,
  };
}

export function processIndentComments(root: SyntaxNode): IndentComment[] {
  const comments: IndentComment[] = [];
  for (const node of getChildNodes(root)) {
    if (isIndentComment(node)) {
      const indentComment = parseIndentComment(node);
      if (indentComment) {
        comments.push(indentComment);
      }
    }
  }
  return comments;
}

export interface FormatRange {
  start: number; // line number (0-based)
  end: number;   // line number (0-based)
}

export interface FormatRanges {
  formatRanges: FormatRange[];
  fullDocumentFormatting: boolean;
}

export function getEnabledIndentRanges(doc: LspDocument, rootNode?: SyntaxNode): FormatRanges {
  let root = rootNode;
  if (!root) {
    root = analyzer.getRootNode(doc.uri);
    if (!root) return { formatRanges: [], fullDocumentFormatting: true };
  }

  const comments = processIndentComments(root);
  if (comments.length === 0) {
    // No indent comments found - format entire document
    return {
      formatRanges: [{ start: 0, end: root.endPosition.row }],
      fullDocumentFormatting: true,
    };
  }

  const ranges: FormatRange[] = [];
  let currentStart = 0; // Start formatting from beginning
  let isCurrentlyEnabled = true; // Formatting is enabled by default

  for (const comment of comments) {
    if (comment.indent === 'off' && isCurrentlyEnabled) {
      // End current formatting range
      if (comment.line > currentStart) {
        ranges.push({ start: currentStart, end: comment.line - 1 });
      }
      isCurrentlyEnabled = false;
    } else if (comment.indent === 'on' && !isCurrentlyEnabled) {
      // Start new formatting range
      currentStart = comment.line + 1;
      isCurrentlyEnabled = true;
    }
  }

  // If we end with formatting enabled, add final range
  if (isCurrentlyEnabled && currentStart <= root.endPosition.row) {
    ranges.push({ start: currentStart, end: root.endPosition.row });
  }

  return {
    formatRanges: ranges,
    fullDocumentFormatting: false,
  };
}

// export function docRemoveTextInsideIndentComments(doc: LspDocument): string {
//   const lines = doc.getText().split("\n");
//   const root = analyzer.getRootNode(doc.uri);
//
//   const comments = processIndentComments(root);
//   for (const comment of comments) {
//     const { line } = comment;
//     if (line >= 0 && line < lines.length) {
//       lines[line] = ""; // Remove the entire line containing the indent comment
//     }
//   }
//   return lines.join("\n");
// }

