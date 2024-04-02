import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { FishCompletionItem, FishCompletionItemKind } from './types';
import { execCmd } from '../exec';
import { StaticItems } from './static-items';
import { SetupItemsFromCommandConfig } from './startup-config';

export type ItemMapRecord = Record<FishCompletionItemKind, FishCompletionItem[]>;

export class CompletionItemMap {
  constructor(
    private _items: ItemMapRecord = {} as ItemMapRecord,
  ) {}
  static async initialize(): Promise<CompletionItemMap> {
    const result: ItemMapRecord = {} as ItemMapRecord;
    const cmdOutputs: Map<FishCompletionItemKind, string[]> = new Map();
    const topLevelLabels: Set<string> = new Set();
    await Promise.all(SetupItemsFromCommandConfig.map(async (item) => {
      const stdout = await execCmd(item.command);
      cmdOutputs.set(item.fishKind, stdout);
    }));
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
      });
      result[item.fishKind] = items;
    });
    Object.entries(StaticItems).forEach(([key, value]) => {
      const kind = key as FishCompletionItemKind;
      if (!result[kind]) {
        result[kind] = value.map((item) => FishCompletionItem.create(
          item.label,
          kind,
          item.detail,
          item.documentation.toString(),
          item.examples,
        ));
      }
    });
    return new CompletionItemMap(result);
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
      FishCompletionItemKind.ABBR,
      FishCompletionItemKind.ALIAS,
      FishCompletionItemKind.BUILTIN,
      FishCompletionItemKind.FUNCTION,
      FishCompletionItemKind.COMMAND,
      //FishCompletionItemKind.VARIABLE,
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
