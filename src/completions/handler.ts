import { CompletionItemKind, CompletionList, InsertTextFormat } from 'vscode-languageserver';
import { logger } from '../logger';
import { config } from '../config';
import { CompletionContext, CompletionLineParser, CompletionMode, CompletionRequest } from './context';
import { CompletionItemMap } from './startup-cache';
import { FishCompletionData, FishCompletionItem, FishCompletionItemKind, snippetToPlainText } from './types';
import {
  argparseValidationVariables,
  builtins,
  commandEndOperators,
  commandSyntaxItems,
  commentDirectives,
  commentItems,
  CompletionSource,
  globalVariables,
  localFunctions,
  localSymbols,
  localVariables,
  mapCommands,
  mapFunctions,
  paths,
  pipes,
  quotedPaths,
  quotedSyntaxItems,
  shellCommandNames,
  shellMatches,
  snippets,
  wordPrefixItems,
} from './sources';

type RouteKey = CompletionMode | `embedded:${CompletionMode}`;

/**
 * Which sources fill each kind of cursor position. Earlier sources win when two
 * items share a label. `embedded:*` routes apply to text inside another command's
 * quotes (`complete -n '…`, `alias foo='…`); modes without one use the plain route.
 */
const ROUTES: Partial<Record<RouteKey, CompletionSource[]>> = {
  comment: [commentItems],
  variable: [argparseValidationVariables, localVariables, globalVariables, snippets],
  blocked: [pipes],
  empty: [localSymbols, builtins, shellCommandNames, commentDirectives, mapFunctions, snippets],
  command: [paths, shellMatches, localFunctions, wordPrefixItems, snippets],
  argument: [paths, shellMatches, localVariables, commandSyntaxItems, wordPrefixItems, snippets],
  // single-quoted literal text (`echo '$v`), except a command's own syntax (`string -r '`)
  // and the paths the typed text starts (`cat '/tm`)
  quoted: [quotedSyntaxItems, quotedPaths],

  // a command position inside quotes (`complete -a '(`) takes the same names as one outside them
  'embedded:empty': [localSymbols, builtins, mapCommands, snippets],
  // fish already filters a partial name (`complete -n 'not __f`), as it does outside quotes
  'embedded:command': [paths, shellMatches, localFunctions, localVariables, snippets],
  'embedded:argument': [argparseValidationVariables, paths, shellMatches, localVariables, globalVariables, commandSyntaxItems, wordPrefixItems, snippets],
  // a `complete -a '…` word list (`jack $na`) outside any `(…)` only expands variables
  'embedded:variable': [localVariables, globalVariables],
};

export function routeFor(ctx: CompletionContext): CompletionSource[] {
  return (ctx.embedded ? ROUTES[`embedded:${ctx.mode}`] : undefined) ?? ROUTES[ctx.mode] ?? [];
}

export type CompletionClientOptions = {
  /** `capabilities.textDocument.completion.completionItem.snippetSupport` (LSP default: `false`) */
  snippetSupport: boolean;
};

export class CompletionHandler {
  static async create(items: CompletionItemMap, client: CompletionClientOptions = { snippetSupport: false }) {
    return new CompletionHandler(await CompletionLineParser.create(), items, client);
  }

  constructor(
    public readonly parser: CompletionLineParser,
    private items: CompletionItemMap,
    private client: CompletionClientOptions = { snippetSupport: false },
  ) { }

  async complete(request: CompletionRequest): Promise<CompletionList> {
    const ctx = this.parser.buildContext(request);
    logger.log('onCompletion', {
      mode: ctx.mode,
      embedded: ctx.embedded,
      commandline: ctx.commandline,
      word: ctx.word,
      command: ctx.command,
      args: ctx.args,
      argIndex: ctx.argIndex,
    });
    // a client without snippet support would insert `${1:i}` literally
    const client = { snippetSupport: this.client.snippetSupport && config.fish_lsp_enable_snippets };
    // nothing ends a command inside quotes
    const endings = ctx.mode === 'quoted' ? [] : [commandEndOperators];
    const sources = [...routeFor(ctx), ...endings].filter(source => client.snippetSupport || source !== snippets);
    const results = await Promise.all(sources.map(async (source) => {
      try {
        return await source(ctx, this.items);
      } catch (error) {
        logger.warning(`onCompletion source '${source.name}' failed`, error);
        return [];
      }
    }));
    return toCompletionList(ctx, results.flat(), client);
  }
}

/**
 * Dedupes by label (first wins), sorts by priority, attaches the replacement range
 * and the `data` that `onCompletionResolve` reads.
 */
export function toCompletionList(
  ctx: CompletionContext,
  items: FishCompletionItem[],
  client: CompletionClientOptions,
): CompletionList {
  const snippetTriggers = pickSnippetTriggers(items, ctx.word);
  const seen = new Set<string>();
  const deduped = snippetTriggers.items.filter((item) => {
    const key = dedupeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // comment items keep their authored order (shebangs, then directives)
  let unique = ctx.mode === 'comment' ? deduped : sortByPriority(deduped, ctx.word, ctx.mode === 'argument');
  const withPaths = unique.length;
  unique = unique.filter(item => keepPathItem(item, ctx.word));
  // the client caches a complete list and filters it itself, so a dropped path
  // would never come back as the word grows
  const droppedPaths = unique.length !== withPaths;

  // Clients sort by `sortText`, falling back to the label, so without it they would
  // list `&&` before `string`'s subcommands. Record this order for ties in their scoring.
  const width = String(unique.length).length;
  unique.forEach((item, index) => {
    item.sortText = String(index).padStart(width, '0');
  });

  // items are per-request copies, so adjusting them never touches the completion map
  for (const item of unique) {
    if (item.fishKind === FishCompletionItemKind.PATH) {
      item.insertText = item.filterText = escapedPath(item.label, ctx);
    }
    if (!client.snippetSupport && item.insertTextFormat === InsertTextFormat.Snippet) {
      // `\x${1:xx}` -> `\xxx`: what the template inserts with every tabstop left at its default
      item.insertText = snippetToPlainText(item.insertText ?? item.label);
      item.insertTextFormat = InsertTextFormat.PlainText;
    }
    // only a snippet whose trigger is exactly the typed word is worth selecting up front
    item.preselect = snippetMatchRank(item, ctx.word) === 0 || undefined;
  }

  const data: FishCompletionData = {
    uri: ctx.doc.uri,
    line: ctx.line,
    word: ctx.word,
    position: ctx.position,
    command: ctx.command ?? '',
    context: { triggerKind: ctx.triggerKind, triggerCharacter: ctx.triggerCharacter },
    replaceLength: ctx.replaceLength,
  };

  if (shouldAttachTextEdits(ctx)) {
    for (const item of unique) {
      if (item.textEdit) continue;
      const insertion = item.insertText ?? item.label;
      // fish returns the retained part unescaped (`foo\ ` comes back as `foo `)
      const kept = ctx.continuedWordPrefix;
      const retained = kept && [kept, unescapeWord(kept)].find(prefix => insertion.startsWith(prefix));
      if (retained) {
        item.insertText = insertion.slice(retained.length);
        item.filterText = (item.filterText ?? item.label).slice(retained.length);
      }
      item.setData({
        ...data,
        line: ctx.line.slice(0, ctx.line.length - ctx.replaceLength) + item.label,
      });
    }
  }

  // closing a single quote must ask again
  let isIncomplete = droppedPaths || snippetTriggers.incomplete || ctx.mode === 'quoted';
  if (ctx.mode !== 'comment' && ctx.mode !== 'variable' && ctx.mode !== 'quoted') {
    // After `-`, keep flags and snippets matching a whole phrase such as `set i -`.
    // At a fresh slot, typing `-` must re-request.
    if (ctx.word.startsWith('-')) {
      unique = unique.filter(item => item.label.startsWith('-')
        || item.fishKind === FishCompletionItemKind.SNIPPET && (item.data?.replaceLength ?? 0) > ctx.replaceLength);
    } else if (!ctx.word && (ctx.mode === 'argument' || unique.some(item => item.label.startsWith('-')))) {
      // Fish may only return flags once `-` is typed (e.g. `string split`).
      // An empty argument's list must not be cached as exhaustive in that case.
      isIncomplete = true;
    }
  }

  return { isIncomplete, items: unique, itemDefaults: { data } };
}

/**
 * A path item is only worth offering once the typed word narrows it. Fish falls
 * back to listing the whole directory, so a bare `cmd <TAB>` would otherwise bury
 * the command's own arguments under every neighbouring file.
 */
function keepPathItem(item: FishCompletionItem, word: string): boolean {
  if (item.fishKind !== FishCompletionItemKind.PATH) return true;
  return word !== '' && item.label.startsWith(unescapeWord(word));
}

function unescapeWord(word: string): string {
  return word.replace(/\\([^a-zA-Z0-9])/g, '$1');
}

/**
 * Fish lists paths unescaped (`foo bar/`). Keep the typed word as written, since it
 * may hold a `~` or an escape of its own, and escape the rest for its quoting.
 */
function escapedPath(label: string, ctx: CompletionContext): string {
  const rest = label.slice(unescapeWord(ctx.word).length);
  if (ctx.doubleQuoted) return ctx.word + rest.replace(/["$\\]/g, '\\$&');
  if (ctx.singleQuoted) return ctx.word + rest.replace(/['\\]/g, '\\$&');
  return ctx.word + rest
    .replace(/[ $()\\'";&|<>*[\]{}~%]/g, '\\$&')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n');
}

function shouldAttachTextEdits(ctx: CompletionContext): boolean {
  // comment items carry their own edits; a fresh slot has nothing to replace
  if (ctx.mode === 'comment') return false;
  if (ctx.mode === 'blocked') return ctx.canEndCommand;
  if (ctx.mode === 'empty' && !ctx.embedded) return false;
  // an escaped or quoted space (`cat foo\ `) still belongs to the word
  return ctx.word !== '' || !ctx.line.endsWith(' ');
}

const DEFAULT_PRIORITY = 1000;

function fallbackPriority(item: FishCompletionItem): number {
  switch (item.kind) {
    case CompletionItemKind.Property: return 1005;
    case CompletionItemKind.Class: return 10;
    case CompletionItemKind.Function: return 50;
    case CompletionItemKind.Variable: return 100;
    default: return DEFAULT_PRIORITY;
  }
}

/**
 * Snippets may share a label with a command or builtin (`if`, `set`); keep those
 * distinct while every other item dedupes by label.
 */
function dedupeKey(item: FishCompletionItem): string {
  if (item.fishKind !== FishCompletionItemKind.SNIPPET) return item.label;
  return [item.label, item.fishKind, item.insertText ?? ''].join('\0');
}

/** the word a snippet item is reached by: its name or one of its `altTrigger`s */
function snippetTrigger(item: FishCompletionItem): string {
  return item.filterText ?? item.label;
}

/**
 * Every trigger of a snippet is its own item under the snippet's label (see
 * `static-items.ts`), which a client would list as duplicates. Keep one item per
 * snippet: the trigger the typed word matches best, otherwise its name (the first).
 *
 * `incomplete` when a dropped trigger still extends the typed word but the kept one
 * doesn't lead to it (`i` keeps `if` and drops `iff`): the client only filters the
 * list it has, so it must ask again for `iff` to come back.
 */
function pickSnippetTriggers(items: FishCompletionItem[], word: string): { items: FishCompletionItem[]; incomplete: boolean; } {
  const kept = new Map<string, FishCompletionItem>();
  for (const item of items) {
    if (item.fishKind !== FishCompletionItemKind.SNIPPET) continue;
    const key = dedupeKey(item);
    const best = kept.get(key);
    if (!best || snippetMatchRank(item, word) < snippetMatchRank(best, word)) kept.set(key, item);
  }

  let incomplete = false;
  const picked = items.filter((item) => {
    if (item.fishKind !== FishCompletionItemKind.SNIPPET) return true;
    const best = kept.get(dedupeKey(item))!;
    if (item === best) return true;
    const typed = item.data?.word ?? word;
    const trigger = snippetTrigger(item);
    if (trigger.startsWith(typed) && !snippetTrigger(best).startsWith(trigger)) {
      incomplete = true;
    }
    return false;
  });
  return { items: picked, incomplete };
}

/**
 * How well a snippet's trigger matches the word being typed: 0 for an exact
 * trigger, 1 for a prefix of it, 2 for everything else (non-snippets, no word).
 */
function snippetMatchRank(item: FishCompletionItem, word: string): number {
  word = item.data?.word ?? word;
  if (item.fishKind !== FishCompletionItemKind.SNIPPET || !word) return 2;
  const trigger = snippetTrigger(item);
  if (trigger === word) return 0;
  if (trigger.startsWith(word)) return 1;
  return 2;
}

/**
 * The order of item types in an argument slot: the command's own arguments from fish
 * (`string <TAB>` -> `split`, `join`, ...), its other syntax (printf templates, status
 * numbers, paths), snippets, variables, then the pipes and combiners ending it.
 */
function argumentSlotTier(item: FishCompletionItem): number {
  switch (item.fishKind) {
    case FishCompletionItemKind.ARGUMENT: return 0;
    case FishCompletionItemKind.SNIPPET: return 2;
    case FishCompletionItemKind.VARIABLE: return 3;
    case FishCompletionItemKind.PIPE:
    case FishCompletionItemKind.COMBINER: return 4;
    default: return 1;
  }
}

/**
 * In an argument slot, by `argumentSlotTier()` first. Then snippets whose trigger
 * matches `word`, then lower priority, then alphabetical.
 */
function sortByPriority(items: FishCompletionItem[], word: string, argumentSlot: boolean): FishCompletionItem[] {
  return items.sort((a, b) => {
    if (argumentSlot) {
      const tierA = argumentSlotTier(a);
      const tierB = argumentSlotTier(b);
      if (tierA !== tierB) return tierA - tierB;
    }
    // snippets are only reachable through their trigger, so a matching one outranks
    // the flat priority every snippet shares
    const matchA = snippetMatchRank(a, word);
    const matchB = snippetMatchRank(b, word);
    if (matchA !== matchB) return matchA - matchB;

    const priorityA = a.priority ?? fallbackPriority(a);
    const priorityB = b.priority ?? fallbackPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.label.localeCompare(b.label);
  });
}
