/**
 * Generates `src/parsing/builtins` definitions for a fish command, by asking fish itself.
 *
 * Usage:
 *   yarn -s generate:builtin <command> [--no-combos] [--out <file>] [--fish <path>] [--jobs <n>]
 *
 *   yarn -s generate:builtin path
 *   yarn -s generate:builtin set --out src/parsing/builtins/set.ts
 *   yarn -s generate:builtin --completions | source
 *
 * How it works:
 *   1. subcommands: candidates come from `complete -C '<cmd> '`, and are only kept when
 *      fish reports errors for them as `<cmd> <subcmd>: ...` (so `set foo` isn't a subcommand).
 *   2. flags: candidates come from `complete -C '<cmd> <subcmd> -'` plus every `-[a-zA-Z0-9]`.
 *      Each candidate is run alone, `unknown option` drops it, `option requires an argument`
 *      marks it as taking a value. Short and long flags are paired when their completion
 *      descriptions match (fish completions are the only place that relationship is visible).
 *   3. combos: every pair of flags is run together, and pairs that fish rejects with an
 *      "invalid option combination" style error are emitted as `conflictsWith()`.
 *
 * Every probe really executes the command, inside a throwaway HOME/XDG/cwd sandbox.
 *
 * Regenerating into an existing `--out` file keeps the hand-written parts of it:
 *   - chained calls (`.inGroup('scope')` on options, `.withRules(...)` on commands)
 *   - everything between the `// @gen-builtin:keep-start` and `// @gen-builtin:keep-end` markers
 *   - `.setHardcoded()` (or add it with `--hardcoded`)
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type FishResult = { status: number; stdout: string; stderr: string; };

type FlagInfo = {
  short?: string;
  long?: string;
  takesValue: boolean;
  description?: string;
  /** a value fish accepts for this flag, used when probing combinations */
  sampleValue?: string;
};

type SubcmdInfo = {
  name: string;
  flags: FlagInfo[];
  conflicts: Array<[FlagInfo, FlagInfo]>;
};

const UNKNOWN_OPTION_RE = /unknown option/i;
const REQUIRES_ARG_RE = /option requires an argument/i;
const COMBO_RE = /invalid option combination|mutually exclusive|cannot be used together|can be only one of/i;
const BAD_VALUE_RE = /invalid|should be|must be|not a valid|expected/i;
const GENERIC_VALUES = ['1', 'x', 'file', 'a', ','];

/*
 * CLI args
 */
type CliFlag = {
  short?: string;
  long: string;
  /** fish `complete` args for the flag's value, when it takes one */
  value?: string;
  description: string;
};

const CLI_FLAGS: CliFlag[] = [
  { long: 'out', value: '-r -F', description: 'Write to a file, keeping its hand-written chained calls' },
  { long: 'no-combos', description: 'Skip probing which flags can\'t be combined' },
  { long: 'hardcoded', description: 'Add `.setHardcoded()` to the generated commands' },
  { long: 'fish', value: '-r -F -a "(command -sa fish)"', description: 'fish binary to probe with' },
  { long: 'jobs', value: '-x -a "(seq 1 16)"', description: 'Number of fish processes to run at once' },
  { short: 'c', long: 'completions', description: 'Print fish completions for this script' },
  { short: 'h', long: 'help', description: 'Show help message' },
];
const VALUE_FLAGS = CLI_FLAGS.filter(f => f.value).map(f => `--${f.long}`);

function printHelp() {
  const flagLines = CLI_FLAGS.map(f => {
    const names = [f.short && `-${f.short}`, `--${f.long}${f.value ? ' <value>' : ''}`].filter(Boolean).join(', ');
    return `  ${names.padEnd(24)} ${f.description}`;
  });
  console.log([
    'Generate `src/parsing/builtins` definitions for a fish command, by asking fish itself.',
    '',
    'Usage:',
    '  yarn -s generate:builtin <command> [options]',
    '  tsx scripts/gen-builtin.ts <command> [options]',
    '',
    'Options:',
    ...flagLines,
    '',
    'Examples:',
    '  yarn -s generate:builtin path',
    '  yarn -s generate:builtin set --out src/parsing/builtins/set.ts',
    '  yarn -s generate:builtin --completions | source',
  ].join('\n'));
}

/**
 * Completions for both `yarn generate:builtin ...` and `tsx scripts/gen-builtin.ts ...`
 */
function printCompletions() {
  const flagCompletions = CLI_FLAGS.flatMap(f => {
    const names = [f.short && `-s ${f.short}`, `-l ${f.long}`].filter(Boolean).join(' ');
    return ['yarn', 'tsx'].map(c =>
      `complete -c ${c} -n __gen_builtin_using ${names} ${f.value ?? '-f'} -d ${JSON.stringify(f.description)}`);
  });
  console.log(`# fish completions for scripts/gen-builtin.ts
# source them with: yarn -s generate:builtin --completions | source

# prints the tokens after \`generate:builtin\` or \`*gen-builtin.ts\`, fails if neither was used
function __gen_builtin_args
    set -l found 0
    for token in (commandline -xpc)
        if test $found = 1
            echo -- $token
        else if string match -qr -- '^generate:builtin$|gen-builtin\\.ts$' $token
            set found 1
        end
    end
    test $found = 1
end

function __gen_builtin_using
    __gen_builtin_args >/dev/null
end

# true until the <command> to generate has been given
function __gen_builtin_needs_command
    set -l args (__gen_builtin_args); or return 1
    set -l skip_value 0
    for arg in $args
        if test $skip_value = 1
            set skip_value 0
            continue
        end
        switch $arg
            case ${VALUE_FLAGS.join(' ')}
                set skip_value 1
            case '-*'
            case '*'
                return 1
        end
    end
    return 0
end

complete -c yarn -f -n __fish_use_subcommand -a generate:builtin -d 'Generate a builtin command definition from fish'
${['yarn', 'tsx'].map(c => `complete -c ${c} -n __gen_builtin_using -f
complete -c ${c} -n __gen_builtin_needs_command -f -a '(builtin -n)' -d 'builtin'
complete -c ${c} -n __gen_builtin_needs_command -f -a '(functions -n)' -d 'function'`).join('\n')}
${flagCompletions.join('\n')}`);
}

const argv = process.argv.slice(2);
if (argv.includes('-c') || argv.includes('--completions')) {
  printCompletions();
  process.exit(0);
}
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  printHelp();
  process.exit(argv.length === 0 ? 1 : 0);
}
const getArg = (name: string) => {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
};
const cmd = argv.find((arg, idx) => !arg.startsWith('-') && !VALUE_FLAGS.includes(argv[idx - 1]!))!;
const fishBin = getArg('--fish') ?? 'fish';
const outFile = getArg('--out');
const jobs = Number(getArg('--jobs') ?? os.cpus().length);
const checkCombos = !argv.includes('--no-combos');
const setHardcoded = argv.includes('--hardcoded');

/*
 * sandboxed fish runner
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-gen-builtin-'));
const sandboxEnv = {
  PATH: process.env.PATH,
  HOME: sandbox,
  XDG_CONFIG_HOME: path.join(sandbox, 'config'),
  XDG_DATA_HOME: path.join(sandbox, 'data'),
  XDG_CACHE_HOME: path.join(sandbox, 'cache'),
  TERM: 'dumb',
};

const quote = (str: string) => `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function runFish(script: string): Promise<FishResult> {
  return new Promise((resolve) => {
    const child = execFile(
      fishBin,
      ['--no-config', '--private', '-C', 'function __fish_print_help; return 0; end', '-c', script],
      { cwd: sandbox, env: sandboxEnv, timeout: 5000 },
      (error, stdout, stderr) => {
        const status = typeof error?.code === 'number' ? error.code : error ? -1 : 0;
        resolve({ status, stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}

/** runs `<tokens...>` with every token quoted, so nothing is expanded */
const runCmd = (...tokens: string[]) => runFish(tokens.map(quote).join(' '));

async function completions(commandline: string): Promise<Array<{ token: string; description?: string; }>> {
  const { stdout } = await runFish(`complete -C ${quote(commandline)}`);
  return stdout.split('\n').filter(Boolean).map(line => {
    const [token, description] = line.split('\t');
    return { token: token!, description };
  });
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  return results;
}

/*
 * discovery
 */
async function findSubcmds(): Promise<string[]> {
  const candidates = (await completions(`${cmd} `))
    .map(c => c.token)
    .filter(token => /^[a-z][\w-]*$/.test(token));
  const unique = Array.from(new Set(candidates));
  const isSubcmd = await pool(unique, async (sub) => {
    const { stderr } = await runCmd(cmd, sub, '--fish-gen-builtin-bogus');
    return stderr.includes(`${cmd} ${sub}:`);
  });
  return unique.filter((_, idx) => isSubcmd[idx]);
}

const isShortFlag = (flag: string) => /^-[^-]$/.test(flag);

/**
 * fish accepts an abbreviated long flag after a single dash when that character isn't a
 * short flag itself (`set -s` == `set -sho` == `set --show`), so `-s` isn't a real short flag.
 *
 * A doubled short flag tells them apart:
 *   - a real switch `-gg` parses as `-g -g`, and a real value flag `-ss` as `-s` with value `s`
 *   - an abbreviation `-ss` parses as `--ss`, which isn't a prefix of any long flag
 */
async function isLongAbbreviation(prefix: string[], flag: string): Promise<boolean> {
  const { stderr } = await runCmd(...prefix, flag + flag.slice(1));
  return UNKNOWN_OPTION_RE.test(stderr);
}

async function probeFlag(prefix: string[], flag: string): Promise<'unknown' | 'switch' | 'value'> {
  const { stderr } = await runCmd(...prefix, flag);
  if (UNKNOWN_OPTION_RE.test(stderr)) return 'unknown';
  if (isShortFlag(flag) && await isLongAbbreviation(prefix, flag)) return 'unknown';
  if (!REQUIRES_ARG_RE.test(stderr)) return 'switch';
  // `set -e` reports `--erase: option requires an argument` for its missing variable name.
  // A flag that really takes a value consumes the next token, even when it looks like a flag.
  const consumed = await runCmd(...prefix, flag, '--fish-gen-builtin-bogus');
  return UNKNOWN_OPTION_RE.test(consumed.stderr) ? 'switch' : 'value';
}

async function findSampleValue(prefix: string[], flag: string): Promise<string> {
  const suggested = (await completions(`${[...prefix, flag].join(' ')} `))
    .map(c => c.token)
    .filter(token => token && !token.startsWith('-'))
    .slice(0, 5);
  for (const value of [...suggested, ...GENERIC_VALUES]) {
    const { status, stderr } = await runCmd(...prefix, flag, value);
    if (status !== 2 || !BAD_VALUE_RE.test(stderr)) return value;
  }
  return 'x';
}

async function findFlags(prefix: string[]): Promise<FlagInfo[]> {
  const described = [
    ...await completions(`${prefix.join(' ')} -`),
    ...await completions(`${prefix.join(' ')} --`),
  ].filter(c => /^--?[\w-]+$/.test(c.token));

  const descriptions = new Map<string, string | undefined>();
  for (const { token, description } of described) {
    if (!descriptions.has(token)) descriptions.set(token, description);
  }
  const bruteForce = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map(c => `-${c}`);
  const candidates = Array.from(new Set([...descriptions.keys(), ...bruteForce]));

  const kinds = await pool(candidates, flag => probeFlag(prefix, flag));
  const valid = candidates
    .map((flag, idx) => ({ flag, kind: kinds[idx]!, description: descriptions.get(flag) }))
    .filter(f => f.kind !== 'unknown');

  // pair `-x` with `--long` when exactly one of each shares a description and value-kind
  const byDescription = new Map<string, typeof valid>();
  for (const f of valid) {
    if (!f.description) continue;
    byDescription.set(f.description, [...byDescription.get(f.description) ?? [], f]);
  }
  // `string pad` completes `-r` for both `--right` and `--center`, so don't trust those
  const isAmbiguous = (flag: string) => new Set(described.filter(c => c.token === flag).map(c => c.description)).size > 1;

  const flags: FlagInfo[] = [];
  const used = new Set<string>();
  for (const [description, group] of byDescription) {
    const shorts = group.filter(f => !f.flag.startsWith('--'));
    const longs = group.filter(f => f.flag.startsWith('--'));
    if (shorts.length === 1 && longs.length === 1 && shorts[0]!.kind === longs[0]!.kind && !isAmbiguous(shorts[0]!.flag)) {
      flags.push({ short: shorts[0]!.flag, long: longs[0]!.flag, takesValue: shorts[0]!.kind === 'value', description });
      used.add(shorts[0]!.flag).add(longs[0]!.flag);
    }
  }
  for (const f of valid) {
    if (used.has(f.flag)) continue;
    used.add(f.flag);
    const isLong = f.flag.startsWith('--');
    flags.push({
      short: isLong ? undefined : f.flag,
      long: isLong ? f.flag : undefined,
      takesValue: f.kind === 'value',
      description: f.description,
    });
  }

  for (const flag of flags.filter(f => f.takesValue)) {
    flag.sampleValue = await findSampleValue(prefix, (flag.long ?? flag.short)!);
  }
  return flags;
}

const flagTokens = (flag: FlagInfo) => {
  const name = (flag.long ?? flag.short)!;
  return flag.takesValue ? [name, flag.sampleValue ?? 'x'] : [name];
};

/**
 * Some commands check their positional arguments before the option combination
 * (`string match -e -n` reports `missing argument`), others reject extra arguments,
 * so each combination is run both with and without placeholder arguments.
 */
async function isComboError(prefix: string[], flagArgs: string[]): Promise<boolean> {
  for (const positional of [['x', 'x'], []]) {
    const { stderr } = await runCmd(...prefix, ...flagArgs, ...positional);
    if (COMBO_RE.test(stderr)) return true;
  }
  return false;
}

async function findConflicts(prefix: string[], flags: FlagInfo[]): Promise<Array<[FlagInfo, FlagInfo]>> {
  const alone = await pool(flags, f => isComboError(prefix, flagTokens(f)));
  const usable = flags.filter((_, idx) => !alone[idx]);
  const pairs: Array<[FlagInfo, FlagInfo]> = [];
  usable.forEach((a, idx) => usable.slice(idx + 1).forEach(b => pairs.push([a, b])));
  const results = await pool(pairs, ([a, b]) => isComboError(prefix, [...flagTokens(a), ...flagTokens(b)]));
  return pairs.filter((_, idx) => results[idx]);
}

/*
 * typescript output
 */
const camelCase = (str: string) => str.replace(/[-_]+(\w)/g, (_, c: string) => c.toUpperCase());
const flagKey = (flag: FlagInfo) => flag.long ? camelCase(flag.long.replace(/^--/, '')) : `short_${flag.short!.slice(1)}`;
const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/*
 * preserving hand-written additions from a previously generated `--out` file
 *
 * Any chained call the generator doesn't write itself is kept:
 *   - on options, matched by their flags:   `Option.create('-l', '--local').inGroup('scope')`
 *   - on commands, matched by variable name: `BaseCmd.create('set', ...Object.values(setFlags)).withExclusiveGroups('scope')`
 */
const GENERATED_CALLS = new Set(['withValue', 'withOptionalValue', 'withMultipleValues', 'withDescription', 'setHardcoded']);
const KEEP_START = '// @gen-builtin:keep-start';
const KEEP_END = '// @gen-builtin:keep-end';
const QUOTED = String.raw`'(?:[^'\\]|\\.)*'`;
const CALL = String.raw`\.(\w+)\(((?:${QUOTED}|[^)'])*)\)`;
const CHAIN = String.raw`((?:\s*${CALL})*)`;

type Preserved = {
  /** `${varName} ${flags}` -> chained calls, e.g. `.inGroup('scope')` */
  options: Map<string, string>;
  /** varName -> chained calls on its `BaseCmd.create()` */
  commands: Map<string, string>;
  /** hand-written code between the keep markers (e.g., `FlagRule` callbacks), copied as is */
  keepBlock?: string;
  /** the old output used `.setHardcoded()` */
  hardcoded: boolean;
};

const unquote = (s: string) => s.slice(1, -1).replace(/\\(.)/g, '$1');
const quotedArgs = (s: string) => (s.match(new RegExp(QUOTED, 'g')) ?? []).map(unquote);
const flagsId = (flags: string[]) => [...flags].sort().join(',');

/** only the chained calls that the generator doesn't write itself */
function keptCalls(chain: string): string {
  return Array.from(chain.matchAll(new RegExp(CALL, 'g')))
    .filter(([, name]) => !GENERATED_CALLS.has(name!))
    .map(([call]) => call!.trim())
    .join('');
}

function readPreserved(file: string | undefined): Preserved {
  const preserved: Preserved = { options: new Map(), commands: new Map(), hardcoded: false };
  if (!file || !fs.existsSync(file)) return preserved;
  const source = fs.readFileSync(file, 'utf8');

  const start = source.indexOf(KEEP_START);
  const end = source.indexOf(KEEP_END);
  if (start !== -1 && end > start) {
    preserved.keepBlock = source.slice(start, end + KEEP_END.length);
  }
  preserved.hardcoded = /\.setHardcoded\(\)/.test(source);

  for (const [, varName, body] of source.matchAll(/const (\w+) = \{([\s\S]*?)\n\};/g)) {
    const optionRe = new RegExp(String.raw`Option\.(?:create|long|short)\(([^)]*)\)${CHAIN}`, 'g');
    for (const [, args, chain] of body!.matchAll(optionRe)) {
      const kept = keptCalls(chain!);
      if (kept) preserved.options.set(`${varName} ${flagsId(quotedArgs(args!))}`, kept);
    }
  }
  const commandRe = new RegExp(String.raw`BaseCmd\.create\(${QUOTED}, \.\.\.Object\.values\((\w+)\)\)${CHAIN}`, 'g');
  for (const [, varName, chain] of source.matchAll(commandRe)) {
    const kept = keptCalls(chain!);
    if (kept) preserved.commands.set(varName!, kept);
  }
  return preserved;
}

/** names passed to a kept call, e.g. `.inGroup('scope')` -> ['scope'] */
function callArgs(chain: string | undefined, method: string): string[] {
  if (!chain) return [];
  return Array.from(chain.matchAll(new RegExp(CALL, 'g')))
    .filter(([, name]) => name === method)
    .flatMap(([, , args]) => quotedArgs(args!));
}

function optionExpr(flag: FlagInfo, kept = '') {
  let expr = flag.short && flag.long
    ? `Option.create(${str(flag.short)}, ${str(flag.long)})`
    : flag.long ? `Option.long(${str(flag.long)})` : `Option.short(${str(flag.short!)})`;
  if (flag.takesValue) expr += '.withValue()';
  if (flag.description) expr += `.withDescription(${str(flag.description.replace(/\s+/g, ' '))})`;
  return expr + kept;
}

function emitFlagObject(varName: string, sub: SubcmdInfo, label: string, preserved: Preserved): string[] {
  const lines = [`// \`${label}\``, `const ${varName} = {`];
  const keptFor = (flag: FlagInfo) => preserved.options.get(`${varName} ${flagsId([flag.short, flag.long].filter(Boolean) as string[])}`);
  for (const flag of sub.flags) {
    lines.push(`  ${flagKey(flag)}: ${optionExpr(flag, keptFor(flag))},`);
  }
  lines.push('};');

  // pairs already covered by a kept `.withExclusiveGroups()` don't need a `conflictsWith()`
  const exclusiveGroups = callArgs(preserved.commands.get(varName), 'withExclusiveGroups');
  const inSameGroup = (a: FlagInfo, b: FlagInfo) => {
    const groupsA = callArgs(keptFor(a), 'inGroup');
    const groupsB = callArgs(keptFor(b), 'inGroup');
    return exclusiveGroups.some(group => groupsA.includes(group) && groupsB.includes(group));
  };

  const grouped = new Map<FlagInfo, FlagInfo[]>();
  for (const [a, b] of sub.conflicts) {
    if (inSameGroup(a, b)) continue;
    grouped.set(a, [...grouped.get(a) ?? [], b]);
  }
  for (const [a, others] of grouped) {
    lines.push(`${varName}.${flagKey(a)}.conflictsWith(${others.map(o => `${varName}.${flagKey(o)}`).join(', ')});`);
  }

  const generatedIds = new Set(sub.flags.map(f => `${varName} ${flagsId([f.short, f.long].filter(Boolean) as string[])}`));
  for (const [id, kept] of preserved.options) {
    if (id.startsWith(`${varName} `) && !generatedIds.has(id)) {
      process.stderr.write(`warning: \`${id}\` had \`${kept}\` but fish no longer reports that flag, dropped it\n`);
    }
  }
  return lines;
}

/** `./util` imports for the output, including the ones a kept block uses */
function utilImports(isBase: boolean, keepBlock = ''): string[] {
  const names = isBase ? ['BaseCmd'] : ['BaseCmd', 'BuiltinCommandWithSubcmds'];
  for (const name of ['FlagRule', 'Rules']) {
    if (new RegExp(String.raw`\b${name}\b`).test(keepBlock)) names.push(name);
  }
  return names;
}

function emitTypescript(subcmds: SubcmdInfo[], fishVersion: string, preserved: Preserved): string {
  const exportName = `${camelCase(cmd)}Builtin`;
  const isBase = subcmds.length === 1 && subcmds[0]!.name === '';
  const lines = [
    `// Generated by \`tsx scripts/gen-builtin.ts ${cmd}\` from ${fishVersion}`,
    '// Short/long pairing comes from fish completion descriptions, double check any standalone short flags.',
    '// Chained calls added by hand (`.inGroup()`, `.withRules()`) and code between the',
    `// \`${KEEP_START}\`/\`${KEEP_END}\` markers are kept when regenerating with \`--out <this file>\`.`,
    "import { Option } from '../options';",
    `import { ${utilImports(isBase, preserved.keepBlock).join(', ')} } from './util';`,
    '',
  ];
  const varNames = subcmds.map(sub => camelCase(`${cmd}-${sub.name || 'flags'}`));
  subcmds.forEach((sub, idx) => {
    lines.push(...emitFlagObject(varNames[idx]!, sub, [cmd, sub.name].filter(Boolean).join(' '), preserved), '');
  });
  if (preserved.keepBlock) lines.push(preserved.keepBlock, '');
  const hardcoded = setHardcoded || preserved.hardcoded ? '.setHardcoded()' : '';
  const commandExpr = (name: string, varName: string) =>
    `BaseCmd.create(${str(name)}, ...Object.values(${varName}))${hardcoded}${preserved.commands.get(varName) ?? ''}`;
  if (isBase) {
    lines.push(`export const ${exportName} = ${commandExpr(cmd, varNames[0]!)};`);
  } else {
    lines.push(`export const ${exportName} = BuiltinCommandWithSubcmds.create(${str(cmd)},`);
    subcmds.forEach((sub, idx) => lines.push(`  ${commandExpr(sub.name, varNames[idx]!)},`));
    lines.push(');');
  }
  return lines.join('\n') + '\n';
}

/*
 * main
 */
async function main() {
  const fishVersion = (await runFish('echo $version')).stdout.trim();
  const probe = await runFish(`type -q ${quote(cmd)}`);
  if (probe.status !== 0) {
    throw new Error(`fish doesn't know a command named '${cmd}'`);
  }

  const subcmdNames = await findSubcmds();
  const targets = subcmdNames.length > 0 ? subcmdNames : [''];
  const subcmds: SubcmdInfo[] = [];
  for (const name of targets) {
    const prefix = name ? [cmd, name] : [cmd];
    process.stderr.write(`probing \`${prefix.join(' ')}\`...\n`);
    const flags = await findFlags(prefix);
    const conflicts = checkCombos ? await findConflicts(prefix, flags) : [];
    subcmds.push({ name, flags, conflicts });
  }

  const output = emitTypescript(subcmds, `fish ${fishVersion}`, readPreserved(outFile));
  if (outFile) {
    fs.writeFileSync(outFile, output);
    process.stderr.write(`wrote ${outFile}\n`);
  } else {
    process.stdout.write(output);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(sandbox, { recursive: true, force: true }));
