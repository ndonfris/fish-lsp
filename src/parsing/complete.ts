import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isString } from '../utils/node-types';
import { Flag, isMatchingOption, Option } from './options';
import { LspDocument } from '../document';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { FishSymbol } from './symbol';
import { Location, Range } from 'vscode-languageserver';
// import { pathToRelativeFunctionName, uriToPath } from '../utils/translation';

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

// export type CompletionOptionKeys = 'command' | 'short' | 'long' | 'old' | 'description' | 'condition' | 'arguments';
// export const CompletionOptionMap = {
//   command: CompleteOptions.find(n => n.equalsRawOption('-c', '--command'))!,
//   short: CompleteOptions.find(n => n.equalsRawOption('-s', '--short-option'))!,
//   long: CompleteOptions.find(n => n.equalsRawOption('-l', '--long-option'))!,
//   old: CompleteOptions.find(n => n.equalsRawOption('-o', '--old-option'))!,
//   description: CompleteOptions.find(n => n.equalsRawOption('-d', '--description'))!,
//   condition: CompleteOptions.find(n => n.equalsRawOption('-n', '--condition'))!,
//   arguments: CompleteOptions.find(n => n.equalsRawOption('-a', '--arguments'))!,
// };

export function isCompletionCommandDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'complete');
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
    public doc?: LspDocument,
  ) { }

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
    if (!this.isNonEmpty()) {
      return '';
    }
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
    return Location.create(this.doc?.uri || '', this.getRange());
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
  result.doc = doc;
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

// function getCompletionSymbol(document: LspDocument, node: SyntaxNode): CompletionSymbol | null {
//   if (!isCompletionDefinition(node)) {
//     return null;
//   }
//
//   const searchNodes = node.childrenForFieldName('argument');
//   const options = findOptions(searchNodes, CompleteOptions);
//
//   const focused = getFocusedCompletionOptions(options.found);
//   const flags: typeof CompletionSymbolFlags = {
//     short: focused.short,
//     long: focused.long,
//     old: focused.old,
//   };
//   const command = focused.command.pop();
//   const args = focused.arguments?.pop();
//   const description = focused.description?.pop();
//   const condition = focused.condition?.pop();
//
//   return CompletionSymbol.create({
//     flags,
//     command: command?.value,
//
//     description,
//     argumentNames: args,
//     condition,
//     ...options,
//     document,
//   });
// }

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

// export interface CompletionSymbolOptions {
//   flags: typeof CompletionSymbolFlags;
//   command?: SyntaxNode | undefined;
//   description?: OptionValueMatch | undefined;
//   argumentNames?: OptionValueMatch | undefined;
//   condition?: OptionValueMatch | undefined;
//   remaining: SyntaxNode[];
//   found: OptionValueMatch[];
//   unused: Option[];
//   document: LspDocument;
// }
//
// export class CompletionSymbol {
//   public flags: typeof CompletionSymbolFlags = {
//     short: [] as OptionValueMatch[],
//     long: [] as OptionValueMatch[],
//     old: [] as OptionValueMatch[],
//   } as typeof CompletionSymbolFlags;
//   public command: string | undefined = undefined;
//   public description: OptionValueMatch | undefined = undefined;
//   public argumentNames: OptionValueMatch | undefined = undefined;
//   public condition: OptionValueMatch | undefined = undefined;
//   public remaining: SyntaxNode[] = [];
//   public found: OptionValueMatch[] = [];
//   public unused: Option[] = [];
//   public document: LspDocument;
//
//   static create(opts: CompletionSymbolOptions) {
//     return new this(opts);
//   }
//
//   constructor(opts: CompletionSymbolOptions) {
//     this.flags = opts.flags;
//     this.command = opts.command?.text || opts.document.getAutoLoadName();
//     this.description = opts?.description;
//     this.remaining = opts.remaining || [];
//     this.found = opts.found || [];
//     this.unused = opts.unused || [];
//     this.document = opts.document;
//   }
//
//   public getFlags() {
//     return {
//       short: this.flags.short || [],
//       long: this.flags.long || [],
//       old: this.flags.old || [],
//     };
//   }
//
//   getShortOptions() {
//     return this.flags.short?.map(item => item.option) || [];
//   }
//
//   getLongOptions() {
//     return this.flags.long?.map(item => item.option) || [];
//   }
//
//   getOldOptions() {
//     return this.flags.old?.map(item => item.option) || [];
//   }
//
//   hasShortOptions() {
//     return this.getShortOptions().length > 0;
//   }
//
//   hasLongOptions() {
//     return this.getLongOptions().length > 0;
//   }
//
//   hasOldOptions() {
//     return this.getOldOptions().length > 0;
//   }
//
//   getCommand() {
//     return this.command;
//   }
//
//   getDescription() {
//     return this.description?.value;
//   }
//
//   getCondition() {
//     return this.condition?.value;
//   }
//
//   equals(option: Option) {
//     return this.found.some(item => option.equals(item.value));
//   }
//
//   getLocations() {
//     return this.found.map(item => {
//       return Location.create(this.document.uri, getRange(item.value));
//     });
//   }
//
//   equalsFlags(option: Option) {
//     const flags = option.getAllFlags().map(flag => {
//       if (stringIsShortFlag(flag)) {
//         return flag.replace(/^-/g, '');
//       }
//       if (stringIsLongFlag(flag)) {
//         return flag.replace(/^--/g, '');
//       }
//       if (flag.startsWith('-')) {
//         return flag.replace(/^-/g, '');
//       }
//       return flag;
//     });
//     return this.found.some(item => item.option.equalsRawOption('-s', '--short-option', '-l', '--long-option', '-o', '--old-option') && flags.includes(item.value.text));
//   }
//
//   equalsNode(node: SyntaxNode) {
//     return this.found.some(item => item.value.equals(node));
//   }
//
//   equalsFishSymbol(symbol: FishSymbol) {
//     const { scopeNode, uri } = symbol;
//     let commandName = scopeNode.firstNamedChild?.text || '';
//     if (isProgram(scopeNode)) {
//       commandName = pathToRelativeFunctionName(uriToPath(uri));
//     }
//     const symbolName = symbol.argparseFlagName;
//     return commandName === this.command
//       && this.found.some(item => item.value.text === symbolName);
//   }
//
//   toLocation(symbol: FishSymbol): Location {
//     const text = this.found.find(opt => {
//       return opt.value.text === symbol.argparseFlagName;
//     })!;
//     return Location.create(this.document.uri, getRange(text?.value));
//   }
//
//   toShortLocation() {
//     return this.flags.short.map(item => {
//       return Location.create(this.document.uri, getRange(item.value));
//     });
//   }
//
//   toLongLocation() {
//     return this.flags.long.map(item => {
//       return Location.create(this.document.uri, getRange(item.value));
//     });
//   }
//
//   toOldLocation() {
//     return this.flags.old.map(item => {
//       return Location.create(this.document.uri, getRange(item.value));
//     });
//   }
//
//   fromNodeToLocation(node: SyntaxNode) {
//     if (isCompletionSymbol(node)) {
//       return Location.create(this.document.uri, getRange(node));
//     }
//     return null;
//   }
//
//   toArgparse(node: SyntaxNode | null = null) {
//     const argparseNames: string[] = [];
//     if (!node) {
//       argparseNames.push(...[
//         ...this.found.filter(item => item.option.equalsRawOption('-s', '--short-option')).map(item => item.value.text),
//         ...this.found.filter(item => item.option.equalsRawOption('-l', '--long-option')).map(item => item.value.text),
//         ...this.found.filter(item => item.option.equalsRawOption('-o', '--old-option')).map(item => item.value.text),
//       ]);
//     } else if (node) {
//       argparseNames.push(
//         ...this.found
//           .filter(item => item.value.text === node.text)
//           .map(item => item.value.text),
//       );
//     }
//     return {
//       commandName: this.command,
//       argparseFlagName: argparseNames.map(item => `_flag_${item.replace(/^-+/, '_')}`),
//     };
//   }
// }
