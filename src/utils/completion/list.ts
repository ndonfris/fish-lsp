import { FishCompletionData, FishCompletionItem, toCompletionItemKind } from './types';
import { FishSymbol } from '../../parsing/symbol';
import { Logger } from '../../logger';
import { CompletionItemKind, CompletionList, SymbolKind } from 'vscode-languageserver';

export class FishCompletionListBuilder {
  private items: FishCompletionItem[];
  private data: FishCompletionData = {} as FishCompletionData;
  constructor(
    private logger: Logger,
  ) {
    this.items = [];
  }

  addItem(item: FishCompletionItem) {
    this.items.push(item);
  }

  addItems(items: FishCompletionItem[], priority?: number) {
    if (priority) {
      items = items.map((item) => item.setPriority(priority));
    }
    this.items.push(...items);
  }

  addSymbols(symbols: FishSymbol[], insertDollarSign: boolean = false) {
    const symbolItems = symbols.map((symbol) => {
      if (insertDollarSign && symbol.kind === SymbolKind.Variable) {
        return {
          ...FishCompletionItem.fromSymbol(symbol),
          label: '$' + symbol.name,
        } as FishCompletionItem;
      }
      return FishCompletionItem.fromSymbol(symbol);
    });
    this.items.push(...symbolItems);
  }

  addData(data: FishCompletionData) {
    this.items = this.items.map((item: FishCompletionItem) => {
      if (!data.line.endsWith(' ')) {
        const newData = {
          ...data,
          line: data.line.slice(0, data.line.length - data.word.length) + item.label,
        } as FishCompletionData;
        return item.setData(newData);
      }
      return item;
    });
    return this;
  }

  reset() {
    this.items = [];
  }

  sortByPriority(items: FishCompletionItem[]): FishCompletionItem[] {
    // Default priority is higher than any explicitly set priority
    // (higher number = lower display priority)
    const DEFAULT_PRIORITY = 1000;
    const getFallbackPrioriy = (item: FishCompletionItem) => {
      if (item.kind === CompletionItemKind.Property) {
        return 1005;
      }
      if (item.kind === CompletionItemKind.Class) {
        return 10;
      }
      if (item.kind === CompletionItemKind.Function) {
        return 50;
      }
      if (item.kind === CompletionItemKind.Variable) {
        return 100;
      }
      return DEFAULT_PRIORITY;
    };

    return items.sort((a, b) => {
      // Get priorities with fallback to default
      const priorityA = a.priority !== undefined ? a.priority : getFallbackPrioriy(a);
      const priorityB = b.priority !== undefined ? b.priority : getFallbackPrioriy(b);

      // Compare priorities (lower number = higher display priority)
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // If priorities are the same or both undefined, fall back to alphabetical sorting
      return a.label.localeCompare(b.label);
    });
  }

  build(isIncomplete: boolean = false): FishCompletionList {
    const uniqueItems = this.items.filter((item, index, self) =>
      index === self.findIndex((t) => t.label === item.label),
    );
    const sortedItems = this.sortByPriority(uniqueItems);
    return FishCompletionList.create(isIncomplete, this.data, sortedItems);
  }

  log() {
    const result = this.items.map((item, index) => itemLoggingInfo(item, index));
    this.logger.log('CompletionList', result);
  }

  get _logger() {
    return this.logger;
  }
}

function itemLoggingInfo(item: FishCompletionItem, index: number) {
  return {
    index,
    label: item.label,
    detail: item.detail,
    kind: toCompletionItemKind[item.fishKind],
    fishKind: item.fishKind,
    documentation: item.documentation,
    data: item.data,
  };
}

export interface FishCompletionList extends CompletionList {
}

export namespace FishCompletionList {
  export function empty() {
    return {
      isIncomplete: false,
      items: [] as FishCompletionItem[],
    } as FishCompletionList;
  }

  export function create(
    isIncomplete: boolean,
    data: FishCompletionData,
    items: FishCompletionItem[] = [] as FishCompletionItem[],
  ) {
    return {
      isIncomplete,
      items,
      itemDefaults: {
        data,
      },
    } as FishCompletionList;
  }

}
