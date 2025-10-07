import { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isCommandName } from '../utils/node-types';
import { FishSymbol } from './symbol';
import { Position, Range } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { getRange } from '../utils/tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';

/**
 * Parse command-scoped environment variable exports from Fish shell syntax.
 *
 * Examples:
 * - `NVIM_APPNAME=nvim-lua nvim`
 * - `DEBUG=1 npm test`
 * - `PATH=/usr/local/bin:$PATH command`
 *
 * These are temporary environment variable assignments that only apply
 * to the specific command being executed.
 */

/**
 * Check if a command node contains inline environment variable assignments
 */
export function hasInlineVariables(commandNode: SyntaxNode): boolean {
  if (!isCommand(commandNode)) return false;

  // Look for assignment patterns in command arguments
  for (let i = 0; i < commandNode.namedChildCount; i++) {
    const child = commandNode.namedChild(i);
    if (child && isInlineVariableAssignment(child)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a node represents an inline variable assignment (VAR=value)
 */
export function isInlineVariableAssignment(node: SyntaxNode): boolean {
  if (node.type !== 'word' && node.type !== 'concatenation') return false;

  // Check if the text contains an assignment pattern
  const text = node.text;
  const assignmentMatch = text.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);

  return assignmentMatch !== null;
}

/**
 * Extract variable name and value from an inline assignment node
 */
export function parseInlineVariableAssignment(node: SyntaxNode): { name: string; value: string; } | null {
  if (!isInlineVariableAssignment(node)) return null;

  const text = node.text;
  const assignmentMatch = text.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);

  if (!assignmentMatch || !assignmentMatch[1] || assignmentMatch[2] === undefined) return null;

  return {
    name: assignmentMatch[1],
    value: assignmentMatch[2],
  };
}

/**
 * Extract all inline variable assignments from a command node
 */
export function processInlineVariables(document: LspDocument, commandNode: SyntaxNode): FishSymbol[] {
  if (!isCommand(commandNode)) return [];

  const symbols: FishSymbol[] = [];

  // Find the actual command name and variable assignments
  // Inline variables come before the command name: VAR1=val1 VAR2=val2 command args
  let commandNameNode: SyntaxNode | null = null;
  const variableNodes: SyntaxNode[] = [];

  for (let i = 0; i < commandNode.namedChildCount; i++) {
    const child = commandNode.namedChild(i);
    if (!child) continue;

    if (isInlineVariableAssignment(child)) {
      // Only collect variables that come before the command name
      if (!commandNameNode) {
        variableNodes.push(child);
      }
    } else if (!commandNameNode && isCommandName(child)) {
      commandNameNode = child;
      // Don't break here - continue to process remaining args if needed
    }
  }

  // Create FishSymbol for each inline variable
  for (const varNode of variableNodes) {
    const assignment = parseInlineVariableAssignment(varNode);
    if (!assignment) continue;

    const startPos = Position.create(varNode.startPosition.row, varNode.startPosition.column);
    // const endPos = Position.create(varNode.endPosition.row, varNode.endPosition.column);

    // Calculate the range for just the variable name (before the =)
    const nameEndColumn = varNode.startPosition.column + assignment.name.length;
    const nameRange = Range.create(
      startPos,
      Position.create(varNode.startPosition.row, nameEndColumn),
    );

    // Create a basic scope for command-level variables
    const scope = DefinitionScope.create(commandNode, 'local');

    const symbol = FishSymbol.fromObject({
      name: assignment.name,
      document,
      node: commandNode,
      focusedNode: varNode,
      detail: `Command environment variable: ${assignment.name}=${assignment.value}`,
      fishKind: 'INLINE_VARIABLE',
      range: getRange(varNode),
      selectionRange: nameRange,
      scope,
      children: [],
    });

    symbols.push(symbol);
  }

  return symbols;
}

/**
 * Find all inline variable assignments in a syntax tree
 */
export function findAllInlineVariables(document: LspDocument, tree: SyntaxNode): FishSymbol[] {
  const symbols: FishSymbol[] = [];

  function walkTree(node: SyntaxNode) {
    if (isCommand(node) && hasInlineVariables(node)) {
      symbols.push(...processInlineVariables(document, node));
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        walkTree(child);
      }
    }
  }

  walkTree(tree);
  return symbols;
}

/**
 * Get completion suggestions for inline variable names
 * Returns common environment variables that are often used inline
 */
export function getInlineVariableCompletions(): string[] {
  return [
    'DEBUG',
    'NODE_ENV',
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TERM',
    'DISPLAY',
    'NVIM_APPNAME',
    'EDITOR',
    'PAGER',
    'BROWSER',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ];
}
