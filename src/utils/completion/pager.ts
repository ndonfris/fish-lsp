import { FishSymbol } from '../../parsing/symbol';
import { FishCompletionItem } from './types';
import { execCompleteLine } from '../exec';
import { logger, Logger } from '../../logger';
import { InlineParser } from './inline-parser';
import { CompletionItemMap } from './startup-cache';
import { CompletionContext, CompletionList, Position, SymbolKind } from 'vscode-languageserver-protocol';
import { FishCompletionList, FishCompletionListBuilder } from './list';
import { shellComplete } from './shell';

export type SetupData = {
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

  async completeEmpty(
    symbols: FishSymbol[],
  ): Promise<FishCompletionList> {
    this._items.reset();
    this._items.addSymbols(symbols, true);
    this._items.addItems(this.itemsMap.allOfKinds('builtin'));
    const stdout: [string, string][] = [];
    const toAdd = await this.getSubshellStdoutCompletions(' ');
    stdout.push(...toAdd);
    for (const [name, description] of stdout) {
      this._items.addItem(FishCompletionItem.create(name, 'command', description, name));
    }
    this._items.addItems(this.itemsMap.allOfKinds('function'));
    this._items.addItems(this.itemsMap.allOfKinds('comment'));
    return this._items.build(false);
  }

  async completeVariables(
    line: string,
    word: string,
    setupData: SetupData,
    symbols: FishSymbol[],
  ): Promise<FishCompletionList> {
    this._items.reset();
    const data = FishCompletionItem.createData(
      setupData.uri,
      line,
      word || '',
      setupData.position,
    );

    const { variables } = sortSymbols(symbols);
    for (const variable of variables) {
      const variableItem = FishCompletionItem.fromSymbol(variable);
      variableItem.insertText = '$' + variable.name;
      this._items.addItem(variableItem);
    }
    for (const item of this.itemsMap.allOfKinds('variable')) {
      item.insertText = '$' + item.label;
      this._items.addItem(item);
    }

    const result = this._items.addData(data).build();
    result.isIncomplete = false;
    return result;
  }

  async complete(
    line: string,
    setupData: SetupData,
    symbols: FishSymbol[],
  ): Promise<FishCompletionList> {
    const { word, command, commandNode: _commandNode, index } = this.inlineParser.getNodeContext(line || '');
    logger.log({
      line,
      word: word,
      command: command,
      index: index,
    });
    this._items.reset();
    const data = FishCompletionItem.createData(
      setupData.uri,
      line || '',
      word || '',
      setupData.position,
      command || '',
      setupData.context,
    );

    // const shellOutput = await shellComplete(line.toString());
    // const subshellOutput = await this.getSubshellStdoutCompletions(line);
    // const lineOutput = await execCompleteLine(line);
    // logger.log({
    //   location: 'CompletionPager.complete',
    //   build: getBuildTimeString(),
    //   line: line,
    //   shellOutput: shellOutput.slice(0, 5),
    //   subshellOutput: subshellOutput.slice(0, 5),
    //   lineOutput: lineOutput.slice(0, 5),
    // });

    const { variables, functions } = sortSymbols(symbols);
    if (!word && !command) {
      return this.completeEmpty(symbols);
    }

    const stdout: [string, string][] = [];
    if (command && this.itemsMap.blockedCommands.includes(command)) {
      this._items.addItems(this.itemsMap.allOfKinds('pipe'));
      return this._items.build(false);
    }

    const toAdd = await shellComplete(line);
    stdout.push(...toAdd);
    logger.log('toAdd =', toAdd.slice(0, 5));

    if (word && word.includes('/')) {
      this.logger.log('word includes /', word);
      const toAdd = await this.getSubshellStdoutCompletions(`__fish_complete_path ${word}`);
      this._items.addItems(toAdd.map((item) => FishCompletionItem.create(item[0], 'path', item[1], item.join(' '))));
    }
    const isOption = this.inlineParser.lastItemIsOption(line);
    for (const [name, description] of stdout) {
      //if (this.itemsMap.skippableItem(name, description)) continue;
      if (isOption || name.startsWith('-') || command) {
        this._items.addItem(FishCompletionItem.create(name, 'argument', description, [
          line.slice(0, line.lastIndexOf(' ')),
          name,
        ].join(' ').trim()));
        continue;
      }
      const item = this.itemsMap.findLabel(name);
      if (!item) {
        continue;
      }
      this._items.addItem(item);
    }

    if (command && line.includes(' ')) {
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
    // this._items.log();
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

export async function initializeCompletionPager(logger: Logger, items: CompletionItemMap) {
  const inline = await InlineParser.create();
  return new CompletionPager(inline, items, logger);
}

function addFirstIndexedItems(command: string, items: CompletionItemMap) {
  switch (command) {
    case 'functions':
    case 'function':
      return items.allOfKinds('event', 'variable');
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
    case 'return':
      return items.allOfKinds('status', 'variable');
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

function sortSymbols(symbols: FishSymbol[]) {
  const variables: FishSymbol[] = [];
  const functions: FishSymbol[] = [];
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

// namespace CommandHas {
//   export function string(command: string, word: string) {
//     if (!command) {
//       return false;
//     }
//     return word.startsWith('"') || word.startsWith("'");
//   }
//   export function path(command: string, word: string) {
//     if (!command) {
//       return false;
//     }
//     return word.includes('/') || word.startsWith('~');
//   }
// }
//
