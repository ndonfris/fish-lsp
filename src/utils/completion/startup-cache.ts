import { FishCompletionItem, FishCompletionItemKind, getCompletionDocumentationValue } from './types';
import { StaticItems } from './static-items';
import { runSetupItems, SetupItemsFromCommandConfig, SetupResult } from './startup-config';
import { md } from '../markdown-builder';
import {
  JsonType,
  applyPrebuiltDescription,
  getHydratedPrebuiltDescription,
  getSpecialVariableHoverDoc,
  warmPrebuiltCommandDescriptions,
} from '../snippets';

export type ItemMapRecord = Record<FishCompletionItemKind, FishCompletionItem[]>;

type CacheEnrichment = {
  cacheKind: keyof ItemMapRecord;
  prebuiltType?: JsonType;
  filter?: (item: FishCompletionItem) => boolean;
  enrich?: (item: FishCompletionItem) => FishCompletionItem;
};

const cacheEnrichments: CacheEnrichment[] = [
  {
    cacheKind: 'command',
    enrich: (item) => {
      const detail = getHydratedPrebuiltDescription(item.label);
      if (item.detail === 'command' && detail) {
        item.detail = detail;
        item.documentation = md.codeBlock('fish', [`# ${detail}`, item.label].join('\n'));
      }
      return item;
    },
  },
  {
    cacheKind: 'builtin',
    prebuiltType: 'command',
  },
  {
    cacheKind: 'function',
    prebuiltType: 'function',
    filter: (item) => !item.label.startsWith('string-'),
    enrich: (item) => {
      item.detail = getHydratedPrebuiltDescription(item.label, item.detail);
      return item;
    },
  },
  {
    cacheKind: 'variable',
    prebuiltType: 'variable',
    enrich: (item) => {
      item.documentation = getSpecialVariableHoverDoc(item.label) || item.documentation;
      return item;
    },
  },
];

export class CompletionItemMap {
  constructor(
    private _items: ItemMapRecord = {} as ItemMapRecord,
    private _skippedMatches: Set<string> = new Set(),
  ) { }

  static async initialize(setupResults?: SetupResult[]): Promise<CompletionItemMap> {
    const result: ItemMapRecord = {} as ItemMapRecord;
    const skippedMatches: Set<string> = new Set();
    await CompletionItemMap.collectSetupItems(result, skippedMatches, setupResults);
    // Ensure command descriptions are loaded before the (synchronous) enrichment
    // below reads them. Pre-warmed concurrently in FishServer.create, so this await
    // is normally already resolved — it just prevents the blocking execFileSync
    // fallback from running on the critical path.
    await warmPrebuiltCommandDescriptions();
    CompletionItemMap.mergeStaticItems(result);
    CompletionItemMap.enrichCacheItems(result);
    return new CompletionItemMap(result, skippedMatches);
  }

  private static async collectSetupItems(
    result: ItemMapRecord,
    skippedMatches: Set<string>,
    /** pre-fetched results from a shared `runSetupItems()` call; fetched if omitted */
    preFetched?: SetupResult[],
  ): Promise<void> {
    const cmdOutputs: Map<FishCompletionItemKind, string[]> = new Map();
    const topLevelLabels: Set<string> = new Set();
    const setupResults = preFetched ?? await runSetupItems();

    for (const item of setupResults) {
      cmdOutputs.set(item.fishKind, item.results);
    }

    SetupItemsFromCommandConfig.forEach((item) => {
      const items: FishCompletionItem[] = [];
      const stdout = cmdOutputs.get(item.fishKind)!;
      stdout.forEach((line) => {
        if (line.trim().length === 0) {
          return;
        }
        const { label, value } = splitLine(line);
        if (item.topLevel) {
          if (topLevelLabels.has(label)) {
            return;
          }
          topLevelLabels.add(label);
        }
        const detail = getCommandsDetail(value || item.detail);
        items.push(FishCompletionItem.create(label, item.fishKind, detail, line));
        if (item.skipMatchesInResponse) {
          skippedMatches.add(label);
        }
      });
      result[item.fishKind] = items;
    });
  }

  private static mergeStaticItems(result: ItemMapRecord): void {
    Object.entries(StaticItems).forEach(([key, value]) => {
      const kind = key as FishCompletionItemKind;
      if (!result[kind]) {
        result[kind] = value.map((item) => fromStaticItem(item, kind));
      }
      if (kind === FishCompletionItemKind.FUNCTION || kind === FishCompletionItemKind.VARIABLE) {
        const toAdd = value
          .filter((item) => !result[kind].find((i) => i.label === item.label))
          .map((item) => FishCompletionItem.create(
            item.label,
            kind,
            item.detail,
            [
              `(${md.italic(kind)}) ${md.bold(item.label)}`,
              md.separator(),
              getCompletionDocumentationValue(item.documentation),
            ].join('\n'),
            item.examples,
          ).setUseDocAsDetail());
        result[kind].push(...toAdd);
      }
    });
  }

  private static enrichCacheItems(cache: ItemMapRecord): void {
    for (const config of cacheEnrichments) {
      const items = cache[config.cacheKind] || [];
      const filtered = config.filter ? items.filter(config.filter) : items;
      cache[config.cacheKind] = filtered.map((item) => {
        if (config.prebuiltType) {
          item.detail = applyPrebuiltDescription(item.label, item.detail, config.prebuiltType);
        }
        return config.enrich ? config.enrich(item) : item;
      });
    }
  }

  get(kind: FishCompletionItemKind): FishCompletionItem[] {
    return this._items[kind] || [];
  }

  get allKinds(): FishCompletionItemKind[] {
    return Object.keys(this._items) as FishCompletionItemKind[];
  }

  allOfKinds(...kinds: FishCompletionItemKind[]): FishCompletionItem[] {
    return kinds.reduce((acc, kind) => acc.concat(this.get(kind)), [] as FishCompletionItem[]);
  }

  entries(): [FishCompletionItemKind, FishCompletionItem[]][] {
    return Object.entries(this._items) as [FishCompletionItemKind, FishCompletionItem[]][];
  }

  forEach(callbackfn: (key: FishCompletionItemKind, value: FishCompletionItem[]) => void) {
    this.entries().forEach(([key, value]) => callbackfn(key, value));
  }

  allCompletionsWithoutCommand() {
    return this.allOfKinds(
      // FishCompletionItemKind.ABBR,
      FishCompletionItemKind.ALIAS,
      FishCompletionItemKind.BUILTIN,
      FishCompletionItemKind.FUNCTION,
      FishCompletionItemKind.COMMAND,
      // FishCompletionItemKind.VARIABLE,
    );
  }

  findLabel(label: string, ...searchKinds: FishCompletionItemKind[]): FishCompletionItem | undefined {
    const kinds: FishCompletionItemKind[] = searchKinds?.length > 0 ? searchKinds : this.allKinds;
    for (const kind of kinds) {
      const item = this.get(kind).find((item) => item.label === label);
      if (item) {
        return item;
      }
    }
    return undefined;
  }

  get blockedCommands() {
    return [
      'end',
      'else',
      'continue',
      'break',
    ];
  }

  shouldSkipMatch(label: string): boolean {
    return this._skippedMatches.has(label);
  }
}

export function splitLine(line: string): { label: string; value?: string; } {
  const index = line.search(/\s/);  // This looks for the first whitespace character
  if (index === -1) {
    return { label: line };
  }

  const label = line.slice(0, index);
  const value = line.slice(index).trimStart(); // No need to add 1 since you want to retain the whitespace in value.
  return { label, value };
}

function getCommandsDetail(value: string) {
  if (value.trim().length === 0) {
    return 'command';
  }
  if (value.startsWith('alias')) {
    return 'alias';
  }
  if (value === 'command link') {
    return 'command';
  }
  if (value === 'command') {
    return 'command';
  }
  return value;
}

function fromStaticItem(item: FishCompletionItem, kind: FishCompletionItemKind): FishCompletionItem {
  const completion = FishCompletionItem.create(
    item.label,
    kind,
    item.detail,
    getCompletionDocumentationValue(item.documentation),
    item.examples,
  );

  if (item.insertText !== undefined) {
    completion.insertText = item.insertText;
  }
  if (item.insertTextFormat !== undefined) {
    completion.insertTextFormat = item.insertTextFormat;
  }
  if (item.kind !== undefined) {
    completion.kind = item.kind;
  }
  if (item.useDocAsDetail) {
    completion.setUseDocAsDetail();
  }

  return completion;
}
