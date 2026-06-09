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

// NOTE: This module is intentionally side-effect free — it exports only static
// data (`BuiltInList`/`reservedKeywords`) and pure predicates. It is imported
// transitively at the very top of startup, so it must NOT spawn fish.
//
// The old `findShell()` (`which fish`) plus the `functions`/`abbr --show`/`set -n`
// `spawnSync` enumerations lived here, but their exports were unused and the work
// is now done correctly (single bundled `fish -Pc`, honoring
// `config.fish_lsp_fish_path`, deferred until after config is populated) by
// `runSetupItems()` in `./completion/startup-config`.
