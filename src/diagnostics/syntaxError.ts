import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isCommandName, isConditionalCommand, isError, isReturn } from '../utils/node-types';
import { findFirstNamedSibling, getRange, getSiblingNodes } from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';
import { createDiagnostic } from './create';
//import {containsRange} from '../workspace-symbol';

// https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/diagnostic-queue.ts
export function getMissingEndSyntaxError(node: SyntaxNode): Diagnostic | null {
  return isError(node)
    ? createDiagnostic(node, errorCodes.missingEnd)
    : null;
}

/**
 * checks if the parser saw a node that it assumes is a command, but is actually an end
 * node.
 */
export function getExtraEndSyntaxError(node: SyntaxNode): Diagnostic | null {
  return isCommandName(node) && node.text === 'end'
    ? createDiagnostic(node, errorCodes.extraEnd)
    : null;
}

export function getReturnSiblings(node: SyntaxNode) : SyntaxNode[] {
  let current : SyntaxNode | null = node;
  const results: SyntaxNode[] = [];
  while (current) {
    if (!current.isNamed) {
      continue;
    }
    results.unshift(current);
    if (isReturn(current)) {
      current = current.nextNamedSibling;
      continue;
    }
    if (!isConditionalCommand(current)) {
      break;
    }
    current = current.nextNamedSibling;
  }
  return results;
}
