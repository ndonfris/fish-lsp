import { CompletionItemKind, CompletionList, InsertTextFormat } from 'vscode-languageserver';
import { logger } from '../../logger';
import { CompletionContext, CompletionLineParser, CompletionMode, CompletionRequest } from './context';
import { CompletionItemMap } from './startup-cache';
import { FishCompletionData, FishCompletionItem, FishCompletionItemKind, snippetToPlainText } from './types';
import {
  builtins,
  combinersAndPipes,
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
  variable: [localVariables, globalVariables],
  blocked: [pipes],
  empty: [localSymbols, builtins, shellCommandNames, commentDirectives, mapFunctions, snippets],
  command: [paths, shellMatches, localFunctions, wordPrefixItems, snippets],
  argument: [paths, shellMatches, localVariables, commandSyntaxItems, wordPrefixItems],

  // a command position inside quotes (`complete -a '(`) takes the same names as one outside them
  'embedded:empty': [localSymbols, builtins, mapCommands, snippets],
  // fish already filters a partial name (`complete -n 'not __f`), as it does outside quotes
  'embedded:command': [paths, shellMatches, localFunctions, localVariables, snippets],
  'embedded:argument': [paths, shellMatches, localVariables, globalVariables, commandSyntaxItems, wordPrefixItems, combinersAndPipes],
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
    const sources = routeFor(ctx).filter(source => this.client.snippetSupport || source !== snippets);
    const results = await Promise.all(sources.map(async (source) => {
      try {
        return await source(ctx, this.items);
      } catch (error) {
        logger.warning(`onCompletion source '${source.name}' failed`, error);
        return [];
      }
    }));
    return toCompletionList(ctx, results.flat(), this.client);
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
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const key = dedupeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // comment items keep their authored order (shebangs, then directives)
  let unique = ctx.mode === 'comment' ? deduped : sortByPriority(deduped, ctx.word);

  // items are per-request copies, so adjusting them never touches the completion map
  for (const item of unique) {
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
      item.setData({
        ...data,
        line: ctx.line.slice(0, ctx.line.length - ctx.word.length) + item.label,
      });
    }
  }

  let isIncomplete = false;
  if (ctx.mode !== 'comment' && ctx.mode !== 'variable') {
    // after `-` only flags make sense; at a fresh slot, typing `-` must re-request
    if (ctx.word.startsWith('-')) {
      unique = unique.filter(item => item.label.startsWith('-'));
    } else if (!ctx.word && unique.some(item => item.label.startsWith('-'))) {
      isIncomplete = true;
    }
  }

  return { isIncomplete, items: unique, itemDefaults: { data } };
}

function shouldAttachTextEdits(ctx: CompletionContext): boolean {
  // comment items carry their own edits; a fresh slot has nothing to replace
  if (ctx.mode === 'comment' || ctx.mode === 'blocked') return false;
  if (ctx.mode === 'empty' && !ctx.embedded) return false;
  return !ctx.line.endsWith(' ');
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
 * Snippets may share a label with a command or builtin (`if`, `set`), and every
 * trigger of one snippet shares its label and body, differing only in `filterText`.
 * Keep those distinct while every other item dedupes by label.
 */
function dedupeKey(item: FishCompletionItem): string {
  if (item.fishKind !== FishCompletionItemKind.SNIPPET) return item.label;
  return [item.label, item.fishKind, item.insertText ?? '', item.filterText ?? ''].join('\0');
}

/**
 * How well a snippet's trigger matches the word being typed: 0 for an exact
 * trigger, 1 for a prefix of it, 2 for everything else (non-snippets, no word).
 */
function snippetMatchRank(item: FishCompletionItem, word: string): number {
  if (item.fishKind !== FishCompletionItemKind.SNIPPET || !word) return 2;
  const trigger = item.filterText ?? item.label;
  if (trigger === word) return 0;
  if (trigger.startsWith(word)) return 1;
  return 2;
}

/** snippets whose trigger matches `word` first, then lower priority, then alphabetical */
function sortByPriority(items: FishCompletionItem[], word: string): FishCompletionItem[] {
  return items.sort((a, b) => {
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
