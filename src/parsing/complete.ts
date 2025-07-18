import { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isCommandWithName, isOption, isString } from '../utils/node-types';
import { Flag, isMatchingOption, Option } from './options';
import { LspDocument } from '../document';
import { getChildNodes, getRange, pointToPosition } from '../utils/tree-sitter';
import { FishSymbol } from './symbol';
import { Location, Range } from 'vscode-languageserver';
import { logger } from '../logger';
import { extractCommands } from './nested-strings';

export const CompleteOptions = [
  Option.create('-c', '--command').withValue(),
  Option.create('-p', '--path'),
  Option.create('-e', '--erase'),
  Option.create('-s', '--short-option').withValue(),
  Option.create('-l', '--long-option').withValue(),
  Option.create('-o', '--old-option').withValue(),
  Option.create('-a', '--arguments').withValue(),
  Option.create('-k', '--keep-order'),
  Option.create('-f', '--no-files'),
  Option.create('-F', '--force-files'),
  Option.create('-r', '--require-parameter'),
  Option.create('-x', '--exclusive'),
  Option.create('-d', '--description').withValue(),
  Option.create('-w', '--wraps').withValue(),
  Option.create('-n', '--condition').withValue(),
  Option.create('-C', '--do-complete').withValue(),
  Option.long('--escape').withValue(),
  Option.create('-h', '--help'),
];

export function isCompletionCommandDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'complete');
}

export function isMatchingCompletionFlagNodeWithFishSymbol(symbol: FishSymbol, node: SyntaxNode) {
  if (!node?.parent || isCommand(node) || isOption(node)) return false;

  const prevNode = node.previousNamedSibling;
  if (!prevNode) return false;

  if (symbol.isFunction()) {
    if (isMatchingOption(
      prevNode,
      Option.create('-c', '--command'),
      Option.create('-w', '--wraps'),
    )) {
      return symbol.name === node.text && !symbol.equalsNode(node);
    }

    if (isMatchingOption(
      prevNode,
      Option.create('-n', '--condition'),
      Option.create('-a', '--arguments'),
    )) {
      return isString(node)
        ? extractCommands(node).some(cmd => cmd === symbol.name)
        : node.text === symbol.name;
    }
  }

  if (symbol.isArgparse()) {
    if (isCompletionSymbol(node)) {
      const completionSymbol = getCompletionSymbol(node);
      return completionSymbol.equalsArgparse(symbol);
    }
  }

  if (symbol.isVariable()) {
    return node.text === symbol.name;
  }
  return false;
}

export function isCompletionDefinitionWithName(node: SyntaxNode, name: string, doc: LspDocument) {
  if (node.parent && isCompletionCommandDefinition(node.parent)) {
    const symbol = getCompletionSymbol(node.parent, doc);
    return symbol?.commandName === name && isCompletionSymbol(node);
  }
  return false;
}

export function isCompletionSymbolShort(node: SyntaxNode) {
  if (node.parent && isCompletionCommandDefinition(node.parent)) {
    return node.previousSibling && isMatchingOption(node.previousSibling, Option.create('-s', '--short-option'));
  }
  return false;
}

export function isCompletionSymbolLong(node: SyntaxNode) {
  if (node.parent && isCompletionCommandDefinition(node.parent)) {
    return node.previousSibling && isMatchingOption(node.previousSibling, Option.create('-l', '--long-option'));
  }
  return false;
}

export function isCompletionSymbolOld(node: SyntaxNode) {
  if (node.parent && isCompletionCommandDefinition(node.parent)) {
    return node.previousSibling && isMatchingOption(node.previousSibling, Option.create('-o', '--old-option'));
  }
  return false;
}

export function isCompletionSymbol(node: SyntaxNode) {
  return isCompletionSymbolShort(node)
    || isCompletionSymbolLong(node)
    || isCompletionSymbolOld(node);
}

type OptionType = '' | 'short' | 'long' | 'old';
export class CompletionSymbol {
  constructor(
    public optionType: OptionType = '',
    public commandName: string = '',
    public node: SyntaxNode | null = null,
    public description: string = '',
    public condition: string = '',
    public requireParameter: boolean = false,
    public argumentNames: string = '',
    public exclusive: boolean = false,
    public document?: LspDocument,
  ) {}

  /**
   * Initialize the VerboseCompletionSymbol with empty values.
   */
  static createEmpty() {
    return new CompletionSymbol();
  }

  /**
   * util for building a VerboseCompletionSymbol
   */
  static create({
    optionType = '',
    commandName = '',
    node = null,
    description = '',
    condition = '',
    requireParameter = false,
    argumentNames = '',
    exclusive = false,
  }: {
    optionType?: OptionType;
    commandName?: string;
    node?: SyntaxNode | null;
    description?: string;
    condition?: string;
    requireParameter?: boolean;
    argumentNames?: string;
    exclusive?: boolean;
  }) {
    return new this(optionType, commandName, node, description, condition, requireParameter, argumentNames, exclusive);
  }

  /**
   * If the node is not found, we don't have a valid VerboseCompletionSymbol.
   */
  isEmpty() {
    return this.node === null;
  }

  /**
   * Type Guard that our node & its parent are defined,
   * therefore we have found a valid VerboseCompletionSymbol.
   */
  isNonEmpty(): this is CompletionSymbol & { node: SyntaxNode; parent: SyntaxNode; } {
    return this.node !== null && this.parent !== null;
  }

  /**
   * Getter (w/ type guarding) to retrieve the CompletionSymbol.node.parent
   * Removes the pattern of null checking a CompletionSymbol.node.parent
   */
  get parent() {
    if (this.node) {
      return this.node.parent;
    }
    return null;
  }

  /**
   * Getter (w/ type guarding) to retrieve the CompletionSymbol.node.text
   * Removes the pattern of null checking a CompletionSymbol.node
   */
  get text(): string {
    if (this.isNonEmpty()) {
      return this.node.text;
    }
    return '';
  }

  /**
   * Check if the option is a short option: `-s <flag>` or `--short-option <flag>`.
   */
  isShort() {
    return this.optionType === 'short';
  }

  /**
   * Check if the option is a long option: `-l <flag>` or `--long-option <flag>`.
   */
  isLong() {
    return this.optionType === 'long';
  }

  /**
   * Check if the option is an old option: `-o <flag>` or `--old-option <flag>`.
   */
  isOld() {
    return this.optionType === 'old';
  }

  /**
   * Check if one option is a pair of another option.
   * ```fish
   * complete -c foo -s h -l help # 'h' <--> 'help' are pairs
   * ```
   */
  isCorrespondingOption(other: CompletionSymbol) {
    if (!this.isNonEmpty() || !other.isNonEmpty()) {
      return false;
    }
    return this.parent.equals(other.parent)
      && this.commandName === other.commandName
      && this.optionType !== other.optionType;
  }

  /**
   * Return the `-f`/`--flag`/`-flag` string
   */
  toFlag() {
    if (!this.isNonEmpty()) return '';
    switch (this.optionType) {
      case 'short':
      case 'old':
        return `-${this.node.text}`;
      case 'long':
        return `--${this.node.text}`;
      default:
        return '';
    }
  }

  /**
   * return the commandName and the flag as a string
   */
  toUsage() {
    if (!this.isNonEmpty()) {
      return '';
    }
    return `${this.commandName} ${this.toFlag()}`;
  }

  /**
   * return the usage, with the description in a trailing comment
   */
  toUsageVerbose() {
    if (!this.isNonEmpty()) {
      return '';
    }
    return `${this.commandName} ${this.toFlag()} # ${this.description}`;
  }

  /**
   * check if the symbol inside a globally defined `argparse o/opt -- $argv` matches
   * this VerboseCompletionSymbol
   */
  equalsArgparse(symbol: FishSymbol) {
    if (symbol.fishKind !== 'ARGPARSE' || !symbol.parent) {
      return false;
    }
    const commandName = symbol.parent.name;
    const symbolName = symbol.argparseFlagName;
    return this.commandName === commandName
      && this.node?.text === symbolName;
  }

  equalsCommand(symbol: FishSymbol) {
    if (!symbol.isFunction()) {
      return false;
    }
    const commandName = symbol.name;
    return this.hasCommandName(commandName);
  }

  /**
   * Check if our CompletionSymbol.node === the node passed in
   */
  equalsNode(n: SyntaxNode) {
    return this.node?.equals(n);
  }

  /**
   * check if our CompletionSymbol.commandName === the commandName passed in
   */
  hasCommandName(name: string) {
    return this.commandName === name;
  }

  /**
   * A test utility for easily getting a completion flag
   */
  isMatchingRawOption(...opts: Flag[]) {
    const flag = this.toFlag();
    for (const opt of opts) {
      if (flag === opt) {
        return true;
      }
    }
    return false;
  }

  /**
   * utility to get the range of the node
   */
  getRange(): Range {
    if (this.isNonEmpty()) {
      return getRange(this.node);
    }
    return null as never;
  }

  /**
   * Create a Location from the current CompletionSymbol
   */
  toLocation(): Location {
    return Location.create(this.document?.uri || '', this.getRange());
  }

  toPosition(): { line: number; character: number; } | null {
    if (this.isNonEmpty()) {
      return pointToPosition(this.node.startPosition);
    }
    return null as never;
  }

  /**
   * Alias for the `this.text` property. Helps with readability, when comparing Argparse FishSymbols, to the string representation of the option.
   *
   * ```fish
   * complete -c foo -s h -l help
   *                  # ^    ^^^^ are both our `text` properties, we can build a string representation of the argparse option `h/help`
   * ```
   *
   * ```fish
   * function foo
   *    argparse h/help -- $argv
   * end
   * ```
   * Returns the string representation of the option, e.g. `-h`, `--help`, or `-h/--help`.
   */
  toArgparseOpt(): string {
    if (!this.isNonEmpty()) {
      return '';
    }
    return this.text;
  }

  /**
   * Example: { name: `help-msg` } -> `_flag_help_msg`
   * Returns the variable name that argparse would create for this completion.
   */
  toArgparseVariableName(): string {
    const prefix = '_flag_';
    const fixString = (str: string) => str.replace(/-/g, '_');
    if (!this.isNonEmpty()) {
      return '';
    }
    return prefix + fixString(this.text);
  }

  static is(obj: unknown): obj is CompletionSymbol {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    return obj instanceof CompletionSymbol
      && typeof obj.optionType === 'string'
      && typeof obj.commandName === 'string'
      && typeof obj.description === 'string'
      && typeof obj.condition === 'string'
      && typeof obj.requireParameter === 'boolean'
      && typeof obj.argumentNames === 'string';
  }
}

export function isCompletionSymbolVerbose(node: SyntaxNode, doc?: LspDocument): boolean {
  if (isCompletionSymbol(node) || !node.parent) {
    return true;
  }
  if (node.parent && isCompletionCommandDefinition(node.parent)) {
    const symbol = getCompletionSymbol(node, doc);
    return symbol?.isNonEmpty() || false;
  }
  return false;
}

/**
 * Create a VerboseCompletionSymbol from a SyntaxNode, for any SyntaxNode passed in.
 * Calling this function will need to check if `result.isEmpty()` or `result.isNonEmpty()`
 * @param node any syntax node, preferably one that is a child of a `complete` node (not required though)
 * @returns {CompletionSymbol} `result.isEmpty()` when not found, `result.isNonEmpty()` when `isCompletionSymbolVerbose(node)` is found
 */
export function getCompletionSymbol(node: SyntaxNode, doc?: LspDocument): CompletionSymbol {
  const result = CompletionSymbol.createEmpty();
  if (!isCompletionSymbol(node) || !node.parent) {
    return result;
  }
  switch (true) {
    case isCompletionSymbolShort(node):
      result.optionType = 'short';
      break;
    case isCompletionSymbolLong(node):
      result.optionType = 'long';
      break;
    case isCompletionSymbolOld(node):
      result.optionType = 'old';
      break;
    default:
      break;
  }
  result.node = node;
  const parent = node.parent;
  const children = parent.childrenForFieldName('argument');
  result.document = doc;
  children.forEach((child, idx) => {
    if (idx === 0) return;
    if (isMatchingOption(child, Option.create('-r', '--require-parameter'))) {
      result.requireParameter = true;
    }
    if (isMatchingOption(child, Option.create('-x', '--exclusive'))) {
      result.exclusive = true;
    }
    const prev = child.previousSibling;
    if (!prev) return;
    if (isMatchingOption(prev, Option.create('-c', '--command'))) {
      result.commandName = child.text;
    }
    if (isMatchingOption(prev, Option.create('-d', '--description'))) {
      result.description = isString(child) ? child.text.slice(1, -1) : child.text;
    }
    if (isMatchingOption(prev, Option.create('-n', '--condition'))) {
      result.condition = child.text;
    }
    if (isMatchingOption(prev, Option.create('-a', '--arguments'))) {
      result.argumentNames = child.text;
    }
  });
  return result;
}

export function groupCompletionSymbolsTogether(
  ...symbols: CompletionSymbol[]
): CompletionSymbol[][] {
  const storedSymbols: Set<string> = new Set();
  const groupedSymbols: CompletionSymbol[][] = [];
  symbols.forEach((symbol) => {
    if (storedSymbols.has(symbol.text)) {
      return;
    }
    const newGroup: CompletionSymbol[] = [symbol];
    const matches = symbols.filter((s) => s.isCorrespondingOption(symbol));
    matches.forEach((s) => {
      storedSymbols.add(s.text);
      newGroup.push(s);
    });
    groupedSymbols.push(newGroup);
  });
  return groupedSymbols;
}

export function getGroupedCompletionSymbolsAsArgparse(groupedCompletionSymbols: CompletionSymbol[][], argparseSymbols: FishSymbol[]): CompletionSymbol[][] {
  const missingArgparseValues: CompletionSymbol[][] = [];
  for (const symbolGroup of groupedCompletionSymbols) {
    if (argparseSymbols.some(argparseSymbol => symbolGroup.find(s => s.equalsArgparse(argparseSymbol)))) {
      logger.info({
        message: 'Skipping symbol group that already has an argparse value',
        symbolGroup: symbolGroup.map(s => s.toFlag()),
        focusedSymbols: argparseSymbols.find(fs => symbolGroup.find(s => s.equalsArgparse(fs)))?.name,
      });
      continue;
    }
    missingArgparseValues.push(symbolGroup);
  }
  return missingArgparseValues;
}

export function processCompletion(document: LspDocument, node: SyntaxNode) {
  const result: CompletionSymbol[] = [];
  for (const child of getChildNodes(node)) {
    if (isCompletionCommandDefinition(node)) {
      const newSymbol = getCompletionSymbol(child, document);
      if (newSymbol) result.push(newSymbol);
    }
  }
  return result;
}

