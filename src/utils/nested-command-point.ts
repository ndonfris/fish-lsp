import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { extractCommandLocations } from '../parsing/nested-strings';
import { isArgumentThatCanContainCommandCalls } from './node-types';
import { getRange, isPositionWithinRange } from './tree-sitter';

export type NestedCommandReferenceAtPoint = {
  command: string;
  range: LSP.Range;
};

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
  node: SyntaxNode,
  position: LSP.Position,
  documentUri: string,
  opts: {
    allowCarrierRangeFallback?: boolean;
  } = {},
): NestedCommandReferenceAtPoint | null {
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
