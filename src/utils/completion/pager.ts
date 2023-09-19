import { LspDocument } from '../../document';
import { FishDocumentSymbol } from '../../document-symbol';
import { FishCompletionData, FishCompletionItem } from './types';
import { execCompleteLine } from '../exec';
import { InlineParser } from './inline-parser';
import { CompletionItemMap } from './startup-cache';
import { CompletionContext, CompletionList, CompletionParams, Position, SymbolKind } from 'vscode-languageserver-protocol';

type SetupData = {
  uri: string;
  position: Position;
  context: CompletionContext;
}

export class CompletionPager {

  private _items: CachedCompletionList = new CachedCompletionList();

  constructor(
    private inlineParser: InlineParser,
    private itemsMap: CompletionItemMap
  ) {}

  empty(): CompletionList {
    return {
      items: [] as FishCompletionItem[],
      isIncomplete: false,
    }
  }

  create(
    isIncomplete: boolean,
    items: FishCompletionItem[] = [] as FishCompletionItem[],
  ) {
    return {
      isIncomplete,
      items,
    } as CompletionList
  }

  async complete(
    line: string,
    setupData: SetupData,
    symbols: FishDocumentSymbol[]
  ) : Promise<FishCompletionItem[]>{
    const { word, command, commandNode, index } = this.inlineParser.getNodeContext(line);
    const data = FishCompletionItem.createData(
      setupData.uri,
      line,
      word || "",
      setupData.position
    );
    const stdout = await this.getSubshellStdoutCompletions(line);
    this._items.reset();

    const isOption = this.inlineParser.lastItemIsOption(line);
    for (const [name, description] of stdout) {
      if (isOption || name.startsWith("-") || ( command  && word)) {
        this._items.addItem(FishCompletionItem.create(name, "argument", description, description));
        continue;
      }
      let item = this.itemsMap.findLabel(name);
      if (!item) continue;
      this._items.addItem(item);
    }

    const { variables, functions } = sortSymbols(symbols);
    if (command) {
      this._items.addSymbols(variables);
      if (index === 1) {
        this._items.addItems(addFirstIndexedItems(command, this.itemsMap));
      } else {
        this._items.addItems(addSpecialItems(command, line, this.itemsMap));
      }
    } else if (word && !command) {
      this._items.addSymbols(functions);
    }

    if (word?.startsWith("$")) {
      this._items.addItems(this.itemsMap.allOfKinds("variable"));
      this._items.addSymbols(variables);
    }

    return this._items.addData(data).build()
  }

  getData(uri: string, position: Position, line: string, word: string) {
    return {
      uri,
      position,
      line,
      word,
    };
  }

  private async getSubshellStdoutCompletions(
    line: string
  ): Promise<[string, string][]> {
    const resultItem = (splitLine: string[]) => {
      let name = splitLine[0] || "";
      let description =
        splitLine.length > 1 ? splitLine.slice(1).join(" ") : "";
      return [name, description] as [string, string];
    };
    const outputLines = await execCompleteLine(line);
    return outputLines
      .filter((line) => line.trim().length !== 0)
      .map((line) => line.split("\t"))
      .map((splitLine) => resultItem(splitLine));
  }
}

export async function initializeCompletionPager() {
  return await Promise.all([
    InlineParser.create(),
    CompletionItemMap.initialize(),
  ]).then(([inline, items]) => {
      return new CompletionPager(inline, items);
    });
}

function addFirstIndexedItems(command: string, items: CompletionItemMap) {
  switch (command) {
    //case "end":
    //  return items.allOfKinds("pipe");
    case "printf":
      return items.allOfKinds("format_str", "esc_chars");
    case "set":
      return items.allOfKinds("variable");
    case "return":
      return items.allOfKinds("status", "variable");
    default:
      return [];
  }
}

function addSpecialItems(
  command: string,
  line: string,
  items: CompletionItemMap
) {
  const lastIndex = line.lastIndexOf(command) + 1;
  const afterItems = line.slice(lastIndex).trim().split(" ");
  const lastItem = afterItems.at(-1);
  switch (command) {
    //case "end":
    //  return items.allOfKinds("pipe");
    case "printf":
    case "set":
      return items.allOfKinds("variable");
    case "function":
      switch (lastItem) {
        case "-e":
        case "--on-event":
          return items.allOfKinds("event");
        case "-v":
        case "--on-variable":
        case "-V":
        case "--inherit-variable":
          return items.allOfKinds("variable");
        default:
          return [];
      }
    case "string":
      if (includesFlag("-r", "--regex", ...afterItems)) {
        return items.allOfKinds("regex", "esc_chars");
      } else {
        return items.allOfKinds("esc_chars");
      }
    default:
      return items.allOfKinds('combiner', 'pipe');
  }
}

function includesFlag(
  shortFlag: string,
  longFlag: string,
  ...toSearch: string[]
) {
  let short = shortFlag.startsWith("-") ? shortFlag.slice(1) : shortFlag;
  let long = longFlag.startsWith("--") ? longFlag.slice(2) : longFlag;
  for (let item of toSearch) {
    if (item.startsWith("-") && !item.startsWith("--")) {
      let opts = item.slice(1).split("");
      if (opts.some((opt) => opt === short)) return true;
    }
    if (item.startsWith("--")) {
      let opts = item.slice(2).split("");
      if (opts.some((opt) => opt === long)) return true;
    }
  }
  return false;
}

function sortSymbols(symbols: FishDocumentSymbol[]) {
  const variables: FishDocumentSymbol[] = [];
  const functions: FishDocumentSymbol[] = [];
  symbols.forEach((symbol) => {
    if (symbol.kind === SymbolKind.Variable) {
      variables.push(symbol);
    }
    if (symbol.kind === SymbolKind.Function) {
      functions.push(symbol);
    }
  });
  return { variables, functions };
}

export class CachedCompletionList {
    private items: FishCompletionItem[];
    constructor() {
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
            FishCompletionItem.fromSymbol(symbol)
        );
        this.items.push(...symbolItems);
    }

    addData(data: FishCompletionData) {
        this.items = this.items.map((item: FishCompletionItem) => {
            const newData = {
                ...data,
                line: data.line.slice(0, data.line.length - data.word.length) + item.label
            } as FishCompletionData
            return item.setData(newData)
        });
        return this;
    }

    reset() {
        this.items = [];
    }

    build() {
        return this.items;
    }
}