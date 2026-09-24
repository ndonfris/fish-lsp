import * as SetParser from './set';
import * as ReadParser from './read';
import * as ForParser from './for';
import * as ArgparseParser from './argparse';
import * as AliasParser from './alias';
import * as ExportParser from './export';
import * as FunctionParser from './function';
import * as CompleteParser from './complete';
import * as OptionsParser from './options';
import * as SymbolParser from './symbol';
import * as EventParser from './emit';
import * as StringRegexParser from './string-regex';
import { SyntaxNode } from 'web-tree-sitter';

/**
 * Internal SyntaxNode parsers for finding FishSymbol definitions
 * of any `FishKindType`. These are marked as internal because
 * ideally they will be exported through the `../utils/node-types.ts`
 * file, which is where we want to isolate importing SyntaxNode
 * checkers while using them throughout the code bases' files.
 */

/** @internal */
export const Parsers = {
  set: SetParser,
  read: ReadParser,
  for: ForParser,
  argparse: ArgparseParser,
  function: FunctionParser,
  complete: CompleteParser,
  options: OptionsParser,
  symbol: SymbolParser,
  export: ExportParser,
  event: EventParser,
  stringRegex: StringRegexParser,
};

/** @internal */
export const VariableDefinitionKeywords = [
  'set',
  'read',
  'argparse',
  'for',
  'function',
  'export',
];

/**
 * @internal
 * Checks if a node is a variable definition name.
 * Examples of variable names include:
 * - `set -g -x foo '...'`      -> foo
 * - `read -l bar baz`          -> bar baz
 * - `argparse h/help -- $argv` -> h/help
 * - `for i in _ `              -> i
 * - `export foo=bar`           -> foo
 */
export function isVariableDefinitionName(node: SyntaxNode): boolean {
  // A definition name sits right under the node that defines it, or one level down
  // in a `concatenation` (`set -e PATH[1]`, `export foo=bar`, `argparse n/name=`).
  // One look at the parent picks the only parser that can match; asking all seven
  // re-read the parent and its command name for every node of every document.
  const parent = node.parent;
  if (!parent) return false;
  switch (parent.type) {
    case 'for_statement':
      return ForParser.isForVariableDefinitionName(node);
    case 'function_definition':
      return FunctionParser.isFunctionVariableDefinitionName(node);
    case 'command':
    case 'concatenation':
      break;
    default:
      return false;
  }
  const command = parent.type === 'command' ? parent : parent.parent;
  if (command?.type !== 'command') return false;
  switch (command.childForFieldName('name')?.text) {
    case 'set': return !!SetParser.isSetVariableDefinitionName(node);
    case 'read': return ReadParser.isReadVariableDefinitionName(node);
    case 'argparse': return ArgparseParser.isArgparseVariableDefinitionName(node);
    case 'export': return ExportParser.isExportVariableDefinitionName(node);
    case 'string': return StringRegexParser.isStringRegexCaptureDefinitionName(node);
    default: return false;
  }
}

/**
 * @internal
 * Checks if a node is a function definition name.
 * Examples of function names include:
 * - `function baz; end;`       -> baz
 */
export function isFunctionDefinitionName(node: SyntaxNode) {
  return FunctionParser.isFunctionDefinitionName(node);
}

/**
 * @internal
 * Checks if a node is a alias definition name.
 * - `alias foo '__foo'`        -> foo
 * - `alias bar='__bar'`        -> bar
 */
export function isAliasDefinitionName(node: SyntaxNode) {
  return AliasParser.isAliasDefinitionName(node);
}

/**
 * @internal
 * Checks if a node is a function variable definition name.
 * - `emit event-name` -> event-name
 */
export function isEmittedEventDefinitionName(node: SyntaxNode) {
  return EventParser.isEmittedEventDefinitionName(node);
}

/**
 * @internal
 * Checks if a node is a export definition name.
 * - `export foo=__foo`          -> foo
 * - `export bar='__bar'`        -> bar
 */
export function isExportVariableDefinitionName(node: SyntaxNode) {
  return ExportParser.isExportVariableDefinitionName(node);
}

/**
 * @internal
 * Checks if a node is an `argparse` definition variable
 * NOTE: if the node in question is a variable expansion, it will be skipped.
 * ```fish
 * argparse --max-args=2 --ignore-unknown --stop-nonopt h/help 'n/name=?' 'x/exclusive' -- $argv
 * ```
 * Would return true for the following SyntaxNodes passed in:
 * - `h/help`
 * - `n/name=?`
 * - `x/exclusive`
 * @param node The node to check, where it's parent isCommandWithName(parent, 'argparse'), and it's not a switch
 * @returns true if the node is an argparse definition variable (flags for the `argparse` command with be skipped)
 */
export function isArgparseVariableDefinitionName(node: SyntaxNode) {
  return ArgparseParser.isArgparseVariableDefinitionName(node);
}

/**
 * @internal
 * Checks if a node is a definition name.
 * Definition names are variable names (read/set/argparse/function flags), function names (alias/function),
 */
export function isDefinitionName(node: SyntaxNode) {
  return isVariableDefinitionName(node) || isFunctionDefinitionName(node) || isAliasDefinitionName(node);
}

/**
 * @internal
 */
export const NodeTypes = {
  isVariableDefinitionName: isVariableDefinitionName,
  isFunctionDefinitionName: isFunctionDefinitionName,
  isAliasDefinitionName: isAliasDefinitionName,
  isDefinitionName: isDefinitionName,
  isSetVariableDefinitionName: SetParser.isSetVariableDefinitionName,
  isReadVariableDefinitionName: ReadParser.isReadVariableDefinitionName,
  isForVariableDefinitionName: ForParser.isForVariableDefinitionName,
  isExportVariableDefinitionName: ExportParser.isExportVariableDefinitionName,
  isArgparseVariableDefinitionName: ArgparseParser.isArgparseVariableDefinitionName,
  isFunctionVariableDefinitionName: FunctionParser.isFunctionVariableDefinitionName,
  isStringRegexCaptureDefinitionName: StringRegexParser.isStringRegexCaptureDefinitionName,
  isMatchingOption: OptionsParser.isMatchingOption,
};

/**
 * @internal
 */
export const ParsingDefinitionNames = {
  isSetVariableDefinitionName: SetParser.isSetVariableDefinitionName,
  isReadVariableDefinitionName: ReadParser.isReadVariableDefinitionName,
  isForVariableDefinitionName: ForParser.isForVariableDefinitionName,
  isArgparseVariableDefinitionName: ArgparseParser.isArgparseVariableDefinitionName,
  isFunctionVariableDefinitionName: FunctionParser.isFunctionVariableDefinitionName,
  isFunctionDefinitionName: FunctionParser.isFunctionDefinitionName,
  isAliasDefinitionName: AliasParser.isAliasDefinitionName,
  isExportDefinitionName: ExportParser.isExportVariableDefinitionName,
  isStringRegexCaptureDefinitionName: StringRegexParser.isStringRegexCaptureDefinitionName,
} as const;

type DefinitionNodeNameTypes = 'isDefinitionName' | 'isVariableDefinitionName' | 'isFunctionDefinitionName' | 'isAliasDefinitionName';
type DefinitionNodeChecker = (n: SyntaxNode) => boolean;
/** @internal */
export const DefinitionNodeNames: Record<DefinitionNodeNameTypes, DefinitionNodeChecker> = {
  isDefinitionName: isDefinitionName,
  isVariableDefinitionName: isVariableDefinitionName,
  isFunctionDefinitionName: isFunctionDefinitionName,
  isAliasDefinitionName: isAliasDefinitionName,
};

/** @internal */
export * from './options';

/** @internal */
export const parsers = Object.keys(Parsers).map(key => Parsers[key as keyof typeof Parsers]);

/** @internal */
export {
  SetParser,
  ReadParser,
  ForParser,
  ArgparseParser,
  AliasParser,
  FunctionParser,
  ExportParser,
  CompleteParser,
  OptionsParser,
  SymbolParser,
  StringRegexParser,
};
