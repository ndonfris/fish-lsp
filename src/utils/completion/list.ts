import { FishCompletionData, FishCompletionItem, toCompletionItemKind } from './types';
import { FishSymbol } from '../../parsing/symbol';
import { Logger } from '../../logger';
import { CompletionList, SymbolKind } from 'vscode-languageserver';

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

  addItems(items: FishCompletionItem[]) {
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

  build(isIncomplete: boolean = false): FishCompletionList {
    const uniqueItems = this.items.filter((item, index, self) =>
      index === self.findIndex((t) => t.label === item.label),
    );
    return FishCompletionList.create(isIncomplete, this.data, uniqueItems);
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
