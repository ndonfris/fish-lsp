import { LspDocument } from '../../document';
import { FishDocumentSymbol } from '../../document-symbol';
import { FishCompletionData, FishCompletionItem, FishCompletionItemKind } from './types';
import { execCompleteLine } from '../exec';
import { Logger } from '../../logger';
import { InlineParser } from './inline-parser';
import { CompletionItemMap } from './startup-cache';
import { CompletionContext, CompletionList, CompletionParams, Position, SymbolKind } from 'vscode-languageserver-protocol';
import { FishCompletionList, FishCompletionListBuilder } from './list';

type SetupData = {
  uri: string;
  position: Position;
  context: CompletionContext;
};

export class CompletionPager {
  private _items: FishCompletionListBuilder;

  constructor(
    private inlineParser: InlineParser,
    private itemsMap: CompletionItemMap,
    private logger: Logger,
  ) {
    this._items = new FishCompletionListBuilder(this.logger);
  }

  empty(): CompletionList {
    return {
      items: [] as FishCompletionItem[],
      isIncomplete: false,
    };
  }

  create(
    isIncomplete: boolean,
    items: FishCompletionItem[] = [] as FishCompletionItem[],
  ) {
    return {
      isIncomplete,
      items,
    } as CompletionList;
  }

  async complete(
    line: string,
    setupData: SetupData,
    symbols: FishDocumentSymbol[],
  ) : Promise<FishCompletionList> {
    const { word, command, commandNode, index } = this.inlineParser.getNodeContext(line);
    this._items.reset();
    const data = FishCompletionItem.createData(
      setupData.uri,
      line,
      word || '',
      setupData.position,
    );

    //this.logger.log('Pager.complete.data =', {command, word})
    const stdout: [string, string][] = [];
    if (!this.itemsMap.blockedCommands.includes(command || '')) {
      const toAdd = await this.getSubshellStdoutCompletions(line);
      stdout.push(...toAdd);
    }

    if (word && word.includes('/')) {
      this.logger.log('word includes /', word);
      const toAdd = await this.getSubshellStdoutCompletions(`__fish_complete_path ${word}`);
      this._items.addItems(toAdd.map((item) => FishCompletionItem.create(item[0], 'path', item[1], item.join(' '))));
    }

    const { variables, functions } = sortSymbols(symbols);

    const isOption = this.inlineParser.lastItemIsOption(line);
    for (const [name, description] of stdout) {
      //if (this.itemsMap.skippableItem(name, description)) continue;
      if (isOption || name.startsWith('-') || command) {
        this._items.addItem(FishCompletionItem.create(name, 'argument', description, [line, name, description].join(' ').trim()));
        continue;
      }
      const item = this.itemsMap.findLabel(name);
      if (!item) {
        continue;
      }
      this._items.addItem(item);
    }

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
    switch (wordsFirstChar(word)) {
      case '$':
        this._items.addItems(this.itemsMap.allOfKinds('variable'));
        this._items.addSymbols(variables);
        break;
      case '/':
        this._items.addItems(this.itemsMap.allOfKinds('wildcard'));
        //let addedStdout = await this.getSubshellStdoutCompletions(word!)
        //stdout = stdout.concat(addedStdout)
        break;
      default:
        break;
    }

    const result = this._items.addData(data).build();
    this._items.log();
    return result;
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
    line: string,
  ): Promise<[string, string][]> {
    const resultItem = (splitLine: string[]) => {
      const name = splitLine[0] || '';
      const description =
        splitLine.length > 1 ? splitLine.slice(1).join(' ') : '';
      return [name, description] as [string, string];
    };
    const outputLines = await execCompleteLine(line);
    return outputLines
      .filter((line) => line.trim().length !== 0)
      .map((line) => line.split('\t'))
      .map((splitLine) => resultItem(splitLine));
  }
}

export async function initializeCompletionPager(logger: Logger) {
  return await Promise.all([
    InlineParser.create(),
    CompletionItemMap.initialize(),
  ]).then(([inline, items]) => {
    return new CompletionPager(inline, items, logger);
  });
}

function addFirstIndexedItems(command: string, items: CompletionItemMap) {
  switch (command) {
    case 'end':
      return items.allOfKinds('pipe');
    case 'printf':
      return items.allOfKinds('format_str', 'esc_chars');
    case 'set':
      return items.allOfKinds('variable');
    case 'return':
      return items.allOfKinds('status', 'variable');
    default:
      return [];
  }
}

function addSpecialItems(
  command: string,
  line: string,
  items: CompletionItemMap,
) {
  const lastIndex = line.lastIndexOf(command) + 1;
  const afterItems = line.slice(lastIndex).trim().split(' ');
  const lastItem = afterItems.at(-1);
  switch (command) {
    //case "end":
    //  return items.allOfKinds("pipe");
    case 'printf':
    case 'set':
      return items.allOfKinds('variable');
    case 'function':
      switch (lastItem) {
        case '-e':
        case '--on-event':
          return items.allOfKinds('event');
        case '-v':
        case '--on-variable':
        case '-V':
        case '--inherit-variable':
          return items.allOfKinds('variable');
        default:
          return [];
      }
    case 'string':
      if (includesFlag('-r', '--regex', ...afterItems)) {
        return items.allOfKinds('regex', 'esc_chars');
      } else {
        return items.allOfKinds('esc_chars');
      }
    default:
      return items.allOfKinds('combiner', 'pipe');
  }
}

function wordsFirstChar(word: string | null) {
  return word?.charAt(0) || ' ';
}

function includesFlag(
  shortFlag: string,
  longFlag: string,
  ...toSearch: string[]
) {
  const short = shortFlag.startsWith('-') ? shortFlag.slice(1) : shortFlag;
  const long = longFlag.startsWith('--') ? longFlag.slice(2) : longFlag;
  for (const item of toSearch) {
    if (item.startsWith('-') && !item.startsWith('--')) {
      const opts = item.slice(1).split('');
      if (opts.some((opt) => opt === short)) {
        return true;
      }
    }
    if (item.startsWith('--')) {
      const opts = item.slice(2).split('');
      if (opts.some((opt) => opt === long)) {
        return true;
      }
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

/////////////////////////////////////////////////////////////////////////////////////////
// Trying functional approach
/////////////////////////////////////////////////////////////////////////////////////////

function addItemsForWord(word: string): FishCompletionItemKind[] {
  const firstChar = wordsFirstChar(word);
  switch (firstChar) {
    case "'":
      return ['esc_chars'];
    case '"':
      return ['esc_chars', 'variable'];
    case '$':
      return ['variable'];
    case '/':
      return ['path'];
    case '%':
      return ['status'];
    case '\\':
      return ['esc_chars'];
    case ')':
      return ['combiner', 'pipe'];
    case ':':
    case '-':
    default:
      return [];
  }
}

namespace CommandHas {
  export function string(command: string, word: string) {
    if (!command) {
      return false;
    }
    return word.startsWith('"') || word.startsWith("'");
  }
  export function path(command: string, word: string) {
    if (!command) {
      return false;
    }
    return word.includes('/') || word.startsWith('~');
  }
}

function addItemsForWordAndCommand(command: string, word: string): FishCompletionItemKind[] {
  switch (true) {
    case CommandHas.string(command, word):
      return ['esc_chars'];
    //case isCommandWithRegex(command, word):
    //  return ['regex'];
    //case CommandHas.
    case CommandHas.path(command, word):
      return ['path', 'wildcard', 'variable'];
    default:
      return [];
  }
}

function addItemsJustByCommand(command: string): FishCompletionItemKind[] {
  switch (command) {
    case 'set':
      return ['variable'];
    case 'function':
      return ['function'];
    case 'printf':
      return ['format_str', 'esc_chars'];
    case 'string':
      return ['esc_chars', 'regex'];
    case 'end':
      return ['pipe'];
    case 'return':
      return ['status', 'variable'];
    default:
      return [];
  }
}

function addItemsForCommandOnly(command: string): FishCompletionItemKind[] {
  switch (command) {
    case 'set':
      return ['variable'];
    case 'function':
      return ['function'];
    case 'printf':
      return ['format_str', 'esc_chars'];
    case 'string':
      return ['esc_chars', 'regex'];
    case 'end':
      return ['pipe'];
    case 'return':
      return ['status', 'variable'];
    default:
      return [];
  }
}

function addItemsForCommand(command: string): FishCompletionItemKind[] {
  switch (command) {
    case 'set':
      return ['variable'];
    case 'function':
      return ['function'];
    case 'printf':
      return ['format_str', 'esc_chars'];
    case 'string':
      return ['esc_chars', 'regex'];
    case 'end':
      return ['pipe'];
    case 'return':
      return ['status', 'variable'];
    default:
      return [];
  }
}

function addItemTypes(line: string, parser: InlineParser): FishCompletionItemKind[] {
  const { word, command } = parser.getNodeContext(line);
  const wordFirstChar = wordsFirstChar(word);
  switch (wordFirstChar) {
    case '$': return ['variable'];
    case '\\':
    case '/':
    case '%':

    // goes together
    case '-':
    case ':':
      break;
    default:
      break;
  }
  return [];
}
