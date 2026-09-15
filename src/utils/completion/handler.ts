import { CompletionItemKind, CompletionList } from 'vscode-languageserver';
import { logger } from '../../logger';
import { CompletionContext, CompletionLineParser, CompletionMode, CompletionRequest } from './context';
import { CompletionItemMap } from './startup-cache';
import { FishCompletionData, FishCompletionItem } from './types';
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
  empty: [localSymbols, builtins, shellCommandNames, commentDirectives, mapFunctions],
  command: [paths, shellMatches, localFunctions, wordPrefixItems],
  argument: [paths, shellMatches, localVariables, commandSyntaxItems, wordPrefixItems],

  // a command position inside quotes (`complete -a '(`) takes the same names as one outside them
  'embedded:empty': [localSymbols, builtins, mapCommands],
  // fish already filters a partial name (`complete -n 'not __f`), as it does outside quotes
  'embedded:command': [paths, shellMatches, localFunctions, localVariables],
  'embedded:argument': [paths, shellMatches, localVariables, globalVariables, commandSyntaxItems, wordPrefixItems, combinersAndPipes],
};

export function routeFor(ctx: CompletionContext): CompletionSource[] {
  return (ctx.embedded ? ROUTES[`embedded:${ctx.mode}`] : undefined) ?? ROUTES[ctx.mode] ?? [];
}

export class CompletionHandler {
  static async create(items: CompletionItemMap) {
    return new CompletionHandler(await CompletionLineParser.create(), items);
  }

  constructor(
    public readonly parser: CompletionLineParser,
    private items: CompletionItemMap,
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
    const results = await Promise.all(routeFor(ctx).map(async (source) => {
      try {
        return await source(ctx, this.items);
      } catch (error) {
        logger.warning(`onCompletion source '${source.name}' failed`, error);
        return [];
      }
    }));
    return toCompletionList(ctx, results.flat());
  }
}

/**
 * Dedupes by label (first wins), sorts by priority, attaches the replacement range
 * and the `data` that `onCompletionResolve` reads.
 */
export function toCompletionList(ctx: CompletionContext, items: FishCompletionItem[]): CompletionList {
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
  // comment items keep their authored order (shebangs, then directives)
  let unique = ctx.mode === 'comment' ? deduped : sortByPriority(deduped);

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

/** lower priority first, then alphabetical */
function sortByPriority(items: FishCompletionItem[]): FishCompletionItem[] {
  return items.sort((a, b) => {
    const priorityA = a.priority ?? fallbackPriority(a);
    const priorityB = b.priority ?? fallbackPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.label.localeCompare(b.label);
  });
}
