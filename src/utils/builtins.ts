import { spawnSync, SpawnSyncOptionsWithStringEncoding } from 'child_process';

export const BuiltInList = [
  '!',
  '.',
  ':',
  '[',
  '_',
  'abbr',
  'and',
  'argparse',
  'begin',
  'bg',
  'bind',
  'block',
  'break',
  'breakpoint',
  'builtin',
  'case',
  'cd',
  'command',
  'commandline',
  'complete',
  'contains',
  'continue',
  'count',
  'disown',
  'echo',
  'else',
  'emit',
  'end',
  'eval',
  'exec',
  'exit',
  'false',
  'fg',
  'fish_indent',
  'fish_key_reader',
  'for',
  'function',
  'functions',
  'history',
  'if',
  'jobs',
  'math',
  'not',
  'or',
  'path',
  'printf',
  'pwd',
  'random',
  'read',
  'realpath',
  'return',
  'set',
  'set_color',
  'source',
  'status',
  'string',
  'switch',
  'test',
  'time',
  'true',
  'type',
  'ulimit',
  'wait',
  'while',
];

/**
 * You can generate this list by running `builtin --names` in a fish session
 * note that '.', and ':' are removed from the list because they do not contain
 * a man-page
 */
const BuiltInSET = new Set(BuiltInList);

/**
 * check if string is one of the default fish builtin functions
 */
export function isBuiltin(word: string): boolean {
  return BuiltInSET.has(word);
}

const reservedKeywords = [
  '[',
  '_',
  'and',
  'argparse',
  'begin',
  'break',
  'builtin',
  'case',
  'command',
  'continue',
  'else',
  'end',
  'eval',
  'exec',
  'for',
  'function',
  'if',
  'not',
  'or',
  'read',
  'return',
  'set',
  'status',
  'string',
  'switch',
  'test',
  'time',
  'and',
  'while',
];
const ReservedKeywordSet = new Set(reservedKeywords);

/**
 * Reserved keywords are not allowed as function names.
 * Found on the `function` manpage.
 */
export function isReservedKeyword(word: string): boolean {
  return ReservedKeywordSet.has(word);
}

/**
 * Find the fish shell path using `which fish`
 */
export function findShell() {
  const result = spawnSync('which fish', { shell: true, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8' });
  return result.stdout.toString().trim();
}
const fishShell = findShell();

const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
  shell: fishShell,
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf-8',
};

function createFunctionNamesList() {
  const result = spawnSync('functions --names | string split -n \'\\n\'', spawnOpts);
  return result.stdout.toString().split('\n');
}
export const FunctionNamesList = createFunctionNamesList();
export function isFunction(word: string): boolean {
  return FunctionNamesList.includes(word);
}
function createFunctionEventsList() {
  const result = spawnSync('functions --handlers | string match -vr \'^Event \\w+\' | string split -n \'\\n\'', spawnOpts);
  return result.stdout.toString().split('\n');
}

/**
 * Consider using these utilities to check if a word is a event on a function/emit/trap
 */
export const EventNamesList = createFunctionEventsList();
export function isEvent(word: string): boolean {
  return EventNamesList.includes(word);
}

function createAbbrList() {
  const { stdout } = spawnSync('abbr --show', spawnOpts);
  return stdout.toString().split('\n');
}
export const AbbrList = createAbbrList();

function createGlobalVariableList() {
  const { stdout } = spawnSync('set -n', spawnOpts);
  return stdout.toString().split('\n');
}

export const GlobalVariableList = createGlobalVariableList();

/**
 * TO get the list of commands with potential subcommands, you can use:
 *
 * >_ cd /usr/share/fish/completions/
 * >_ for i in (rg -e '-a' -l); echo (string split -f 1 '.fish' -m1 $i);end
 *
 * example commands with potential subcommands
 *  • string split ...
 *  • killall node
 *  • man vim
 *  • command fish
 *
 * useful when checking the current Command for documentation/completion
 * suggestions. If a match is hit, check one more node back, and if it is
 * not a command, stop searching backwards.
 */

// List of global aliases removed (check history if needed in future)
