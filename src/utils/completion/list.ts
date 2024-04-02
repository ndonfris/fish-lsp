import { FishCompletionData, FishCompletionItem, FishCompletionItemKind, toCompletionItemKind } from './types';
import { FishDocumentSymbol } from '../../document-symbol';
import { Logger } from '../../logger';
import { CompletionList } from 'vscode-languageserver-protocol';

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

  addSymbols(symbols: FishDocumentSymbol[]) {
    const symbolItems = symbols.map((symbol) =>
      FishCompletionItem.fromSymbol(symbol),
    );
    this.items.push(...symbolItems);
  }

  addData(data: FishCompletionData) {
    this.items = this.items.map((item: FishCompletionItem) => {
      const newData = {
        ...data,
        line: data.line.slice(0, data.line.length - data.word.length) + item.label,
      } as FishCompletionData;
      return item.setData(newData);
    });
    return this;
  }

  reset() {
    this.items = [];
  }

  build(): FishCompletionList {
    return FishCompletionList.create(false, this.data, this.items);
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

export interface FishCompletionList extends CompletionList{
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
