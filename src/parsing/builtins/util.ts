
import { SyntaxNode } from 'web-tree-sitter';
import { isEndStdinCharacter, isOption } from '../../utils/node-types';
import { ShortFlag, LongFlag, UnixFlag, Option, FlagArray } from '../options';

/**
 * A single flag found inside an option node. One node can hold several flags (`-gx`).
 */
export type ParsedFlag = {
  node: SyntaxNode;
  flag: string;
  option?: Option;
  hasInlineValue: boolean;
};

export type FlagIssue =
  | { kind: 'unknown-flag'; node: SyntaxNode; flag: string; }
  | { kind: 'conflicting-flags'; node: SyntaxNode; flag: string; option: Option; conflictsWith: ParsedFlag; group?: string; }
  | { kind: 'unknown-subcommand'; node: SyntaxNode; name: string; }
  | { kind: 'rule'; node: SyntaxNode; flag: string; message: string; related: ParsedFlag[]; };

export type FlagIssueOptions = {
  /**
   * stop looking for flags at the first non-option argument
   * (builtins like `set`, where `set foo -x` treats `-x` as a value)
   */
  stopAtFirstArgument?: boolean;
  /**
   * groups (see `Option.inGroup()`) where only one of the group's options can be used
   */
  exclusiveGroups?: Iterable<string>;
};

/**
 * The first exclusive group that both options are in, if any
 */
function sharedExclusiveGroup(a: Option, b: Option, exclusiveGroups: Iterable<string>): string | undefined {
  if (a === b) return undefined;
  for (const group of exclusiveGroups) {
    if (a.isInGroup(group) && b.isInGroup(group)) return group;
  }
  return undefined;
}

/**
 * Splits an option node into the individual flags it contains:
 *   - `--long=value` -> `--long`
 *   - `-name`        -> `-name` (when `-name` is a known unix flag)
 *   - `-gx`          -> `-g`, `-x`
 *   - `-n3`          -> `-n` (when `-n` takes a value, the rest of the token is its value)
 */
export function splitFlags(node: SyntaxNode, options: Option[]): ParsedFlag[] {
  const text = node.text;
  const equalsIdx = text.indexOf('=');
  const whole = equalsIdx === -1 ? text : text.slice(0, equalsIdx);

  if (text.startsWith('--')) {
    const option = options.find(o => o.hasFlag(whole));
    return [{ node, flag: whole, option, hasInlineValue: equalsIdx !== -1 }];
  }

  const unixOption = options.find(o => o.unixOptions.includes(whole as UnixFlag));
  if (unixOption) {
    return [{ node, flag: whole, option: unixOption, hasInlineValue: equalsIdx !== -1 }];
  }

  const result: ParsedFlag[] = [];
  for (let i = 1; i < text.length; i++) {
    const flag = `-${text[i]}`;
    const option = options.find(o => o.hasFlag(flag));
    const hasRest = i + 1 < text.length;
    if (option && !option.isSwitch() && hasRest) {
      result.push({ node, flag, option, hasInlineValue: true });
      break;
    }
    result.push({ node, flag, option, hasInlineValue: false });
  }
  return result;
}

/**
 * Find flags in `args` that are not one of `options`, or that can't be combined
 * with a flag seen earlier (see `Option.conflictsWith()`/`Option.mutuallyExclusive()`,
 * and `opts.exclusiveGroups`).
 *
 * @param args the command's arguments (excluding the command name, and subcommand name)
 */
export function findFlagIssues(args: SyntaxNode[], options: Option[], opts: FlagIssueOptions = {}): FlagIssue[] {
  return parseFlagUsage(args, options, opts).issues;
}

/**
 * Same as `findFlagIssues()`, but also returns every known flag that was used (in order),
 * which `FlagRule` callbacks are checked against.
 */
export function parseFlagUsage(args: SyntaxNode[], options: Option[], opts: FlagIssueOptions = {}): { issues: FlagIssue[]; used: ParsedFlag[]; } {
  const exclusiveGroups = Array.from(opts.exclusiveGroups ?? []);
  const issues: FlagIssue[] = [];
  const seen: ParsedFlag[] = [];
  let skipNext = false;
  for (const node of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (isEndStdinCharacter(node)) break;
    if (!isOption(node)) {
      if (opts.stopAtFirstArgument) break;
      continue;
    }
    for (const parsed of splitFlags(node, options)) {
      const option = parsed.option;
      if (!option) {
        issues.push({ kind: 'unknown-flag', node, flag: parsed.flag });
        continue;
      }
      // prefer reporting the group (`only one 'scope' flag`) over the pairwise conflict
      let group: string | undefined;
      let prior: ParsedFlag | undefined;
      for (const s of seen) {
        group = sharedExclusiveGroup(s.option!, option, exclusiveGroups);
        if (group) {
          prior = s;
          break;
        }
      }
      prior ??= seen.find(s => s.option!.isConflictingWith(option));
      if (prior) {
        issues.push({ kind: 'conflicting-flags', node, flag: parsed.flag, option, conflictsWith: prior, group });
      }
      seen.push(parsed);
      if (option.requiresValue() && !parsed.hasInlineValue) skipNext = true;
    }
  }
  return { issues, used: seen };
}

/**
 * What a `FlagRule` callback can check a command usage against
 */
export type FlagRuleContext = {
  cmd: BaseCmd;
  args: SyntaxNode[];
  /** every known flag used, in order (`-lg` is two entries) */
  used: ParsedFlag[];
  /** the first use of `option`, if any */
  find(option: Option): ParsedFlag | undefined;
  /** every use of an option in `group` (see `Option.inGroup()`) */
  usedInGroup(group: string): ParsedFlag[];
};

/**
 * A callback that checks how a command's flags are used, and returns any issues found
 */
export type FlagRule = (ctx: FlagRuleContext) => FlagIssue | FlagIssue[] | undefined;

/**
 * Either a single option, or the name of a group of options (see `Option.inGroup()`)
 */
export type FlagSelector = Option | string;

const formatFlags = (options: Option[]) => options.map(o => `\`${o.toString()}\``).join(', ');

/**
 * Common `FlagRule` callbacks
 */
export namespace Rules {
  /**
   * Only one option from `group` can be used (`set -l -g`)
   */
  export function exclusive(group: string): FlagRule {
    return ({ cmd, usedInGroup }) => {
      const [first, ...rest] = usedInGroup(group);
      if (!first) return;
      return rest
        .filter(later => later.option !== first.option)
        .map(later => ({
          kind: 'rule',
          node: later.node,
          flag: later.flag,
          message: `\`${later.flag}\` can't be used with \`${first.flag}\`, only one ${group} flag is allowed (${formatFlags(cmd.getGroup(group))})`,
          related: [first],
        }));
    };
  }

  /**
   * `target` can't be used together with any of `others` (`set --erase --query`).
   * The issue is reported on whichever flag is used last.
   */
  export function conflicts(target: FlagSelector, ...others: FlagSelector[]): FlagRule {
    return ({ cmd, used }) => {
      const resolve = (selector: FlagSelector) => typeof selector === 'string' ? cmd.getGroup(selector) : [selector];
      const targets = new Set(resolve(target));
      const otherOptions = new Set(others.flatMap(resolve));
      const issues: FlagIssue[] = [];
      used.forEach((later, idx) => {
        const earlier = used.slice(0, idx).find(prior =>
          prior.option !== later.option && (
            targets.has(prior.option!) && otherOptions.has(later.option!)
            || otherOptions.has(prior.option!) && targets.has(later.option!)
          ));
        if (!earlier) return;
        issues.push({
          kind: 'rule',
          node: later.node,
          flag: later.flag,
          message: `\`${later.flag}\` can't be used with \`${earlier.flag}\``,
          related: [earlier],
        });
      });
      return issues;
    };
  }
}

export interface Flag {
  short?: ShortFlag;
  long?: LongFlag;
  unix?: UnixFlag;

  requiresValue?: boolean;
  values?: string;
}

// export type BuiltinCommand

// export type BaseBuiltinCommand = {
//   name: string;
//   flags: Option[];
// } | {
//   name: string;
//   flags: Option[];
//   exclusive: Option[];
// }

/**
 * Where a command's flag definitions came from:
 *   - `hardcoded`: written in `src/parsing/builtins` (fish builtins/shipped functions), so the
 *     flags are fish's own and any other flag is unknown to fish (`set -s`)
 *   - `document`: built while parsing a user's script (e.g., their function's `argparse` call)
 */
export type CmdOrigin =
  | { kind: 'hardcoded'; }
  | { kind: 'document'; uri: string; };

export class BaseCmd {
  public exclusiveGroups: Set<string> = new Set();
  public rules: FlagRule[] = [];

  constructor(
    public name: string,
    public flags: Option[] = [],
    public origin: CmdOrigin = { kind: 'hardcoded' },
  ) { }

  getFlags() {
    return this.flags;
  }

  /**
   * All options labeled with `group` (see `Option.inGroup()`)
   */
  getGroup(group: string): Option[] {
    return this.flags.filter(flag => flag.isInGroup(group));
  }

  /**
   * Only allow one option from each of the `groups` per command (`set -l -g` is an error)
   */
  withExclusiveGroups(...groups: string[]): this {
    groups.forEach(group => this.exclusiveGroups.add(group));
    return this;
  }

  /**
   * Add callbacks that check how this command's flags are used (see `Rules`)
   */
  withRules(...rules: FlagRule[]): this {
    this.rules.push(...rules);
    return this;
  }

  /**
   * Mark this command as written in `src/parsing/builtins` (the default for `BaseCmd.create()`),
   * so its flags are treated as the only flags fish accepts for it
   */
  setHardcoded(): this {
    this.origin = { kind: 'hardcoded' };
    return this;
  }

  isHardcoded(): boolean {
    return this.origin.kind === 'hardcoded';
  }

  isFromDocument(): boolean {
    return this.origin.kind === 'document';
  }

  /**
   * Unknown flags and pairwise conflicts, plus the issues from `this.rules`.
   * A rule's issue replaces a pairwise conflict reported for the same flag, since it's more specific.
   */
  validate(args: SyntaxNode[], opts: FlagIssueOptions = {}): FlagIssue[] {
    const { issues, used } = parseFlagUsage(args, this.flags, { exclusiveGroups: this.exclusiveGroups, ...opts });
    const ctx: FlagRuleContext = {
      cmd: this,
      args,
      used,
      find: option => used.find(u => u.option === option),
      usedInGroup: group => used.filter(u => u.option!.isInGroup(group)),
    };
    const ruleIssues: FlagIssue[] = [];
    for (const rule of this.rules) {
      const result = rule(ctx);
      if (!result) continue;
      ruleIssues.push(...Array.isArray(result) ? result : [result]);
    }
    const key = (issue: { node: SyntaxNode; flag: string; }) => `${issue.node.id}:${issue.flag}`;
    const reportedByRule = new Set(ruleIssues.flatMap(i => 'flag' in i ? [key(i)] : []));
    return [
      ...issues.filter(i => i.kind !== 'conflicting-flags' || !reportedByRule.has(key(i))),
      ...ruleIssues,
    ];
  }

  static create(
    name: string,
    ...flags: FlagInput[]
  ) {
    return new this(name, flags.map(toOption));
  }

  /**
   * Build a command from flags found while parsing a document (e.g., a function's `argparse`)
   */
  static fromDocument(
    uri: string,
    name: string,
    ...flags: FlagInput[]
  ) {
    return new this(name, flags.map(toOption), { kind: 'document', uri });
  }

  static is(
    arg: unknown,
  ): arg is BaseCmd {
    if (arg instanceof BaseCmd) return true;
    if (typeof arg !== 'object' || arg === null) return false;
    const obj = arg as Partial<Record<keyof BaseCmd, unknown>>;
    return typeof obj.name === 'string'
      && Array.isArray(obj.flags)
      && typeof obj.getFlags === 'function';
  }
}

/**
 * A flag can be passed as an `Option`, or as raw flags that are aliases of each other:
 *   - `Option.create('-f', '--find').withValue()`
 *   - `['-f', '--find']`
 */
export type FlagInput = Option | FlagArray;

/**
 * A subcommand can be passed as any of the following:
 *   - `BaseCmd.create('resolve', Option.create('-q', '--quiet'))`
 *   - `{ name: 'resolve', flags: [Option.create('-q', '--quiet'), ['-h', '--help']] }`
 *   - `['resolve', Option.create('-q', '--quiet'), ['-h', '--help']]`
 */
export type SubcmdInput =
  | BaseCmd
  | { name: string; flags: FlagInput[]; }
  | [name: string, ...flags: FlagInput[]];

export function toOption(flag: FlagInput): Option {
  return Option.is(flag) ? flag : Option.fromRaw(...flag);
}

export function toSubcmd(subcmd: SubcmdInput): BaseCmd {
  if (BaseCmd.is(subcmd)) return subcmd;
  if (Array.isArray(subcmd)) {
    const [name, ...flags] = subcmd;
    return BaseCmd.create(name, ...flags);
  }
  return BaseCmd.create(subcmd.name, ...subcmd.flags);
}

export class BuiltinCommandWithSubcmds {
  private subcmdNames: Set<string>;
  private subcmdMap: Map<string, Option[]>;

  constructor(
    public name: string,
    public subcmds: BaseCmd[],
  ) {
    this.subcmdNames = new Set(subcmds.map(n => n.name));
    this.subcmdMap = new Map(subcmds.map(cmd => [cmd.name, cmd.flags]));
  }

  allSubcmdNames() {
    return this.subcmdMap.keys();
  }

  getSubcmd(name: string) {
    return this.subcmds.find(cmd => cmd.name === name);
  }

  has(name: string) {
    return this.subcmdNames.has(name);
  }

  getFlags(name: string) {
    return this.subcmds.find(cmd => cmd.name === name);
  }

  getExclusiveFlags(name: string) {
    return this.subcmds.find(cmd => cmd.name === name);
  }

  /**
   * @param args the command's arguments, the first non-option is the subcommand (`string match -r ...`)
   */
  validate(args: SyntaxNode[], opts: FlagIssueOptions = {}): FlagIssue[] {
    const subcmdIdx = args.findIndex(arg => !isOption(arg));
    const subcmdNode = args[subcmdIdx];
    if (!subcmdNode) return [];
    const subcmd = this.getSubcmd(subcmdNode.text);
    if (!subcmd) return [{ kind: 'unknown-subcommand', node: subcmdNode, name: subcmdNode.text }];
    return subcmd.validate(args.slice(subcmdIdx + 1), opts);
  }

  logObj() {
    return {
      name: this.name,
      subcmds: this.subcmds.map((sub) => ({
        name: sub.name,
        flags: sub.flags.map(f => `[${f.getAllFlags().join(',')}]`).join(', '),
      })),
    };
  }

  static create(
    name: string,
    ...subcmds: SubcmdInput[]
  ) {
    return new this(name, subcmds.map(toSubcmd));
  }
}
