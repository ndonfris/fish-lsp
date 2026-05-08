import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { getCommandDocString, getDocumentationResolver } from './documentation';
import { execSubCommandCompletions } from '../exec';
import {
  FishCompletionItem,
  FishCompletionItemKind,
  getCompletionDocumentationValue,
  toCompletionMarkdownDocumentation,
} from './types';
import { CompletionItemMap } from './startup-cache';
import { subcommandCache } from '../subcommand-cache';

type ResolveCompletionMap = Pick<CompletionItemMap, 'findLabel'>;

export async function resolveCompletionItemDocumentation(
  item: CompletionItem,
  completionMap: ResolveCompletionMap,
): Promise<CompletionItem> {
  const fishItem = item as FishCompletionItem;
  const fromData = (fishItem.data ?? {}) as FishCompletionItem['data'] & {
    fishKind?: FishCompletionItemKind;
    detail?: string;
    documentation?: FishCompletionItem['documentation'];
    local?: boolean;
    useDocAsDetail?: boolean;
  };
  const detail = (fishItem.detail || fromData.detail || '').trim().toLowerCase();
  const label = typeof fishItem.label === 'string' ? fishItem.label : fishItem.label || '';
  const parentCommand = typeof fromData.command === 'string' ? fromData.command.trim() : '';
  const hasExplicitKind =
    detail === 'command'
    || detail === 'function'
    || detail === 'alias'
    || detail === 'builtin'
    || detail === 'variable'
    || detail === 'event'
    || detail === 'event handler'
    || !!fishItem.fishKind && fishItem.fishKind !== FishCompletionItemKind.ARGUMENT && fishItem.fishKind !== FishCompletionItemKind.EMPTY;

  if (
    parentCommand
    && parentCommand !== 'complete'
    && label
    && parentCommand !== label
    && !label.startsWith('-')
    && !hasExplicitKind
    && await isRealSubcommand(parentCommand, label)
  ) {
    const subcommandDoc = await getCommandDocString(parentCommand, label);
    if (subcommandDoc) {
      item.documentation = toCompletionMarkdownDocumentation(subcommandDoc);
      return item;
    }
  }

  const kinds = inferCompletionKinds(fishItem, fromData, detail);
  const mapItem = label
    ? completionMap.findLabel(label, ...Array.from(new Set(kinds)))
    : undefined;

  const hasIncomingDocs = getCompletionDocumentationValue(fishItem.documentation).trim().length > 0;
  const resolvedItem = {
    ...mapItem,
    ...fishItem,
    fishKind: fishItem.fishKind || fromData.fishKind || mapItem?.fishKind || kinds[0] || FishCompletionItemKind.EMPTY,
    detail: fishItem.detail || fromData.detail || mapItem?.detail || '',
    documentation: hasIncomingDocs ? fishItem.documentation : fromData.documentation || mapItem?.documentation,
    local: fishItem.local ?? fromData.local ?? mapItem?.local ?? false,
    useDocAsDetail: fishItem.useDocAsDetail ?? fromData.useDocAsDetail ?? mapItem?.useDocAsDetail ?? false,
  } as FishCompletionItem;

  const resolvedLabel = typeof resolvedItem.label === 'string' ? resolvedItem.label : resolvedItem.label || '';
  const hasDocs = getCompletionDocumentationValue(resolvedItem.documentation).trim().length > 0;
  if ((resolvedItem.useDocAsDetail || resolvedItem.local) && hasDocs) {
    item.documentation = toCompletionMarkdownDocumentation(resolvedItem.documentation);
    return item;
  }

  if (isStaticCompletionKind(resolvedItem) && hasDocs) {
    item.documentation = toCompletionMarkdownDocumentation(resolvedItem.documentation);
    return item;
  }

  if (resolvedItem.fishKind === FishCompletionItemKind.ARGUMENT && resolvedLabel.startsWith('-')) {
    item.documentation = undefined;
    return item;
  }

  item.documentation = await getDocumentationResolver(resolvedItem);
  return item;
}

async function isRealSubcommand(command: string, label: string): Promise<boolean> {
  if (subcommandCache.hasSubcommand(command, label)) {
    return true;
  }
  if (subcommandCache.isResolved(command)) {
    return false;
  }

  const subcommands = await execSubCommandCompletions(command);
  const labels = subcommands
    .map((line) => line.split('\t')[0]?.trim() || '')
    .filter(Boolean);

  subcommandCache.setSubcommands(command, labels);
  return labels.includes(label);
}

function inferCompletionKinds(
  item: FishCompletionItem,
  fromData: FishCompletionItem['data'] & {
    fishKind?: FishCompletionItemKind;
    detail?: string;
  },
  detail: string,
): FishCompletionItemKind[] {
  const kinds: FishCompletionItemKind[] = [];

  if (item.fishKind) {
    kinds.push(item.fishKind);
  }
  if (fromData.fishKind && !kinds.includes(fromData.fishKind)) {
    kinds.push(fromData.fishKind);
  }
  if (detail === 'command' || item.kind === CompletionItemKind.Class) {
    kinds.push(FishCompletionItemKind.COMMAND);
  }
  if (detail === 'function' || item.kind === CompletionItemKind.Function) {
    kinds.push(FishCompletionItemKind.FUNCTION);
  }
  if (detail === 'alias' || item.kind === CompletionItemKind.Constructor) {
    kinds.push(FishCompletionItemKind.ALIAS);
  }
  if (detail === 'builtin' || item.kind === CompletionItemKind.Keyword) {
    kinds.push(FishCompletionItemKind.BUILTIN);
  }
  if (detail === 'variable' || item.kind === CompletionItemKind.Variable) {
    kinds.push(FishCompletionItemKind.VARIABLE);
  }

  return kinds;
}

function isStaticCompletionKind(item: FishCompletionItem): boolean {
  return item.fishKind === FishCompletionItemKind.STATUS
    || item.fishKind === FishCompletionItemKind.PIPE
    || item.fishKind === FishCompletionItemKind.WILDCARD
    || item.fishKind === FishCompletionItemKind.REGEX
    || item.fishKind === FishCompletionItemKind.FORMAT_STR
    || item.fishKind === FishCompletionItemKind.ESC_CHARS;
}
