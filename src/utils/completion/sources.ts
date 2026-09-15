import { dirname } from 'path';
import { SymbolKind } from 'vscode-languageserver';
import { CompletionContext } from './context';
import { CompletionItemMap } from './startup-cache';
import { cloneCompletionItem, FishCompletionItem, FishCompletionItemKind, getCompletionDocumentationValue } from './types';
import { shellComplete } from './shell';
import { buildCommentCompletions } from './comment-completions';
import { execCompleteCmdArgs } from '../exec';

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
 * Text inserted for a variable name: the typed prefix in `variable` mode, a plain
 * name at a definition slot (`set NAME`), otherwise a `$` expansion (`ls $NAME`).
 */
function variableInsertText(ctx: CompletionContext, name: string): string | undefined {
  if (ctx.mode === 'variable') return ctx.variablePrefix + name;
  if (ctx.isDefinitionSlot || ctx.word.startsWith('$')) return undefined;
  return '$' + name;
}

/**
 * `$fish_complete_path` entries fish must not autoload for this request: when the
 * document is itself an autoloadable `completions/<cmd>.fish`, the copy on disk may
 * be half-written, so its directory is left out.
 */
function excludedCompletionDirs(ctx: CompletionContext): string[] {
  return ctx.doc.isAutoloadedCompletion() ? [dirname(ctx.doc.getFilePath())] : [];
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
      item.insertText = variableInsertText(ctx, symbol.name);
    } else if (symbol.kind === SymbolKind.Function) {
      item.setPriority(LOCAL_FUNCTION_PRIORITY);
    }
    return item;
  });

export const localFunctions: CompletionSource = (ctx) =>
  ctx.functions.map((symbol) => FishCompletionItem.fromSymbol(symbol).setPriority(LOCAL_FUNCTION_PRIORITY));

export const localVariables: CompletionSource = (ctx) =>
  ctx.variables.map((symbol) => {
    const item = FishCompletionItem.fromSymbol(symbol);
    const insertText = variableInsertText(ctx, symbol.name);
    if (insertText !== undefined) item.insertText = insertText;
    return item;
  });

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
      const insertText = variableInsertText(ctx, item.label);
      if (insertText !== undefined) newItem.insertText = insertText;
      return newItem;
    });

export const builtins: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('builtin'), 10);

export const mapFunctions: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('function'), 30);

/** aliases, builtins, functions and commands from the completion map */
export const mapCommands: CompletionSource = (_ctx, map) => fromMap(map.allCompletionsWithoutCommand(), 30);

/** `# @fish-lsp-*` items suggested at an empty command position */
export const commentDirectives: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('comment'), 95);

export const combinersAndPipes: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('combiner', 'pipe'), 29);

export const pipes: CompletionSource = (_ctx, map) => fromMap(map.allOfKinds('pipe'), 85);

/* ──────────────────────────────── fish ──────────────────────────────── */

/** every command name fish knows about (`complete --do-complete ' '`) */
export const shellCommandNames: CompletionSource = async (ctx, map) => {
  const results = await shellComplete(' ', { raw: true, excludeCompletionDirs: excludedCompletionDirs(ctx) });
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

  const [matches, options] = await Promise.all([
    shellComplete(input, { excludeCompletionDirs }),
    // `string split <TAB>` also lists the subcommand's own flags
    ctx.mode === 'argument' && !ctx.word && ctx.commandline.endsWith(' ')
      ? execCompleteCmdArgs(ctx.commandline.trim()).then(lines => lines
        .map((line) => {
          const [name, ...rest] = line.split('\t');
          return [name || '', rest.join('\t')] as [string, string];
        })
        .filter(([name]) => name.length > 0))
      : [] as [string, string][],
  ]);

  const items: Items = [];
  for (const [name, description] of [...matches, ...options]) {
    if (map.shouldSkipMatch(name)) continue;

    if (ctx.mode === 'command') {
      const item = map.findLabel(name);
      if (item) items.push(cloneCompletionItem(item).setPriority(1));
      continue;
    }

    // `return <TAB>` already lists status numbers from the map
    if ((ctx.command === 'return' || ctx.command === 'exit') && map.findLabel(name, 'status')) continue;

    const shellText = [ctx.commandline.slice(0, ctx.commandline.lastIndexOf(' ')), name].join(' ').trim();
    items.push(FishCompletionItem.create(name, 'argument', description, shellText).setPriority(1));
  }
  return items;
};

/** file system paths for a word containing `/` */
export const paths: CompletionSource = async (ctx) => {
  if (!ctx.word.includes('/')) return [];
  const results = await shellComplete(`__fish_complete_path ${ctx.word}`, { raw: true });
  return results.map(([name, description]) =>
    FishCompletionItem.create(name, 'path', description, [name, description].join(' ')).setPriority(1),
  );
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

/** static item kinds offered for later arguments; commands not listed get combiners and pipes */
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
  if (ctx.argIndex === 1) {
    return fromMap(map.allOfKinds(...FIRST_ARGUMENT_KINDS[command] ?? []), 25);
  }
  const kinds = LATER_ARGUMENT_KINDS[command]?.(ctx.args) ?? ['combiner', 'pipe'];
  return fromMap(map.allOfKinds(...kinds), 24);
};

/** items implied by the first character of the word: `$` variables, `/` wildcards */
export const wordPrefixItems: CompletionSource = (ctx, map) => {
  switch (ctx.word.charAt(0)) {
    case '$':
      return [
        ...fromMap(map.allOfKinds('variable'), 55),
        ...ctx.variables.map((symbol) => FishCompletionItem.fromSymbol(symbol)),
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
