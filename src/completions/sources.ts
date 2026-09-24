import { readdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join } from 'path';
import { CompletionItemKind, SymbolKind } from 'vscode-languageserver';
import { CompletionContext, openIndexTerm, tokenizeCommandline } from './context';
import { CompletionItemMap } from './startup-cache';
import { cloneCompletionItem, FishCompletionItem, FishCompletionItemKind, getCompletionDocumentationValue } from './types';
import { shellCommandNameList, shellComplete } from './shell';
import { buildCommentCompletions } from './comment-completions';
import { config } from '../config';
import { ARGPARSE_VALIDATION_VARIABLES, argparseValidationVariableDocs } from '../parsing/argparse-validation';

type Items = FishCompletionItem[];

/**
 * A completion source returns the items it contributes at `ctx`. Sources never
 * mutate `CompletionItemMap` entries: shared items are cloned before use.
 */
export type CompletionSource = (ctx: CompletionContext, map: CompletionItemMap) => Items | Promise<Items>;

function fromMap(items: Items, priority?: number): Items {
  return items.map((item) => {
    const clone = cloneCompletionItem(item);
    return priority === undefined ? clone : clone.setPriority(priority);
  });
}

/**
 * The start of the word a variable completing an index term keeps: `var[` in
 * `set var[`, `var[1..` in `set -l var[1..va`. The index reads the variable with
 * `$`, even in a definition slot. `null` outside an index.
 */
function indexTermPrefix(ctx: CompletionContext): string | null {
  if (ctx.mode !== 'argument') return null;
  const term = openIndexTerm(ctx.word);
  if (!term || term.dollars) return null;
  // `echo foo[` is a plain word, not an index
  const indexed = /^\$+\w+$/.test(term.before) || ctx.isDefinitionSlot && /^\w+$/.test(term.before);
  return indexed ? ctx.word.slice(0, ctx.word.length - term.name.length) : null;
}

/**
 * Text inserted for a variable name: the typed prefix in `variable` mode, a plain
 * name at a definition slot (`set NAME`), otherwise a `$` expansion (`ls $NAME`).
 *
 * The item replaces the whole word, so a path or an index typed before it stays in
 * front of the expansion (`cd ./` -> `cd ./$NAME`, `set var[` -> `set var[$NAME`),
 * and in the text the client filters by.
 */
function setVariableText(item: FishCompletionItem, ctx: CompletionContext, name: string): FishCompletionItem {
  const indexPrefix = indexTermPrefix(ctx);
  if (ctx.mode === 'variable') {
    item.insertText = ctx.variablePrefix + name;
  } else if (indexPrefix !== null) {
    item.insertText = `${indexPrefix}$${name}`;
    item.filterText = indexPrefix + name;
  } else if (ctx.isDefinitionSlot) {
    // `set NAME`: the label is inserted as is
  } else if (ctx.word.startsWith('$')) {
    // the item replaces the whole word, so the typed `$` goes back in front
    item.insertText = /^\$+/.exec(ctx.word)![0] + name;
  } else {
    const directory = ctx.word.slice(0, ctx.word.lastIndexOf('/') + 1);
    item.insertText = `${directory}$${name}`;
    if (directory) item.filterText = directory + name;
  }
  return item;
}

/**
 * `$fish_complete_path` entries fish must not autoload for this request: when the
 * document is itself an autoloadable `completions/<cmd>.fish`, the copy on disk may
 * be half-written, so its directory is left out.
 */
function excludedCompletionDirs(ctx: CompletionContext): string[] {
  return ctx.doc.isAutoloadedCompletion() ? [dirname(ctx.doc.getFilePath())] : [];
}

/**
 * The directory `complete --do-complete` resolves relative paths against. Fish is
 * spawned without a `cwd`, so it inherits the server process's, which is wherever
 * the client launched fish-lsp rather than the edited file's directory.
 */
function completionDir(): string {
  return process.cwd();
}

const dirCache = new Map<string, { at: number; entries: Set<string>; }>();

/**
 * Names in `dir`, so a label fish produced by falling back to file completion can be
 * told apart from a command's own argument. Cached briefly: a completion request is
 * a keystroke, and the listing is only a classifier.
 */
async function directoryEntries(dir: string): Promise<Set<string>> {
  const now = Date.now();
  const cached = dirCache.get(dir);
  if (cached && now - cached.at < 2000) return cached.entries;
  if (dirCache.size > 32) dirCache.clear();
  let entries: Set<string>;
  try {
    entries = new Set(await readdir(dir));
  } catch {
    entries = new Set();
  }
  dirCache.set(dir, { at: now, entries });
  return entries;
}

/**
 * `true` when fish produced this label by listing the filesystem. Fish leaves
 * those undescribed, so a described match (`git add` tagging `README.md` as a
 * `Modified file`) stays an argument of its command. The label is looked up in its
 * own directory (`/tmp/probe.txt`, `src/a.ts`, `~/x`), relative ones from `completionDir()`.
 */
async function isFilesystemMatch(name: string, description: string): Promise<boolean> {
  if (description) return false;
  const bare = name.replace(/\/$/, '');
  if (!bare) return false;
  const expanded = bare === '~' || bare.startsWith('~/') ? join(homedir(), bare.slice(1)) : bare;
  const full = isAbsolute(expanded) ? expanded : join(completionDir(), expanded);
  return (await directoryEntries(dirname(full))).has(basename(full));
}

/** index of the last quote that is still open, or -1 */
function findLastUnmatchedQuoteIndex(line: string): number {
  let singleQuoteIndex = -1;
  let doubleQuoteIndex = -1;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
    } else if (char === '\'' && doubleQuoteIndex === -1) {
      singleQuoteIndex = singleQuoteIndex === -1 ? index : -1;
    } else if (char === '"' && singleQuoteIndex === -1) {
      doubleQuoteIndex = doubleQuoteIndex === -1 ? index : -1;
    }
  }
  return Math.max(singleQuoteIndex, doubleQuoteIndex);
}

/* ────────────────────────────── symbols ────────────────────────────── */

/**
 * Local functions sort before keywords and the thousands of global command names at a
 * command position, so clients that cap the list (coc.nvim shows 256) still show them.
 */
const LOCAL_FUNCTION_PRIORITY = 5;

/** every local symbol (command position) */
export const localSymbols: CompletionSource = (ctx) =>
  ctx.symbols.map((symbol) => {
    const item = FishCompletionItem.fromSymbol(symbol);
    if (symbol.kind === SymbolKind.Variable) {
      setVariableText(item, ctx, symbol.name);
    } else if (symbol.kind === SymbolKind.Function) {
      item.setPriority(LOCAL_FUNCTION_PRIORITY);
    }
    return item;
  });

export const localFunctions: CompletionSource = (ctx) =>
  ctx.functions.map((symbol) => FishCompletionItem.fromSymbol(symbol).setPriority(LOCAL_FUNCTION_PRIORITY));

export const localVariables: CompletionSource = (ctx) =>
  ctx.variables.map((symbol) => setVariableText(FishCompletionItem.fromSymbol(symbol), ctx, symbol.name));

/* ─────────────────────────── completion map ─────────────────────────── */

/** variables known to fish (`set --names`, prebuilt docs) */
export const globalVariables: CompletionSource = (ctx, map) =>
  map.allOfKinds('variable')
    .filter((item) => item.label)
    .map((item) => {
      const newItem = FishCompletionItem.create(
        item.label,
        item.fishKind,
        item.detail,
        getCompletionDocumentationValue(item.documentation),
        item.examples,
      );
      return setVariableText(newItem, ctx, item.label);
    });

export const builtins: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('builtin'), 10);

export const mapFunctions: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('function'), 30);

/** aliases, builtins, functions and commands from the completion map */
export const mapCommands: CompletionSource = (_ctx, map) => fromMap(map.allCompletionsWithoutCommand(), 30);

/** `# @fish-lsp-*` items suggested at an empty command position */
export const commentDirectives: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('comment'), 95);

/**
 * Operators belong to command endings, independently of the command's argument
 * table. Only an argument slot takes them: a `variable` slot (`set -gx name `)
 * wants names, and `blocked` positions list pipes through their own route.
 */
export const commandEndOperators: CompletionSource = (ctx, map) => {
  if (ctx.mode !== 'argument' || !ctx.canEndCommand) return [];
  return fromMap(map.allOfKinds('combiner', 'pipe'), 29)
    // Negation prefixes a command; it cannot extend the preceding command.
    .filter(item => item.label !== 'not' && item.label !== '!')
    .map(item => {
      // Word combiners start a new statement, unlike the infix &&/|| operators.
      // Set this on the per-request copy so command-position items stay bare.
      if (item.label === 'and' || item.label === 'or') item.insertText = `; ${item.label}`;
      return item;
    });
};

export const pipes: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('pipe'), 85);

/**
 * A snippet whose body starts with `(` inserts a command substitution, which fish
 * only accepts as an argument: `diff (command | psub)`, never `(command | psub)`.
 */
function isArgumentSnippet(item: FishCompletionItem): boolean {
  return (item.insertText ?? '').startsWith('(');
}

/** `src/snippets/completionSnippets.json`, one item per trigger (see `static-items.ts`) */
export const snippets: CompletionSource = (ctx, map) => {
  const atCommand = ctx.mode === 'empty' || ctx.mode === 'command';
  const atArgument = ctx.mode === 'argument';
  // see `fish_lsp_enable_multiword_snippets` in fishlspEnvVariables.json
  const multiword = config.fish_lsp_enable_multiword_snippets;
  // `diff (`: a `(` just typed in an argument, which a `(` snippet can finish
  const afterParen = ctx.mode === 'empty' && ctx.line.endsWith('(')
    && tokenizeCommandline(ctx.line.slice(0, -1)).command !== null;
  return fromMap(map.allOfKinds('snippet'), 99).flatMap(item => {
    const trigger = item.filterText ?? item.label;
    // A `(` snippet only fits an argument, and an empty word would list it first
    // everywhere: offer it after a typed `(`, or once the word names it (`pro`).
    const asArgument = isArgumentSnippet(item);
    if (asArgument) {
      if (afterParen) {
        item.insertText = item.insertText!.slice(1);
        return [item];
      }
      if (!atArgument || ctx.word.length < 2 || !trigger.startsWith(ctx.word)) return [];
    }
    const fitsSlot = asArgument || atCommand;
    const prefix = multiword && !asArgument && trigger.includes(' ')
      ? ctx.snippetPrefixes.find(text => text.includes(' ') && trigger.startsWith(text))
      : undefined;
    if (prefix) {
      // Each multiword item owns its range; ordinary completions still replace
      // only ctx.word. filterText is compared against this full replacement span.
      item.setData({
        uri: ctx.doc.uri,
        position: ctx.position,
        line: ctx.line.slice(0, -prefix.length) + item.label,
        word: prefix,
        command: ctx.command ?? '',
        context: { triggerKind: ctx.triggerKind, triggerCharacter: ctx.triggerCharacter },
        replaceLength: prefix.length,
      });
      return [item];
    }
    // a multiword trigger only matches through its own range (above); unmatched,
    // it would just repeat the snippet under the same label
    return fitsSlot && !trigger.includes(' ') ? [item] : [];
  });
};

/* ──────────────────────────────── fish ──────────────────────────────── */

/** every command name fish knows about (`complete --do-complete ' '`) */
export const shellCommandNames: CompletionSource = async (ctx, map) => {
  const results = await shellCommandNameList(excludedCompletionDirs(ctx));
  return results
    .filter(([name]) => !map.shouldSkipMatch(name))
    .map(([name, description]) => FishCompletionItem.create(name, 'command', description, name).setPriority(30));
};

/**
 * `complete --do-complete` for the current commandline. At a command position
 * fish's matches are resolved to their completion-map entries (so they keep their
 * kind and documentation); after a command they are arguments of that command.
 */
export const shellMatches: CompletionSource = async (ctx, map) => {
  const excludeCompletionDirs = excludedCompletionDirs(ctx);
  // fish can't complete past an open quote in a `complete` line (`complete -c foo -x '`)
  const unmatchedQuote = !ctx.embedded && ctx.command === 'complete' ? findLastUnmatchedQuoteIndex(ctx.commandline) : -1;
  const input = unmatchedQuote === -1 ? ctx.commandline : ctx.commandline.slice(0, unmatchedQuote);

  // Complete the commandline exactly as fish's `complete --do-complete` would for the
  // requested input — nothing appended. (A bare `string split <TAB>` therefore lists no
  // flags until a `-` is typed, matching fish; it used to append ` -` to force them.)
  const matches = await shellComplete(input, { excludeCompletionDirs });

  const items: Items = [];
  for (const [name, description] of matches) {
    if (map.shouldSkipMatch(name)) continue;

    if (ctx.mode === 'command') {
      // name kinds only: snippets share labels like `if`, `set` and `for`
      const item = map.findLabel(name, 'alias', 'builtin', 'function', 'command');
      if (item) items.push(cloneCompletionItem(item).setPriority(1));
      continue;
    }

    // `return <TAB>` already lists status numbers from the map
    if ((ctx.command === 'return' || ctx.command === 'exit') && map.findLabel(name, 'status')) continue;

    const shellText = [ctx.commandline.slice(0, ctx.commandline.lastIndexOf(' ')), name].join(' ').trim();
    const isPath = name.endsWith('/') || await isFilesystemMatch(name, description);
    const item = FishCompletionItem.create(name, isPath ? 'path' : 'argument', description, shellText).setPriority(1);
    if (isPath) item.kind = name.endsWith('/') ? CompletionItemKind.Folder : CompletionItemKind.File;
    items.push(item);
  }
  return items;
};

/**
 * Paths fish completes inside `'…'` (`cat '/tm`), once something is typed. Fish is
 * given the quote, so it keeps the text literal: `'~/`, `'$HOME/` and `'/tmp/*` match
 * nothing, as in the shell.
 */
export const quotedPaths: CompletionSource = async (ctx, map) => {
  if (!ctx.word) return [];
  return (await shellMatches(ctx, map)).filter(item => item.fishKind === FishCompletionItemKind.PATH);
};

/** file system paths for a word containing `/` */
export const paths: CompletionSource = async (ctx) => {
  if (!ctx.word.includes('/')) return [];
  const results = await shellComplete(`__fish_complete_path ${ctx.word}`, { raw: true });
  return results.map(([name, description]) => {
    const item = FishCompletionItem.create(name, 'path', description, [name, description].join(' ')).setPriority(1);
    if (name.endsWith('/')) item.kind = CompletionItemKind.Folder;
    return item;
  });
};

/* ──────────────────────────── fish syntax ──────────────────────────── */

const ON_EVENT_FLAGS = ['-e', '--on-event'];
const ON_VARIABLE_FLAGS = ['-v', '--on-variable', '-V', '--inherit-variable'];

function hasFlag(args: string[], short: string, long: string): boolean {
  return args.some(arg => arg === `--${long}` || /^-[^-]/.test(arg) && arg.slice(1).includes(short));
}

/** static item kinds offered for the first argument of a command */
const FIRST_ARGUMENT_KINDS: Record<string, FishCompletionItemKind[]> = {
  function: ['event', 'variable'],
  functions: ['event', 'variable'],
  end: ['pipe'],
  printf: ['format_str', 'esc_chars'],
  set: ['variable'],
  return: ['status', 'variable'],
  exit: ['status', 'variable'],
};

/** static item kinds offered for later arguments */
const LATER_ARGUMENT_KINDS: Record<string, (args: string[]) => FishCompletionItemKind[]> = {
  return: () => ['status', 'variable'],
  exit: () => ['status', 'variable'],
  printf: () => ['variable'],
  set: () => ['variable'],
  function: (args) => {
    const previous = args.at(-1) ?? '';
    if (ON_EVENT_FLAGS.includes(previous)) return ['event'];
    if (ON_VARIABLE_FLAGS.includes(previous)) return ['variable'];
    return [];
  },
  string: (args) => hasFlag(args, 'r', 'regex') ? ['regex', 'esc_chars'] : ['esc_chars'],
};

/** fish syntax items for the current command: status codes, events, regex and printf templates, operators */
export const commandSyntaxItems: CompletionSource = (ctx, map) => {
  const command = ctx.command;
  if (!command) return [];
  const items = ctx.argIndex === 1
    ? fromMap(map.allOfKinds(...FIRST_ARGUMENT_KINDS[command] ?? []), 25)
    : fromMap(map.allOfKinds(...LATER_ARGUMENT_KINDS[command]?.(ctx.args) ?? []), 24);
  // `set var[`: a variable completes the index term
  if (indexTermPrefix(ctx) === null) return items;
  return items.map(item => item.fishKind === FishCompletionItemKind.VARIABLE ? setVariableText(item, ctx, item.label) : item);
};

/**
 * The variables an `argparse 'n/name=!…` validation script runs with (local and
 * exported), offered only inside that script. Local, so resolving keeps their docs.
 */
export const argparseValidationVariables: CompletionSource = (ctx) => {
  if (!ctx.argparseValidation) return [];
  return Object.keys(ARGPARSE_VALIDATION_VARIABLES).map(name =>
    setVariableText(
      FishCompletionItem.create(name, FishCompletionItemKind.VARIABLE, 'argparse validation', argparseValidationVariableDocs(name)!)
        .setLocal()
        .setPriority(5),
      ctx,
      name,
    ));
};

/**
 * Single-quoted text reaches the command unexpanded, so only a command that reads
 * its own syntax from it gets items: `string -r '` regexes, `printf '` templates.
 */
export const quotedSyntaxItems: CompletionSource = (ctx, map) => {
  const kinds: FishCompletionItemKind[] =
    ctx.command === 'string' && hasFlag(ctx.args, 'r', 'regex') ? ['regex', 'esc_chars']
      : ctx.command === 'printf' && ctx.argIndex === 1 ? ['format_str', 'esc_chars']
        : [];
  return fromMap(map.allOfKinds(...kinds), 25);
};

/** items implied by the first character of the word: `$` variables, `/` wildcards */
export const wordPrefixItems: CompletionSource = (ctx, map) => {
  switch (ctx.word.charAt(0)) {
    case '$':
      return [
        ...fromMap(map.allOfKinds('variable'), 55).map(item => setVariableText(item, ctx, item.label)),
        ...ctx.variables.map((symbol) => setVariableText(FishCompletionItem.fromSymbol(symbol), ctx, symbol.name)),
      ];
    case '/':
      return fromMap(map.allOfKinds('wildcard'));
    default:
      return [];
  }
};

/** shebangs, `# @fish-lsp-*` directives and diagnostic codes */
export const commentItems: CompletionSource = (ctx) =>
  buildCommentCompletions(ctx.line, ctx.position);
