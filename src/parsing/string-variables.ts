import { Position, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { findParentCommand, isCommandWithName, isConcatenation } from '../utils/node-types';
import { isAliasDefinitionValue } from './alias';
import { isMatchingOption, Option } from './options';

/** a `$name` expansion inside a string, `range` covering `name` */
export type StringVariable = { name: string; range: Range; dollars: number; };

/**
 * Single-quoted text that fish evaluates later, so a `$name` inside it expands then:
 * a `complete -n`/`-a` value (`-kxa 'jack $names'`) or an alias body
 * (`alias ff='echo $x'`). Tree-sitter keeps these as one opaque string node.
 */
export function isEvaluatedSingleQuoteString(node: SyntaxNode): boolean {
  if (node.type !== 'single_quote_string') return false;
  if (isAliasDefinitionValue(node)) return true;
  const command = findParentCommand(node);
  if (!command || !isCommandWithName(command, 'complete')) return false;
  const argument = node.parent && isConcatenation(node.parent) ? node.parent : node;
  const option = argument.previousNamedSibling;
  return !!option && isMatchingOption(option, Option.create('-n', '--condition'), Option.create('-a', '--arguments'));
}

/** every unescaped `$name` in an evaluated single-quoted string (see above) */
export function stringVariables(node: SyntaxNode): StringVariable[] {
  return isEvaluatedSingleQuoteString(node) ? dollarVariables(node) : [];
}

/** every unescaped `$name` in `node`'s text, whatever evaluates it */
export function dollarVariables(node: SyntaxNode): StringVariable[] {
  const results: StringVariable[] = [];
  for (const match of node.text.matchAll(/(\\*)(\$+)(\w+)/g)) {
    const [, backslashes = '', dollars = '', name = ''] = match;
    // Fish reads the text twice. Parsing the single-quoted string turns each `\\`
    // into `\` and keeps a lone `\`, then evaluating it escapes `$` after an odd
    // count: `'\$x'` and `'\\$x'` stay literal, `'\\\$x'` expands `$x`.
    const evaluated = Math.floor(backslashes.length / 2) + backslashes.length % 2;
    if (evaluated % 2 === 1) continue;
    const nameStart = match.index! + backslashes.length + dollars.length;
    const start = positionAt(node, nameStart);
    results.push({
      name,
      dollars: dollars.length,
      range: { start, end: { line: start.line, character: start.character + name.length } },
    });
  }
  return results;
}

/** the `$name` in an evaluated single-quoted string under `position`, from its `$` to its end */
export function stringVariableAtPoint(node: SyntaxNode | null | undefined, position: Position): StringVariable | null {
  if (!node) return null;
  return variableAtPoint(stringVariables(node), position);
}

/** the one of `variables` under `position`, from its `$` to its end */
export function variableAtPoint(variables: StringVariable[], position: Position): StringVariable | null {
  return variables.find(({ range, dollars }) =>
    range.start.line === position.line
    && position.character >= range.start.character - dollars
    && position.character <= range.end.character,
  ) ?? null;
}

function positionAt(node: SyntaxNode, offset: number): Position {
  const lines = node.text.slice(0, offset).split('\n');
  const line = node.startPosition.row + lines.length - 1;
  const character = lines.length === 1
    ? node.startPosition.column + offset
    : lines.at(-1)!.length;
  return { line, character };
}
