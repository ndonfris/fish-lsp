import { SyntaxNode } from 'web-tree-sitter';
import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../utils/node-types';
import { getRange } from '../utils/tree-sitter';
import * as LSP from 'vscode-languageserver';

type AlphaLowercaseChar = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type AlphaUppercaseChar = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
type AlphaChar = AlphaLowercaseChar | AlphaUppercaseChar;
type DigitChar = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type ExtraChar = '?' | '!' | '@' | '$' | '%' | '^' | '&' | '*' | '(' | ')' | '-' | '_' | '+' | '=' | '{' | '}' | '[' | ']' | '|' | ';' | ':' | '"' | "'" | '<' | '>' | ',' | '.' | '/' | '\\' | '~' | '`';
type Character = AlphaChar | DigitChar | ExtraChar;

export type ShortFlag = `-${Character}`;
export type UnixFlag = `-${string}`;
export type LongFlag = `--${string}`;

const stringIsShortFlag = (str: string): str is ShortFlag => str.startsWith('-') && str.length === 2;
const stringIsLongFlag = (str: string): str is LongFlag => str.startsWith('--');
const stringIsUnixFlag = (str: string): str is UnixFlag => str.startsWith('-') && str.length > 2 && !str.startsWith('--');

export class Option {
  public shortOptions: ShortFlag[] = [];
  public unixOptions: UnixFlag[] = [];
  public longOptions: LongFlag[] = [];
  private requiresArgument: boolean = false;
  private acceptsMultipleArguments: boolean = false;
  private optionalArgument: boolean = false;

  static create(shortOption: ShortFlag | '', longOption: LongFlag | ''): Option {
    const option = new Option();
    if (shortOption) {
      option.shortOptions.push(shortOption);
    }
    if (longOption) {
      option.longOptions.push(longOption);
    }
    return option;
  }

  static long(longOption: LongFlag): Option {
    const option = new Option();
    option.longOptions.push(longOption);
    return option;
  }

  static short(shortOption: ShortFlag): Option {
    const option = new Option();
    option.shortOptions.push(shortOption);
    return option;
  }

  addUnixFlag(...options: UnixFlag[]): Option {
    this.unixOptions.push(...options);
    return this;
  }

  /**
   * use addUnixFlag if you want to store unix flags in this object
   */
  withAliases(...optionAlias: ShortFlag[] | LongFlag[] | string[]): Option {
    for (const alias of optionAlias) {
      if (stringIsLongFlag(alias)) {
        this.longOptions.push(alias);
        continue;
      }
      if (stringIsShortFlag(alias)) {
        this.shortOptions.push(alias as ShortFlag);
        continue;
      }
    }
    return this;
  }

  isOption(shortOption: ShortFlag | '', longOption: LongFlag | ''): boolean {
    if (shortOption) {
      return this.shortOptions.includes(shortOption);
    } else if (longOption) {
      return this.longOptions.includes(longOption);
    }
    return false;
  }

  /**
   * Mark this option as requiring a value
   */
  withValue(): Option {
    this.requiresArgument = true;
    this.optionalArgument = false;
    this.acceptsMultipleArguments = false;
    return this;
  }

  /**
   * Mark this option as accepting an optional value
   */
  withOptionalValue(): Option {
    this.optionalArgument = true;
    this.requiresArgument = false;
    this.acceptsMultipleArguments = false;
    return this;
  }

  /**
   * Mark this option as accepting multiple values
   */
  withMultipleValues(): Option {
    this.acceptsMultipleArguments = true;
    this.requiresArgument = true;
    this.optionalArgument = false;
    return this;
  }

  /**
   * Check if this option is a boolean switch (takes no value)
   *
   * A switch is a flag that does not require a value to be set. Another common name for
   * this type of flag is a boolean flag.
   *
   * A switch is either enabled or disabled.
   *
   * You can pair this with `Option.equals(node) && Option.isSwitch()` to get the switch's found on sequence
   *
   * @returns true if the flag is a switch, if the flag requires a value to be set false.
   */
  isSwitch(): boolean {
    return !this.requiresArgument && !this.optionalArgument;
  }

  matchesValue(node: SyntaxNode): boolean {
    if (this.isSwitch()) {
      return false;
    }

    // Handle direct values (--option=value)
    if (isOption(node) && node.text.includes('=')) {
      const [flag] = node.text.split('=');
      return this.matches({ ...node, text: flag } as SyntaxNode);
    }

    let prev: SyntaxNode | null = node.previousSibling;
    // Handle values that follow the option
    // const prev = node.previousSibling;
    if (this.acceptsMultipleArguments) {
      while (prev) {
        if (isOption(prev) && !prev.text.includes('=')) {
          return this.matches(prev);
        }
        if (isOption(prev)) return false;
        prev = prev.previousSibling;
      }
    }

    return !!prev && this.matches(prev);
  }

  /**
   * Check if this option is present in the given node
   */
  matches(node: SyntaxNode, checkWithEquals: boolean = true): boolean {
    if (!isOption(node)) return false;

    const nodeText = checkWithEquals && node.text.includes('=')
      ? node.text.slice(0, node.text.indexOf('='))
      : node.text;

    if (isLongOption(node)) {
      return this.matchesLongFlag(nodeText);
    }

    if (isShortOption(node) && this.unixOptions.length >= 1) {
      return this.matchesUnixFlag(nodeText);
    }

    if (isShortOption(node)) {
      return this.matchesShortFlag(nodeText);
    }

    return false;
  }

  private matchesLongFlag(text: string): boolean {
    if (!text.startsWith('--')) return false;
    if (stringIsLongFlag(text)) {
      return this.longOptions.includes(text);
    }
    return false;
  }

  private matchesUnixFlag(text: string): boolean {
    if (stringIsUnixFlag(text) && text.length > 2) {
      return this.unixOptions.includes(text);
    }
    return false;
  }

  private matchesShortFlag(text: string): boolean {
    if (!text.startsWith('-') || text.startsWith('--')) return false;

    // Handle combined short flags like "-abc"
    const chars = text.slice(1).split('').map(char => `-${char}` as ShortFlag);
    return chars.some(char => this.shortOptions.includes(char));
  }

  equals(node: SyntaxNode, allowEquals = false): boolean {
    if (!isOption(node)) false;
    const text = allowEquals ? node.text.slice(0, node.text.indexOf('=')) : node.text;
    if (isLongOption(node)) return this.matchesLongFlag(text);
    if (isShortOption(node) && this.unixOptions.length >= 1) return this.matchesUnixFlag(text);
    if (isShortOption(node)) return this.matchesShortFlag(text);
    return false;
  }

  /**
   * Warning, does not search oldUnixFlag
   */
  equalsRawOption(...rawOption: (ShortFlag | LongFlag)[]): boolean {
    for (const option of rawOption) {
      if (stringIsLongFlag(option) && this.longOptions.includes(option)) {
        return true;
      }
      if (stringIsShortFlag(option) && this.shortOptions.includes(option)) {
        return true;
      }
    }
    return false;
  }

  equalsRawShortOption(...rawOption: ShortFlag[]): boolean {
    return rawOption.some(option => this.shortOptions.includes(option));
  }

  equalsRawLongOption(...rawOption: LongFlag[]): boolean {
    return rawOption.some(option => this.longOptions.includes(option));
  }

  findValueRangeAfterEquals(node: SyntaxNode): LSP.Range | null {
    if (!isOption(node)) return null;
    if (!node.text.includes('=')) return null;
    const range = getRange(node);
    if (!range) return null;
    const equalsIndex = node.text.indexOf('=');
    return LSP.Range.create(range.start.line, range.start.character + equalsIndex + 1, range.end.line, range.end.character);
  }

  /**
  * Checks if a `-f/--flag` if a enabled (like a boolean switch) or if it is set with a value.
  * ```
  * function foo --description 'this is a description' --no-scope-shadowing; end;
  * ```
  *                             ^--isSet                 ^--isSet
  *              ^-- not set
  * @param node to check if it is set
  * @returns true if the node is set
  */
  isSet(node: SyntaxNode): boolean {
    if (isOption(node)) {
      return this.equals(node) && this.isSwitch();
    }
    return this.matchesValue(node);
  }

  getAllFlags(): Array<string> {
    const result: string[] = [];
    if (this.shortOptions) result.push(...this.shortOptions);
    if (this.unixOptions) result.push(...this.unixOptions);
    if (this.longOptions) result.push(...this.longOptions);
    return result;
  }

  toString(): string {
    return this.getAllFlags().join(', ');
  }

  asNodeQueryOption(): NodeOptionQueryText {
    return {
      shortOption: this.shortOptions.at(0),
      oldUnixOption: this.unixOptions.at(0),
      longOption: this.longOptions.at(0),
    };
  }
}

export type OptionValueMatch = {
  option: Option;
  value: SyntaxNode;
};

export function findOptionsSet(nodes: SyntaxNode[], options: Option[]): OptionValueMatch[] {
  const result: OptionValueMatch[] = [];
  for (const node of nodes) {
    const values = options.filter(o => o.isSet(node));
    if (!values) {
      continue;
    }
    values.forEach(option => result.push({ option, value: node }));
  }
  return result;
}

export function findOptions(nodes: SyntaxNode[], options: Option[]): { remaining: SyntaxNode[]; found: OptionValueMatch[]; unused: Option[]; } {
  const result: {
    remaining: SyntaxNode[];
    found: OptionValueMatch[];
    unused: Option[];
  } = { remaining: [], found: [], unused: [] };
  result.unused = Array.from(options);
  for (const node of nodes) {
    const values = options.filter(o => o.isSet(node));
    if (values.length === 0 && !isOption(node)) {
      result.remaining.push(node);
      continue;
    }
    values.forEach(option => {
      result.unused.splice(result.unused.indexOf(option), 1);
      result.found.push({ option, value: node });
    });
  }
  return result;
}

export function isMatchingOption(node: SyntaxNode, ...option: Option[]): boolean {
  for (const opt of option) {
    if (opt.matches(node)) {
      return true;
    }
  }
  return false;
}

export function findMatchingOptions(node: SyntaxNode, ...options: Option[]): Option | undefined {
  return options.find((opt: Option) => opt.matches(node));
}

export function isMatchingOptionOrOptionValue(node: SyntaxNode, option: Option): boolean {
  if (isMatchingOption(node, option)) {
    return true;
  }
  const prevNode = node.previousNamedSibling;
  if (prevNode?.text.includes('=')) {
    return false;
  }
  if (prevNode && isMatchingOption(prevNode, option) && !isOption(node)) {
    return true;
  }
  return false;
}
