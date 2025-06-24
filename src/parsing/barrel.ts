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
import { SyntaxNode } from 'web-tree-sitter';

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
};

export const VariableDefinitionKeywords = [
  'set',
  'read',
  'argparse',
  'for',
  'function',
  'export',
];

/**
 * Checks if a node is a variable definition name.
 * Examples of variable names include:
 * - `set -g -x foo '...'`      -> foo
 * - `read -l bar baz`          -> bar baz
 * - `argparse h/help -- $argv` -> h/help
 * - `for i in _ `              -> i
 * - `export foo=bar`           -> foo
 */
export function isVariableDefinitionName(node: SyntaxNode) {
  return SetParser.isSetVariableDefinitionName(node) ||
    ReadParser.isReadVariableDefinitionName(node) ||
    ArgparseParser.isArgparseVariableDefinitionName(node) ||
    ForParser.isForVariableDefinitionName(node) ||
    FunctionParser.isFunctionVariableDefinitionName(node) ||
    ExportParser.isExportVariableDefinitionName(node);
}

/**
 * Checks if a node is a function definition name.
 * Examples of function names include:
 * - `function baz; end;`       -> baz
 */
export function isFunctionDefinitionName(node: SyntaxNode) {
  return FunctionParser.isFunctionDefinitionName(node);
}

/**
 * Checks if a node is a alias definition name.
 * - `alias foo '__foo'`        -> foo
 * - `alias bar='__bar'`        -> bar
 */
export function isAliasDefinitionName(node: SyntaxNode) {
  return AliasParser.isAliasDefinitionName(node);
}

/**
 * Checks if a node is a export definition name.
 * - `export foo=__foo`          -> foo
 * - `export bar='__bar'`        -> bar
 */
export function isExportVariableDefinitionName(node: SyntaxNode) {
  return ExportParser.isExportVariableDefinitionName(node);
}

/**
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
 * Checks if a node is a definition name.
 * Definition names are variable names (read/set/argparse/function flags), function names (alias/function),
 */
export function isDefinitionName(node: SyntaxNode) {
  return isVariableDefinitionName(node) || isFunctionDefinitionName(node) || isAliasDefinitionName(node);
}

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
  isMatchingOption: OptionsParser.isMatchingOption,
};

export const ParsingDefinitionNames = {
  isSetVariableDefinitionName: SetParser.isSetVariableDefinitionName,
  isReadVariableDefinitionName: ReadParser.isReadVariableDefinitionName,
  isForVariableDefinitionName: ForParser.isForVariableDefinitionName,
  isArgparseVariableDefinitionName: ArgparseParser.isArgparseVariableDefinitionName,
  isFunctionVariableDefinitionName: FunctionParser.isFunctionVariableDefinitionName,
  isFunctionDefinitionName: FunctionParser.isFunctionDefinitionName,
  isAliasDefinitionName: AliasParser.isAliasDefinitionName,
  isExportDefinitionName: ExportParser.isExportVariableDefinitionName,
} as const;

type DefinitionNodeNameTypes = 'isDefinitionName' | 'isVariableDefinitionName' | 'isFunctionDefinitionName' | 'isAliasDefinitionName';
type DefinitionNodeChecker = (n: SyntaxNode) => boolean;
export const DefinitionNodeNames: Record<DefinitionNodeNameTypes, DefinitionNodeChecker> = {
  isDefinitionName: isDefinitionName,
  isVariableDefinitionName: isVariableDefinitionName,
  isFunctionDefinitionName: isFunctionDefinitionName,
  isAliasDefinitionName: isAliasDefinitionName,
};

export * from './options';

export const parsers = Object.keys(Parsers).map(key => Parsers[key as keyof typeof Parsers]);

export {
  SetParser,
  ReadParser,
  ForParser,
  ArgparseParser,
  AliasParser,
  FunctionParser,
  CompleteParser,
  OptionsParser,
  SymbolParser,
};
