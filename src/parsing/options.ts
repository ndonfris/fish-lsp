import { SyntaxNode } from 'web-tree-sitter';
import { isLongOption, isOption, isShortOption } from '../utils/node-types';
import { getRange } from '../utils/tree-sitter';
import * as LSP from 'vscode-languageserver';

/**
 * Type definitions to allow us for checking single character (short) flags.
 */
type AlphaLowercaseChar = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type AlphaUppercaseChar = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
type AlphaChar = AlphaLowercaseChar | AlphaUppercaseChar;
type DigitChar = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type ExtraChar = '?' | '!' | '@' | '$' | '%' | '^' | '&' | '*' | '(' | ')' | '+' | '=' | '{' | '}' | '[' | ']' | '|' | ';' | ':' | '"' | "'" | '<' | '>' | ',' | '.' | '/' | '\\' | '~' | '`';
type Character = AlphaChar | DigitChar | ExtraChar;

/**
 * flags types using template literals to ensure the following type safetry:
 * - ShortFlag is max a single character.
 * - UnixFlag can be single or multiple characters, but must start with a single `-`.
 * - LongFlag must start with `--` and can be multiple characters.
 */
export type ShortFlag = `-${Character}`;
export type UnixFlag = `-${string}`;
export type LongFlag = `--${string}`;
export type Flag = ShortFlag | UnixFlag | LongFlag;
export type FlagArray = Array<ShortFlag | UnixFlag | LongFlag>;

export const isFlagArray = (arr: string[]): arr is FlagArray => {
  for (const item of arr) {
    if (!FlagUtil.stringIsAnyFlag(item)) return false;
  }
  return true;
};

export namespace FlagUtil {
  export type Short = `-${Character}`;
  export type Unix = `-${string}`;
  export type Long = `--${string}`;

  export type FlagUnion = ShortFlag | UnixFlag | LongFlag;
  export type FlagArray = Array<ShortFlag | UnixFlag | LongFlag>;

  export const stringIsShortFlag = (str: string): str is ShortFlag => str.startsWith('-') && str.length === 2;
  export const stringIsLongFlag = (str: string): str is LongFlag => str.startsWith('--');
  export const stringIsUnixFlag = (str: string): str is UnixFlag => str.startsWith('-') && str.length > 2 && !str.startsWith('--');

  export const stringIsAnyFlag = (str: string): str is FlagUnion => str.startsWith('-');

  export const stringArrayIsFlagCombo = (arr: string[]): arr is FlagArray => {
    for (const item of arr) {
      if (!stringIsAnyFlag(item)) return false;
    }
    return true;
  };
}

/**
 * Type Guard for converting a option string into the correct flag type.
 */
export const stringIsShortFlag = (str: string): str is ShortFlag => str.startsWith('-') && str.length === 2;
export const stringIsLongFlag = (str: string): str is LongFlag => str.startsWith('--');
export const stringIsUnixFlag = (str: string): str is UnixFlag => str.startsWith('-') && str.length > 2 && !str.startsWith('--');

/**
 * Counts the number of leading dashes in a string. Useful for determining the type of flag (short, unix, long) based on the number of leading dashes.
 * @param str The string to count leading dashes in.
 * @returns The number of leading dashes in the string.
 */
export function getLeadingDashCount(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '-') count++;
    if (str[i] !== '-') break;
  }
  return count;
}

export class Option {
  public shortOptions: ShortFlag[] = [];
  public unixOptions: UnixFlag[] = [];
  public longOptions: LongFlag[] = [];
  private requiresArgument: boolean = false;
  private acceptsMultipleArguments: boolean = false;
  private optionalArgument: boolean = false;
  private conflicts: Set<Option> = new Set();
  private description: string | undefined;
  private groups: Set<string> = new Set();

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

  static unix(unixOption: UnixFlag): Option {
    const option = new Option();
    option.unixOptions.push(unixOption);
    return option;
  }

  static fromRaw(...str: string[]) {
    const option = new Option();
    for (const s of str) {
      if (stringIsLongFlag(s)) {
        option.longOptions.push(s);
      } else if (stringIsShortFlag(s)) {
        option.shortOptions.push(s as ShortFlag);
      } else if (stringIsUnixFlag(s)) {
        option.unixOptions.push(s as UnixFlag);
      }
    }
    return option;
  }

  /**
   * Marks every option given as unable to be combined with any of the others.
   * Returns the same options, so the result can be spread into a flag list:
   *
   * ```typescript
   * BaseCmd.create('set',
   *   ...Option.mutuallyExclusive(Option.create('-l', '--local'), Option.create('-g', '--global')),
   * );
   * ```
   */
  static mutuallyExclusive(...options: Option[]): Option[] {
    options.forEach((option, idx) => option.conflictsWith(...options.slice(idx + 1)));
    return options;
  }

  /**
   * Marks this option as unable to be combined with `others` (e.g., `set --erase --query`).
   * The relationship is symmetric: `others` are also marked as conflicting with this option.
   */
  conflictsWith(...others: Option[]): Option {
    for (const other of others) {
      if (other === this) continue;
      this.conflicts.add(other);
      other.conflicts.add(this);
    }
    return this;
  }

  /**
   * Check if this option can't be used together with `other`
   */
  isConflictingWith(other: Option): boolean {
    if (other === this) return false;
    return this.conflicts.has(other) || other.conflicts.has(this);
  }

  getConflicts(): Option[] {
    return Array.from(this.conflicts);
  }

  /**
   * Store a short description of the flag (e.g., `'Make variable scope global'`)
   */
  withDescription(description: string): Option {
    this.description = description;
    return this;
  }

  getDescription(): string | undefined {
    return this.description;
  }

  /**
   * Label this option as part of one or more named groups, so related flags can be looked up
   * together (e.g., `set`'s `-l/-g/-U/-f` flags are all in the `'scope'` group).
   *
   * A group is only a label. To only allow one flag of a group per command, see
   * `BaseCmd.withExclusiveGroups()`.
   */
  inGroup(...groups: string[]): Option {
    groups.forEach(group => this.groups.add(group));
    return this;
  }

  isInGroup(group: string): boolean {
    return this.groups.has(group);
  }

  getGroups(): string[] {
    return Array.from(this.groups);
  }

  /**
   * Check if the raw flag string (`-g`, `--global`, `-name`) is any of this option's flags
   */
  hasFlag(flag: string): boolean {
    return this.shortOptions.includes(flag as ShortFlag)
      || this.unixOptions.includes(flag as UnixFlag)
      || this.longOptions.includes(flag as LongFlag);
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

  /** Whether the flag consumes the next argument as its value (`-M insert`). */
  requiresValue(): boolean {
    return this.requiresArgument;
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
    if (!isOption(node)) return false;
    const text = allowEquals ? node.text.slice(0, node.text.indexOf('=')) : node.text;
    if (isLongOption(node)) return this.matchesLongFlag(text);
    if (isShortOption(node) && this.unixOptions.length >= 1) return this.matchesUnixFlag(text);
    if (isShortOption(node)) return this.matchesShortFlag(text);
    return false;
  }

  /**
   * Warning, does not search oldUnixFlag
   */
  equalsRawOption(...rawOption: Flag[]): boolean {
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

  equalsOption(other: Option): boolean {
    const flags = other.getAllFlags() as Flag[];
    return this.equalsRawOption(...flags);
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

  toName(): string {
    if (this.longOptions.length > 0) {
      return this.longOptions[0]!.replace(/^--/, '');
    }
    if (this.unixOptions.length > 0) {
      return this.unixOptions[0]!.replace(/^-/, '');
    }
    if (this.shortOptions.length > 0) {
      return this.shortOptions[0]!.replace(/^-/, '');
    }
    return '';
  }

  /**
   * Type guard for checking if an unknown value is an `Option`.
   *
   * Falls back to a structural check when `instanceof` fails, so that `Option`
   * objects created by a separate copy of this module (or cloned/spread
   * objects that kept the prototype's methods) are still recognized.
   *
   * ```typescript
   * if (Option.is(obj)) obj.matches(node);
   * ```
   */
  static is(arg: unknown): arg is Option {
    if (arg instanceof Option) return true;
    if (typeof arg !== 'object' || arg === null) return false;
    const obj = arg as Partial<Record<keyof Option, unknown>>;
    return Array.isArray(obj.shortOptions)
      && Array.isArray(obj.unixOptions)
      && Array.isArray(obj.longOptions)
      && typeof obj.matches === 'function'
      && typeof obj.isSwitch === 'function';
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
  const remaining: SyntaxNode[] = [];
  const found: OptionValueMatch[] = [];
  const unused = Array.from(options);
  for (const node of nodes) {
    const values = options.filter(o => o.isSet(node));
    if (values.length === 0 && !isOption(node)) {
      remaining.push(node);
      continue;
    }
    values.forEach(option => {
      unused.splice(unused.indexOf(option), 1);
      found.push({ option, value: node });
    });
  }
  return {
    remaining,
    found,
    unused,
  };
}

/**
 * Check if the node is a flag that is a part of the given option(s)
 * @param node The node to check
 * @param option The option(s) to check against
 * @returns true if the node is a flag that is a part of the given option(s)
 */
export function isMatchingOption(node: SyntaxNode, ...option: Option[]): boolean {
  if (!isOption(node)) return false;
  for (const opt of option) {
    if (opt.matches(node)) return true;
  }
  return false;
}

/**
 * Check if the node is a flag that is a part of the given option(s)
 */
export function findMatchingOptions(node: SyntaxNode, ...options: Option[]): Option | undefined {
  if (!isOption(node)) return;
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

/**
 * For any option passed in, check if the node is a value set on that option.
 *
 * ```fish
 * function foo --wraps=a -w='b' --wraps 'c'; end; # matches a b c
 * #            ^^^^^^^^^    ^^^         ^^^
 * complete -c foo -s s -l long --wraps bar # matches: foo, s, long, bar
 * #           ^^^    ^    ^^^^         ^^^
 * ```
 *
 * Useful because we can match either case where tree-sitter parse a option's values
 *    • the option itself contains a value (e.g., `--wraps=a`, WHEN A `=` SIGN IS PRESENT)
 *    • the value, where the previous named silbing matches the option
 *
 * @param node The node to check
 * @param options The options to check against
 *
 * @returns true if the node is a value set on any of the given option(s)
 */
export function isMatchingOptionValue(node: SyntaxNode, ...options: Option[]): boolean {
  if (!node?.isNamed) return false;
  if (isOption(node)) {
    return options.some((option) => option.equals(node, true));
  }
  if (node.previousNamedSibling && isOption(node.previousNamedSibling)) {
    return options.some(option => option.matchesValue(node));
  }
  return false;
}
