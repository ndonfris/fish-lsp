import { SyntaxNode } from 'web-tree-sitter';
import { Option } from './options';
import { ReferenceSymbolType } from './reference-candidates';
import { getCommandNameText, isCommand, isConcatenation, isEndStdinCharacter, isFunctionDefinition, isOption } from '../utils/node-types';
import { AliasWordReferences } from './alias';
import { ArgparseWordReferences } from './argparse';
import { BindWordReferences } from './bind';
import { CompleteWordReferences } from './complete';
import { EmitWordReferences } from './emit';
import { FunctionsWordReferences, FunctionWordReferences } from './function';
import { SetWordReferences } from './set';

/**
 * Where a rule looks for a reference among a command's arguments:
 *   - `option`:     the value of one of these flags (`complete -c VALUE`, `-c=VALUE`)
 *   - `positional`: plain arguments, counted after skipping options and the values
 *                   they consume — the one `at` an index, every one `from` an
 *                   index, or `'all'`
 *   - `match`:      a named predicate for shapes the other two can't express
 */
export type WordPosition =
  | { option: Option[]; }
  | { positional: 'all' | { at: number; } | { from: number; }; }
  | { match: (node: SyntaxNode, owner: SyntaxNode) => boolean; };

export type WordReferenceRule = WordPosition & {
  /** the symbol category a word in this position references */
  kind: ReferenceSymbolType;
  /** only applies when one of these flags is present (`set -q NAME`) */
  when?: Option[];
  /** does not apply when one of these flags is present (`command X` vs `command -q X Y`) */
  unless?: Option[];
  /**
   * the matched argument is a command that gets run, and every argument after it
   * is that command's own — classified by its rules (`sudo env FOO=1 ls`)
   */
  runsCommand?: boolean;
};

/**
 * The arguments of one command that can reference a symbol. Every argument not
 * matched by a rule is literal text (`echo foo`, `set x foo`, `some_cmd foo`),
 * so a command without an entry never references anything through its arguments.
 */
export type CommandWordReferenceRules = {
  /** the command's option table: flags that take a value consume the next argument */
  options?: Option[];
  /** nothing after `--` is a reference (`argparse h/help -- foo`) */
  stopAtDoubleDash?: boolean;
  /**
   * option parsing ends at the first plain argument: it is the command being run,
   * and every later argument is its own (`sudo -u root ls -la`, `command ls -a`)
   */
  stopOptionsAtFirstArgument?: boolean;
  /** leading `NAME=value` arguments are environment assignments (`env FOO=1 ls`) */
  skipLeadingAssignments?: boolean;
  /** checked in order, first match wins */
  rules: WordReferenceRule[];
};

// Rules for commands without their own `src/parsing/<command>.ts` module.

export const CommandOptions = [
  Option.create('-a', '--all'),
  Option.create('-q', '--query'),
  Option.create('-s', '--search'),
  Option.short('-v'),
];

/** `command CMD ARGS…` runs `CMD`; `command -q/-s/-a/-v NAME…` looks up every name. */
export const CommandWordReferences: CommandWordReferenceRules = {
  options: CommandOptions,
  stopOptionsAtFirstArgument: true,
  rules: [
    { positional: 'all', kind: 'function', when: CommandOptions },
    { positional: { at: 0 }, kind: 'function', unless: CommandOptions, runsCommand: true },
  ],
};

export const BuiltinOptions = [
  Option.create('-n', '--names'),
  Option.create('-q', '--query'),
];

/** `builtin NAME ARGS…` runs `NAME`; `builtin -q NAME…` looks up every name. */
export const BuiltinWordReferences: CommandWordReferenceRules = {
  options: BuiltinOptions,
  stopOptionsAtFirstArgument: true,
  rules: [
    { positional: 'all', kind: 'function', when: BuiltinOptions },
    { positional: { at: 0 }, kind: 'function', unless: BuiltinOptions, runsCommand: true },
  ],
};

export const TypeOptions = [
  Option.create('-a', '--all'),
  Option.create('-s', '--short'),
  Option.create('-f', '--no-functions'),
  Option.create('-t', '--type'),
  Option.create('-p', '--path'),
  Option.create('-P', '--force-path'),
  Option.create('-q', '--query'),
];

/** `type NAME…`: every name is a command. */
export const TypeWordReferences: CommandWordReferenceRules = {
  options: TypeOptions,
  rules: [
    { positional: 'all', kind: 'function' },
  ],
};

/** `which NAME…`: every name is a command. */
export const WhichWordReferences: CommandWordReferenceRules = {
  rules: [
    { positional: 'all', kind: 'function' },
  ],
};

export const AbbrOptions = [
  Option.create('-a', '--add'),
  Option.create('-e', '--erase'),
  Option.long('--rename'),
  Option.create('-s', '--show'),
  Option.create('-l', '--list'),
  Option.create('-q', '--query'),
  Option.create('-p', '--position').withValue(),
  Option.create('-r', '--regex').withValue(),
  Option.long('--set-cursor').withOptionalValue(),
  Option.create('-f', '--function').withValue(),
  Option.create('-c', '--command').withValue(),
  Option.create('-h', '--help'),
];

/**
 * `abbr -a NAME EXPANSION…`: the expansion's first word is a command, as are the
 * `--function` and `--command` values. The rest of the expansion is arguments.
 */
export const AbbrWordReferences: CommandWordReferenceRules = {
  options: AbbrOptions,
  rules: [
    { option: AbbrOptions.filter(o => o.equalsRawOption('-f', '--function', '-c', '--command')), kind: 'function' },
    { positional: { at: 1 }, kind: 'function' },
  ],
};

/**
 * `RUNNER [OPTIONS] COMMAND ARGS…`: runs the plain argument at `at` as a command.
 * Only the runner's value-taking flags need listing, so their values are skipped.
 */
function runnerRules(options: Option[] = [], at = 0, extra: Partial<CommandWordReferenceRules> = {}): CommandWordReferenceRules {
  return {
    options,
    stopOptionsAtFirstArgument: true,
    ...extra,
    rules: [{ positional: { at }, kind: 'function', runsCommand: true }],
  };
}

export const ExecWordReferences = runnerRules();
export const EvalWordReferences = runnerRules();
export const TimeWordReferences = runnerRules();
export const NohupWordReferences = runnerRules();

export const SudoWordReferences = runnerRules([
  Option.create('-u', '--user').withValue(),
  Option.create('-g', '--group').withValue(),
  Option.create('-h', '--host').withValue(),
  Option.create('-p', '--prompt').withValue(),
  Option.create('-C', '--close-from').withValue(),
  Option.create('-D', '--chdir').withValue(),
  Option.create('-r', '--role').withValue(),
  Option.create('-t', '--type').withValue(),
  Option.create('-U', '--other-user').withValue(),
  Option.create('-T', '--command-timeout').withValue(),
]);

export const DoasWordReferences = runnerRules([
  Option.short('-u').withValue(),
  Option.short('-C').withValue(),
]);

/** `env [-u NAME] [NAME=value…] COMMAND ARGS…` */
export const EnvWordReferences = runnerRules([
  Option.create('-u', '--unset').withValue(),
  Option.create('-C', '--chdir').withValue(),
  Option.create('-S', '--split-string').withValue(),
], 0, { skipLeadingAssignments: true });

export const NiceWordReferences = runnerRules([
  Option.create('-n', '--adjustment').withValue(),
]);

/** `timeout [OPTIONS] DURATION COMMAND ARGS…` */
export const TimeoutWordReferences = runnerRules([
  Option.create('-s', '--signal').withValue(),
  Option.create('-k', '--kill-after').withValue(),
], 1);

export const XargsWordReferences = runnerRules([
  Option.short('-I').withValue(),
  Option.short('-L').withValue(),
  Option.short('-E').withValue(),
  Option.create('-n', '--max-args').withValue(),
  Option.create('-P', '--max-procs').withValue(),
  Option.create('-d', '--delimiter').withValue(),
  Option.create('-a', '--arg-file').withValue(),
  Option.create('-s', '--max-chars').withValue(),
]);

let registry: ReadonlyMap<string, CommandWordReferenceRules> | undefined;

/**
 * Every command's rules, keyed by command name (`function` is the header of a
 * `function` definition). Each command's rules live next to its option table in
 * `src/parsing/<command>.ts`, or above for builtins without their own module;
 * `tests/word-references.test.ts` snapshots the merged
 * table so a rule change reads as one diff.
 *
 * Built on first use: the rule modules import back into this module graph.
 */
export function getWordReferenceRegistry(): ReadonlyMap<string, CommandWordReferenceRules> {
  registry ??= new Map([
    ['abbr', AbbrWordReferences],
    ['alias', AliasWordReferences],
    ['argparse', ArgparseWordReferences],
    ['bind', BindWordReferences],
    ['builtin', BuiltinWordReferences],
    ['command', CommandWordReferences],
    ['complete', CompleteWordReferences],
    ['doas', DoasWordReferences],
    ['emit', EmitWordReferences],
    ['env', EnvWordReferences],
    ['eval', EvalWordReferences],
    ['exec', ExecWordReferences],
    ['function', FunctionWordReferences],
    ['functions', FunctionsWordReferences],
    ['nice', NiceWordReferences],
    ['nohup', NohupWordReferences],
    ['set', SetWordReferences],
    ['sudo', SudoWordReferences],
    ['time', TimeWordReferences],
    ['timeout', TimeoutWordReferences],
    ['type', TypeWordReferences],
    ['which', WhichWordReferences],
    ['xargs', XargsWordReferences],
  ]);
  return registry;
}

type ArgumentSite = {
  /** the `command` or `function_definition` the argument belongs to */
  owner: SyntaxNode;
  commandName: string;
  /** the owner's direct argument holding the node (a `concatenation` for `-w=foo`) */
  argument: SyntaxNode;
  args: SyntaxNode[];
};

function findArgumentSite(node: SyntaxNode): ArgumentSite | null {
  const argument = node.parent && isConcatenation(node.parent) ? node.parent : node;
  const owner = argument.parent;
  if (!owner) return null;
  const [commandName, args] = isFunctionDefinition(owner)
    ? ['function', owner.childrenForFieldName('option')]
    : isCommand(owner)
      ? [getCommandNameText(owner), owner.childrenForFieldName('argument')]
      : [undefined, []];
  if (!commandName || !args.some(arg => arg.equals(argument))) return null;
  return { owner, commandName, argument, args };
}

function flagOf(arg: SyntaxNode): SyntaxNode | null {
  const flag = isConcatenation(arg) ? arg.firstNamedChild : arg;
  return flag && isOption(flag) ? flag : null;
}

function isAfterDoubleDash(site: ArgumentSite): boolean {
  const dash = site.args.find(isEndStdinCharacter);
  return !!dash && dash.startIndex < site.argument.startIndex;
}

type ParsedArguments = {
  /** the flags the command itself parses */
  flags: SyntaxNode[];
  /** non-option arguments, skipping the values their flags consume */
  plain: SyntaxNode[];
};

function parseArguments(site: ArgumentSite, rules: CommandWordReferenceRules): ParsedArguments {
  const flags: SyntaxNode[] = [];
  const plain: SyntaxNode[] = [];
  for (let i = 0; i < site.args.length; i++) {
    const arg = site.args[i]!;
    if (rules.stopOptionsAtFirstArgument && plain.length > 0) {
      plain.push(arg);
      continue;
    }
    if (isEndStdinCharacter(arg)) {
      if (rules.stopAtDoubleDash) break;
      continue;
    }
    const flag = flagOf(arg);
    if (flag) {
      flags.push(flag);
      const takesValue = !arg.text.includes('=')
        && rules.options?.some(option => option.requiresValue() && option.matches(flag));
      if (takesValue) i++;
      continue;
    }
    if (rules.skipLeadingAssignments && plain.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg.text)) {
      continue;
    }
    plain.push(arg);
  }
  return { flags, plain };
}

function hasAnyFlag(parsed: ParsedArguments, options: Option[]): boolean {
  return parsed.flags.some(flag => options.some(option => option.matches(flag)));
}

/** `-w=foo` (one word, or split into a concatenation) or `-w foo`. */
function isOptionValue(node: SyntaxNode, site: ArgumentSite, options: Option[]): boolean {
  if (isOption(node)) {
    return node.text.includes('=') && options.some(option => option.matches(node));
  }
  if (!site.argument.equals(node)) {
    const flag = site.argument.firstNamedChild;
    if (flag && !flag.equals(node) && isOption(flag)) {
      return options.some(option => option.matches(flag));
    }
  }
  const prev = site.argument.previousNamedSibling;
  return !!prev && isOption(prev) && !prev.text.includes('=')
    && options.some(option => option.matches(prev));
}

function isPositional(node: SyntaxNode, site: ArgumentSite, parsed: ParsedArguments, at: 'all' | { at: number; } | { from: number; }): boolean {
  // `set -q foo[1]`: only the name at the start of a concatenation counts
  if (!site.argument.equals(node) && !site.argument.firstNamedChild?.equals(node)) return false;
  const index = parsed.plain.findIndex(arg => arg.equals(site.argument));
  if (index === -1) return false;
  if (at === 'all') return true;
  return 'at' in at ? index === at.at : index >= at.from;
}

function ruleApplies(rule: WordReferenceRule, parsed: ParsedArguments): boolean {
  if (rule.when && !hasAnyFlag(parsed, rule.when)) return false;
  if (rule.unless && hasAnyFlag(parsed, rule.unless)) return false;
  return true;
}

function matchesRule(node: SyntaxNode, site: ArgumentSite, rules: CommandWordReferenceRules, parsed: ParsedArguments, rule: WordReferenceRule): boolean {
  if (!ruleApplies(rule, parsed)) return false;
  if ('option' in rule) {
    // `sudo ls -u x`: a flag after the command being run is that command's own
    const run = rules.stopOptionsAtFirstArgument ? parsed.plain[0] : undefined;
    return (!run || site.argument.startIndex < run.startIndex) && isOptionValue(node, site, rule.option);
  }
  if ('positional' in rule) return isPositional(node, site, parsed, rule.positional);
  return rule.match(node, site.owner);
}

/**
 * `sudo env FOO=1 ls`: an argument after the command a `runsCommand` rule matched
 * belongs to that command, so re-site it as `env FOO=1 ls`.
 */
function findRunCommandSite(site: ArgumentSite, rules: CommandWordReferenceRules, parsed: ParsedArguments): ArgumentSite | null {
  for (const rule of rules.rules) {
    if (!rule.runsCommand || !('positional' in rule) || !ruleApplies(rule, parsed)) continue;
    const at = rule.positional;
    if (at === 'all' || !('at' in at)) continue;
    const run = parsed.plain[at.at];
    if (!run || site.argument.startIndex <= run.startIndex) return null;
    return {
      ...site,
      commandName: run.text,
      args: site.args.filter(arg => arg.startIndex > run.startIndex),
    };
  }
  return null;
}

function classifyArgument(node: SyntaxNode, site: ArgumentSite): ReferenceSymbolType | null {
  const rules = getWordReferenceRegistry().get(site.commandName);
  if (!rules) return null;
  if (rules.stopAtDoubleDash && isAfterDoubleDash(site)) return null;
  const parsed = parseArguments(site, rules);
  const runSite = findRunCommandSite(site, rules, parsed);
  if (runSite) return classifyArgument(node, runSite);
  return rules.rules.find(rule => matchesRule(node, site, rules, parsed, rule))?.kind ?? null;
}

/**
 * The symbol category an argument of a command can reference, from the command's
 * rules in {@link getWordReferenceRegistry}, or `null` when the argument is
 * literal text. Arguments after a command that a runner runs are classified by
 * that command's rules, to any depth (`sudo env FOO=1 ls`). Only covers
 * arguments — command names, `$var` expansions and definition names are
 * classified by `findReferenceSymbolType()`.
 */
export function findWordReferenceKind(node: SyntaxNode): ReferenceSymbolType | null {
  const site = findArgumentSite(node);
  return site ? classifyArgument(node, site) : null;
}

/** Whether `node` is (part of) an argument of a command or `function` header. */
export function isCommandArgument(node: SyntaxNode): boolean {
  return findArgumentSite(node) !== null;
}
