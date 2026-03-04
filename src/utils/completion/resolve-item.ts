import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { getCommandDocString, getDocumentationResolver } from './documentation';
import {
  FishCompletionItem,
  FishCompletionItemKind,
  getCompletionDocumentationValue,
  toCompletionMarkdownDocumentation,
} from './types';
import { CompletionItemMap } from './startup-cache';

type ResolveCompletionMap = Pick<CompletionItemMap, 'findLabel'>;

export async function resolveCompletionItemDocumentation(
  item: CompletionItem,
  completionMap: ResolveCompletionMap,
): Promise<CompletionItem> {
  const fishItem = item as FishCompletionItem;
  const fromData = (fishItem.data ?? {}) as FishCompletionItem['data'] & {
    fishKind?: FishCompletionItemKind;
    detail?: string;
    local?: boolean;
    useDocAsDetail?: boolean;
  };
  const detail = (fishItem.detail || fromData.detail || '').trim().toLowerCase();
  const label = typeof fishItem.label === 'string' ? fishItem.label : fishItem.label || '';

  if (isCommandCompletionKind(fishItem, detail) && label) {
    const cmdDoc = await getCommandDocString(label);
    if (cmdDoc) {
      item.documentation = toCompletionMarkdownDocumentation(cmdDoc);
    }
    return item;
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
    documentation: hasIncomingDocs ? fishItem.documentation : mapItem?.documentation,
    local: fishItem.local ?? fromData.local ?? mapItem?.local ?? false,
    useDocAsDetail: fishItem.useDocAsDetail ?? fromData.useDocAsDetail ?? mapItem?.useDocAsDetail ?? false,
  } as FishCompletionItem;

  const hasDocs = getCompletionDocumentationValue(resolvedItem.documentation).trim().length > 0;
  if ((resolvedItem.useDocAsDetail || resolvedItem.local) && hasDocs) {
    item.documentation = toCompletionMarkdownDocumentation(resolvedItem.documentation);
    return item;
  }

  const resolvedLabel = typeof resolvedItem.label === 'string' ? resolvedItem.label : resolvedItem.label || '';
  if (isCommandCompletionKind(resolvedItem, detail) && resolvedLabel) {
    const cmdDoc = await getCommandDocString(resolvedLabel);
    if (cmdDoc) {
      item.documentation = toCompletionMarkdownDocumentation(cmdDoc);
      return item;
    }
  }

  const doc = await getDocumentationResolver(resolvedItem);
  if (doc) {
    item.documentation = doc;
  } else if (hasDocs) {
    item.documentation = toCompletionMarkdownDocumentation(resolvedItem.documentation);
  }
  return item;
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

function isCommandCompletionKind(item: FishCompletionItem, detail: string): boolean {
  return item.fishKind === FishCompletionItemKind.COMMAND
    || detail === 'command'
    || typeof (item as any).kind === 'string' && (item as any).kind.toLowerCase() === 'command'
    || item.kind === CompletionItemKind.Class;
}
