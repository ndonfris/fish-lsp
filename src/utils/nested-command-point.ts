import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { extractCommandLocations } from '../parsing/nested-strings';
import { isArgumentThatCanContainCommandCalls, isConcatenatedValue, isConcatenation, isString, isAlias, hasParent, isExport } from './node-types';
import { getRange, isPositionWithinRange } from './tree-sitter';

/**
 * Result type of parsed nested command references inside of strings or parenthesized carriers.
 */
export type NestedCommandReferenceAtPoint = {
  command: string;
  range: LSP.Range;
};

type NodeCheckCallback = (node: SyntaxNode) => boolean;
export const possibileNestedNodeClallbacks: NodeCheckCallback[] = [
  isString,
  isArgumentThatCanContainCommandCalls,
  (n: SyntaxNode) => n.type === 'command_substitution',
  // isArgumentThatCanContainCommandCalls,
  // (n: SyntaxNode) => n.text === '"' || n.text === '\'',
  isParenthesizedCommandCarrier,
  (n: SyntaxNode) => n.type === 'concatenation',
  (n: SyntaxNode) => hasParent(n, isAlias) || hasParent(n, isExport),
];

export function isPossibleNested(node: SyntaxNode | undefined): boolean {
  if (!node) return false;
  return possibileNestedNodeClallbacks.some(cb => cb(node));
}

export function isParenthesizedCommandCarrier(node: SyntaxNode): boolean {
  const text = node.text.trim();
  return (
    text.startsWith('(') && text.endsWith(')')
    || text.startsWith('\'(') && text.endsWith(')\'')
    || text.startsWith('"(') && text.endsWith(')"')
  );
}

export function getParenthesizedCarrierCommand(node: SyntaxNode): string | null {
  const cleaned = node.text.trim()
    .replace(/^['"]?\(/, '')
    .replace(/\)['"]?$/, '')
    .trim();
  const firstToken = cleaned.split(/[\s;&|]+/).find(Boolean);
  return firstToken || null;
}

export function getNestedCommandReferenceAtPoint(
  documentUri: string,
  position: LSP.Position,
  node: SyntaxNode | undefined,
  opts: {
    allowCarrierRangeFallback?: boolean;
  } = {},
): NestedCommandReferenceAtPoint | null {
  if (!node) return null;
  /**
   * Prevent unnecessary traversals for nodes that cannot possibly contain
   * nested commands, which can be common in large documents and lead to
   * performance issues.
   */
  if (!isPossibleNested(node)) return null;
  if (isConcatenation(node) || isConcatenatedValue(node)) {
    const results = extractCommandLocations(node, documentUri)
      .filter(ref =>
        ref.location.uri === documentUri
        && isPositionWithinRange(position, ref.location.range),
      ).map(ref => ({ command: ref.command, range: ref.location.range }));
    if (results.length > 0) {
      return results[0]!;
    }
  }

  let current: SyntaxNode | null = node;

  while (current) {
    if (isParenthesizedCommandCarrier(current)) {
      const directCommand = getParenthesizedCarrierCommand(current);
      if (directCommand) {
        return {
          command: directCommand,
          range: getRange(current),
        };
      }

      const locations = extractCommandLocations(current, documentUri);
      const match = locations.find(ref => isPositionWithinRange(position, ref.location.range));
      if (match) {
        return {
          command: match.command,
          range: match.location.range,
        };
      }
      if (opts.allowCarrierRangeFallback && locations.length > 0 && isPositionWithinRange(position, getRange(current))) {
        return {
          command: locations[0]!.command,
          range: locations[0]!.location.range,
        };
      }
    }

    if (!isArgumentThatCanContainCommandCalls(current)) {
      current = current.parent;
      continue;
    }

    const match = extractCommandLocations(current, documentUri)
      .find(ref => isPositionWithinRange(position, ref.location.range));
    if (match) {
      return {
        command: match.command,
        range: match.location.range,
      };
    }
    current = current.parent;
  }

  return null;
}
