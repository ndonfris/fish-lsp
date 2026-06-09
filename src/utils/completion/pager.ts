import { FishSymbol } from '../../parsing/symbol';
import { cloneCompletionItem, FishCompletionItem, getCompletionDocumentationValue } from './types';
import { execCompleteCmdArgs, execCompleteLine } from '../exec';
import { logger, Logger } from '../../logger';
import { InlineParser } from './inline-parser';
import { CompletionItemMap } from './startup-cache';
import { CompletionContext, CompletionList, Position, SymbolKind } from 'vscode-languageserver';
import { FishCompletionList, FishCompletionListBuilder } from './list';
import { shellComplete } from './shell';
import { isVariableDefinitionName } from '../../parsing/barrel';
import { isOption, isCommandWithName, isUnmatchedStringCharacter, isVariableExpansion } from '../../utils/node-types';
import * as SetParser from '../../parsing/set';
import * as ReadParser from '../../parsing/read';
import * as ArgparseParser from '../../parsing/argparse';
import * as FunctionParser from '../../parsing/function';
import { LspDocument } from '../../document';
import { SyntaxNode } from 'web-tree-sitter';

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
    this._items.addItems(this.itemsMap.allOfKinds('builtin').map(item => item.setPriority(10)));
    try {
      const stdout: [string, string][] = [];
      const toAdd = await this.getSubshellStdoutCompletions(' ');
      stdout.push(...toAdd);
      for (const [name, description] of stdout) {
        if (this.itemsMap.shouldSkipMatch(name)) {
          continue;
        }
        this._items.addItem(FishCompletionItem.create(name, 'command', description, name).setPriority(1));
      }
    } catch (e) {
      logger.info('Error getting subshell stdout completions', e);
    }
    this._items.addItems(this.itemsMap.allOfKinds('comment').map(item => item.setPriority(95)));
    this._items.addItems(this.itemsMap.allOfKinds('function').map(item => item.setPriority(30)));
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

    const prefixInfo = getVariableCompletionPrefix(
      line,
      setupData.position.character,
      word,
      this.isInVariableDefinitionContext(line, setupData.position),
    );
    const variablePrefix = prefixInfo.insertPrefix;
    if (prefixInfo.replaceLength !== undefined) {
      data.replaceLength = prefixInfo.replaceLength;
    }

    const { variables } = sortSymbols(symbols);
    for (const variable of variables) {
      const variableItem = FishCompletionItem.fromSymbol(variable);
      variableItem.insertText = variablePrefix + variable.name;
      this._items.addItem(variableItem);
    }

    const mapVariables = this.itemsMap.allOfKinds('variable');

    for (const item of mapVariables) {
      if (!item.label) {
        continue;
      }
      // Create a new completion item based on the original
      const newItem = FishCompletionItem.create(
        item.label,
        item.fishKind,
        item.detail,
        getCompletionDocumentationValue(item.documentation),
        item.examples,
      );
      newItem.insertText = variablePrefix + item.label;
      this._items.addItem(newItem);
    }

    const result = this._items.addData(data).build();
    result.isIncomplete = false;
    return result;
  }

  /**
   * Determines if the current line context is for variable definition using proper syntax tree analysis
   * (e.g., set, read commands where variables don't need $ prefix)
   */
  private isInVariableDefinitionContext(lineBeforeCursor: string, position: Position): boolean {
    try {
      // Parse the line to get the syntax tree
      const rootNode = this.inlineParser.parse(lineBeforeCursor);
      if (!rootNode) {
        return false;
      }

      // Find the node at the current position
      const currentNode = rootNode.descendantForPosition({
        row: 0,
        column: Math.max(0, position.character - 1),
      });

      if (!currentNode) {
        return false;
      }

      const endsWithSpace = /\s$/.test(lineBeforeCursor);

      // `set NAME [VALUE...]`: the first non-option argument is the variable being
      // defined (insert a plain name); anything after it is a value (insert a
      // `$`-prefixed expansion). `set -q` is a pure query, so every slot is a
      // reference. Decide by how many non-option arguments precede the word being
      // completed — NOT by the node under the cursor, which at a fresh slot (after
      // trailing whitespace) resolves to the *previous* token and misclassifies
      // both `set -gx <here>` (empty name slot) and `set -gx name <here>` (value).
      //
      // Probe at the last non-whitespace column: `descendantForPosition` on a
      // trailing-space cursor returns the program root (outside the command), so
      // walking up from there would never find the enclosing command.
      const lastTokenColumn = Math.max(0, lineBeforeCursor.replace(/\s+$/, '').length - 1);
      let setCommand: SyntaxNode | null = rootNode.descendantForPosition({ row: 0, column: lastTokenColumn });
      while (setCommand && setCommand.type !== 'command') {
        setCommand = setCommand.parent;
      }
      if (setCommand && isCommandWithName(setCommand, 'set')) {
        // `set -q/-e/-S` (query/erase/show) take variable NAMES, not values —
        // `set -q argv` checks `argv`, never `$argv`. Every operand is a plain
        // name. Only a value-assigning `set NAME VALUE...` has `$`-expansion slots.
        if (!SetParser.isSetDefinition(setCommand)) {
          return true;
        }
        const nonOptionArgs = setCommand.childrenForFieldName('argument').filter(arg => !isOption(arg));
        const priorNonOptionArgs = endsWithSpace ? nonOptionArgs.length : Math.max(0, nonOptionArgs.length - 1);
        return priorNonOptionArgs === 0;
      }
      const { command: enclosingCommandName } = this.inlineParser.getNodeContext(lineBeforeCursor);

      // Bare `set ` (or `set` mid-type): the parser hasn't formed a `command`
      // node yet, so the walk-up above finds nothing. The very next slot is the
      // variable name, so it's a definition position.
      if (!setCommand && enclosingCommandName === 'set') {
        return true;
      }

      // `for NAME in VALUES`: only the loop variable (the first operand) is a
      // definition; `in` and the values are references. A partial `for ` line
      // doesn't parse into a `for_statement`, so decide from the text — it's the
      // loop-var slot until a second token (the `in` keyword) is started.
      if (enclosingCommandName === 'for') {
        const afterFor = lineBeforeCursor.replace(/^\s*for\s+/, '');
        return !/\s/.test(afterFor);
      }

      // `function NAME --argument-names a b c`: the named parameters are variable
      // definitions (plain names). A partial `function ` line doesn't parse into a
      // `function_definition`, so detect the `--argument-names`/`-a` flag from the
      // text — operands after it are names until another option begins.
      if (/^\s*function\s/.test(lineBeforeCursor)) {
        const afterArgNames = lineBeforeCursor.match(/\s(?:--argument-names|-a)\s+([\s\S]*)$/);
        if (afterArgNames && !/\s-/.test(afterArgNames[1]!)) {
          return true;
        }
      }

      // `read`/`argparse`/`for`/`function` define variable names too. At a fresh
      // slot (cursor after trailing whitespace) the node under the cursor is the
      // *previous* token, so the definition-name checks below would miss the empty
      // slot (e.g. `read <TAB>`, `for <TAB>`). Probe by parsing a placeholder
      // identifier typed at the cursor and reuse each command's existing
      // definition-name detection on that node.
      let probeNode = currentNode;
      if (endsWithSpace) {
        const probedRoot = this.inlineParser.parse(lineBeforeCursor + 'fishLspProbe');
        const probed = probedRoot?.descendantForPosition({ row: 0, column: lineBeforeCursor.length });
        if (probed) {
          probeNode = probed;
        }
      }

      // The probed node is itself a variable definition name (covers `read`/`for`
      // name slots and the typing case for every definition command).
      if (isVariableDefinitionName(probeNode)) {
        return true;
      }

      if (probeNode.parent) {
        const grandParent = probeNode.parent.parent;

        // (`set` is handled above via slot-counting.)

        // `read`: trailing operands are variable names (option-values excluded).
        if (grandParent && isCommandWithName(grandParent, 'read')) {
          const { definitionNodes } = ReadParser.findReadChildren(grandParent);
          if (definitionNodes.some(node => node.equals(probeNode) || probeNode.parent && node.equals(probeNode.parent))) {
            return true;
          }
        }

        // `argparse`: the option specs before `--` define `_flag_*` variables.
        if (grandParent && isCommandWithName(grandParent, 'argparse')) {
          const nodes = ArgparseParser.findArgparseDefinitionNames(grandParent);
          if (nodes.some(node => node.equals(probeNode) || probeNode.parent && node.equals(probeNode.parent))) {
            return true;
          }
        }

        // `function --argument-names`: the named arguments are variable definitions.
        if (grandParent && isCommandWithName(grandParent, 'function')) {
          const { variableNodes } = FunctionParser.findFunctionOptionNamedArguments(grandParent);
          if (variableNodes.some(node => node.equals(probeNode) || probeNode.parent && node.equals(probeNode.parent))) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      // Fallback to false if parsing fails
      return false;
    }
  }

  async complete(
    line: string,
    setupData: SetupData,
    symbols: FishSymbol[],
  ): Promise<FishCompletionList> {
    const { word, wordNode, command, commandNode: _commandNode, index } = this.inlineParser.getNodeContext(line || '');
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
    if (wordNode && isUnmatchedStringCharacter(wordNode)) {
      data.replaceLength = 0;
    }

    const { variables, functions } = sortSymbols(symbols);
    if (!word && !command) {
      return this.completeEmpty(symbols);
    }

    const stdout: [string, string][] = [];
    if (command && this.itemsMap.blockedCommands.includes(command)) {
      this._items.addItems(this.itemsMap.allOfKinds('pipe'), 85);
      return this._items.build(false);
    }
    const incompleteCompletePayloadPrefix = getIncompleteQuotedCompletePayloadPrefix(line, command);
    const incompleteAliasPayloadPrefix = getIncompleteQuotedAliasPayloadPrefix(line, command);
    const isEmbeddedCommandlineCompletion =
      incompleteAliasPayloadPrefix !== null || incompleteCompletePayloadPrefix !== null;
    const shellOptions = command === 'complete'
      ? { sanitizeCompletionPath: true }
      : undefined;
    const unmatchedQuoteIndex = findLastUnmatchedQuoteIndex(line);
    if (incompleteAliasPayloadPrefix !== null) {
      const embeddedWord = this.inlineParser.parseWord(incompleteAliasPayloadPrefix).word || '';
      data.word = embeddedWord;
      data.replaceLength = embeddedWord.length;

      if (incompleteAliasPayloadPrefix.length > 0) {
        const toAdd = await shellComplete(incompleteAliasPayloadPrefix);
        stdout.push(...toAdd);
        logger.log('toAdd =', toAdd.slice(0, 5));
      } else {
        this._items.addItems(this.itemsMap.allCompletionsWithoutCommand(), 30);
      }

      this._items.addItems(this.itemsMap.allCompletionsWithoutCommand(), 30);
      this._items.addSymbols(functions);
      this.addEmbeddedVariableItems(variables, incompleteAliasPayloadPrefix, embeddedWord);
      this._items.addItems(this.itemsMap.allOfKinds('combiner', 'pipe'), 29);
    } else if (incompleteCompletePayloadPrefix !== null) {
      const embeddedWord = this.inlineParser.parseWord(incompleteCompletePayloadPrefix).word || '';
      data.word = embeddedWord;
      data.replaceLength = embeddedWord.length;

      if (/\$\($/.test(incompleteCompletePayloadPrefix) || /\($/.test(incompleteCompletePayloadPrefix)) {
        this._items.addItems(this.itemsMap.allCompletionsWithoutCommand(), 30);
      } else if (incompleteCompletePayloadPrefix.length > 0) {
        const toAdd = await shellComplete(incompleteCompletePayloadPrefix, shellOptions);
        stdout.push(...toAdd);
        logger.log('toAdd =', toAdd.slice(0, 5));
      } else {
        this._items.addItems(this.itemsMap.allCompletionsWithoutCommand(), 30);
      }
      this.addEmbeddedVariableItems(variables, incompleteCompletePayloadPrefix, embeddedWord);
      this._items.addItems(this.itemsMap.allOfKinds('combiner', 'pipe'), 29);
    } else if (command === 'complete' && unmatchedQuoteIndex !== -1) {
      const safePrefix = line.slice(0, unmatchedQuoteIndex);
      const toAdd = await shellComplete(safePrefix, shellOptions);
      stdout.push(...toAdd);
      logger.log('toAdd =', toAdd.slice(0, 5));
    } else {
      const toAdd = await shellComplete(line, shellOptions);
      stdout.push(...toAdd);
      logger.log('toAdd =', toAdd.slice(0, 5));
    }

    if (!word && !!command && line.endsWith(' ')) {
      const optionLines = await execCompleteCmdArgs(line.trim());
      stdout.push(...optionLines
        .map((optionLine) => {
          const [name, ...rest] = optionLine.split('\t');
          return [name || '', rest.join('\t')] as [string, string];
        })
        .filter(([name]) => name.length > 0));
    }

    if (word && word.includes('/')) {
      this.logger.log('word includes /', word);
      const toAdd = await this.getSubshellStdoutCompletions(`__fish_complete_path ${word}`);
      this._items.addItems(toAdd.map((item) => FishCompletionItem.create(item[0], 'path', item[1], item.join(' '))), 1);
    }
    const isOption = this.inlineParser.lastItemIsOption(line);
    const isStatusCompletionContext = command === 'return' || command === 'exit';
    for (const [name, description] of stdout) {
      if (this.itemsMap.shouldSkipMatch(name)) {
        continue;
      }
      if (isStatusCompletionContext && this.itemsMap.findLabel(name, 'status')) {
        continue;
      }
      if (isEmbeddedCommandlineCompletion) {
        const mappedItem = this.itemsMap.findLabel(
          name,
          'alias',
          'builtin',
          'function',
          'command',
          'event',
        );
        if (mappedItem) {
          this._items.addItem(
            cloneCompletionItem(mappedItem).setPriority(1),
          );
          continue;
        }
        this._items.addItem(
          FishCompletionItem.create(name, 'argument', description, name)
            .setPriority(1),
        );
        continue;
      }
      if (isOption || name.startsWith('-') || command) {
        this._items.addItem(FishCompletionItem.create(name, 'argument', description, [
          line.slice(0, line.lastIndexOf(' ')),
          name,
        ].join(' ').trim()).setPriority(1));
        continue;
      }
      const item = this.itemsMap.findLabel(name);
      if (!item) {
        continue;
      }
      this._items.addItem(item.setPriority(1));
    }

    if (command && line.includes(' ')) {
      if (!isEmbeddedCommandlineCompletion) {
        this.addVariableSymbols(variables, line, setupData.position, word);
      }
      if (index === 1) {
        this._items.addItems(addFirstIndexedItems(command, this.itemsMap), 25);
      } else {
        this._items.addItems(addSpecialItems(command, line, this.itemsMap), 24);
      }
    } else if (word && !command) {
      this._items.addSymbols(functions);
    }

    switch (wordsFirstChar(word)) {
      case '$':
        this._items.addItems(this.itemsMap.allOfKinds('variable'), 55);
        // For $ prefixed words, add symbols without duplicate $ handling via completeVariables
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

  /**
   * Add local variable symbols as completion items for a non-`$` cursor (the
   * `complete()` flow, e.g. `ls <TAB>`). A variable used as a command argument
   * is a *reference*, so its insert text is `$`-prefixed (`ls argv` → `ls $argv`)
   * — unless the cursor is a variable definition/bare-name slot (`set <TAB>`,
   * `for <TAB>`, `set -e/-q/-S NAME`, the `set NAME` name slot, …), where a
   * plain name is wanted. The label stays unprefixed so the user still sees and
   * filters on `argv`. A word already starting with `$` is left alone (those
   * are routed through `completeVariables`, which owns prefix handling).
   */
  private addVariableSymbols(variables: FishSymbol[], line: string, position: Position, word: string | null): void {
    const needsDollarPrefix =
      !word?.startsWith('$')
      && !this.isInVariableDefinitionContext(line, position);
    if (!needsDollarPrefix) {
      this._items.addSymbols(variables);
      return;
    }
    for (const variable of variables) {
      const item = FishCompletionItem.fromSymbol(variable);
      item.insertText = '$' + variable.name;
      this._items.addItem(item);
    }
  }

  private addEmbeddedVariableItems(variables: FishSymbol[], prefixText: string, embeddedWord: string): void {
    const variablePrefix = getEmbeddedVariableCompletionPrefix(prefixText, embeddedWord);
    this._items.addItems(variables.map((variable) => {
      const item = FishCompletionItem.fromSymbol(variable);
      item.insertText = variablePrefix + variable.name;
      return item;
    }));

    this._items.addItems(this.itemsMap.allOfKinds('variable').map((item) => {
      const newItem = FishCompletionItem.create(
        item.label,
        item.fishKind,
        item.detail,
        getCompletionDocumentationValue(item.documentation),
        item.examples,
      );
      newItem.insertText = variablePrefix + item.label;
      return newItem;
    }));
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

function findLastUnmatchedQuoteIndex(line: string): number {
  let singleQuoteIndex = -1;
  let doubleQuoteIndex = -1;
  let escaped = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '\'' && doubleQuoteIndex === -1) {
      singleQuoteIndex = singleQuoteIndex === -1 ? index : -1;
      continue;
    }
    if (char === '"' && singleQuoteIndex === -1) {
      doubleQuoteIndex = doubleQuoteIndex === -1 ? index : -1;
    }
  }

  return Math.max(singleQuoteIndex, doubleQuoteIndex);
}

function getIncompleteQuotedCompletePayloadPrefix(line: string, command: string | null): string | null {
  if (command !== 'complete') return null;

  const match = line.match(/(?:^|\s)(?:-n|--condition|-a|--arguments)\s+(['"])(.*)$/);
  if (!match) return null;

  const quote = match[1];
  const payload = match[2] || '';
  if (!quote || payload.includes(quote)) return null;

  return payload.trimStart();
}

function getIncompleteQuotedAliasPayloadPrefix(line: string, command: string | null): string | null {
  if (command !== 'alias') return null;

  const match = line.match(/^alias\s+\S+\s*=\s*(['"])(.*)$/);
  if (!match) return null;

  const quote = match[1];
  const payload = match[2] || '';
  if (!quote || payload.includes(quote)) return null;

  return payload;
}

function getVariableCompletionPrefix(
  lineBeforeCursor: string,
  cursorPos: number,
  word: string,
  isVariableDefinitionContext: boolean,
): { insertPrefix: string; replaceLength?: number; } {
  let wordStartPos = cursorPos;
  while (wordStartPos > 0) {
    const char = lineBeforeCursor[wordStartPos - 1];
    if (char === ' ' || char === '\t' || char === '\n' || char === '$') {
      break;
    }
    wordStartPos--;
  }

  let dollarsBeforeWord = 0;
  for (let i = wordStartPos - 1; i >= 0 && lineBeforeCursor[i] === '$'; i--) {
    dollarsBeforeWord++;
  }

  const dollarsInWord = (word.match(/\$/g) || []).length;
  const prefixSlice = lineBeforeCursor.slice(Math.max(wordStartPos - dollarsBeforeWord, 0), cursorPos);

  if (prefixSlice.endsWith('${')) {
    return { insertPrefix: '', replaceLength: 0 };
  }
  if (prefixSlice.endsWith('$')) {
    return { insertPrefix: '$' };
  }

  const shouldAddDollarPrefix =
    dollarsBeforeWord === 0 && dollarsInWord === 0 && !isVariableDefinitionContext
    || dollarsInWord > 0;
  const dollarPrefix = dollarsInWord > 0 ? '$'.repeat(dollarsInWord) : shouldAddDollarPrefix ? '$' : '';
  return { insertPrefix: dollarPrefix };
}

function getEmbeddedVariableCompletionPrefix(prefixText: string, embeddedWord: string): string {
  const prefixSlice = prefixText.slice(Math.max(prefixText.length - embeddedWord.length - 2, 0));

  if (prefixSlice.endsWith('${')) {
    return '${';
  }
  if (prefixSlice.endsWith('$')) {
    return '$';
  }

  return '$';
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
    case 'exit':
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
    case 'exit':
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

/**
 * Determines if the current position is within a variable expansion context.
 * This handles cases like:
 * - echo $P  (cursor after P)
 * - echo $$P (cursor after P)
 * - echo $$$PA (cursor after PA)
 * - echo  (cursor after space - could start variable expansion)
 * - set -q  (cursor after space - variable definition context)
 */
export function isInVariableExpansionContext(doc: LspDocument, position: Position, line: string, word: string, current: SyntaxNode | null): boolean {
  const lineBeforeCursor = doc.getLineBeforeCursor(position);

  // Treat shell-style command-substitution prefixes as command completion
  // instead of variable expansion so `$(comman` behaves like `(comman`.
  if (/\$\([^)]*$/.test(lineBeforeCursor)) {
    return false;
  }

  // Original logic for simple cases
  if (word.trim().endsWith('$') || line.trim().endsWith('$') || word.trim() === '$' && !word.startsWith('$$')) {
    return true;
  }

  // Check if we're directly in a variable expansion node
  if (current && isVariableExpansion(current)) {
    return true;
  }

  // Check if the parent is a variable expansion
  if (current?.parent && isVariableExpansion(current.parent)) {
    return true;
  }

  // Look at the text preceding the current position to detect $ prefixes
  const charIndex = position.character;

  // Find the position where the current word starts (excluding $ prefixes)
  let wordStartPos = charIndex;
  while (wordStartPos > 0) {
    const char = lineBeforeCursor[wordStartPos - 1];
    // Stop if we hit whitespace or if we hit a $ character ($ is prefix, not part of word)
    if (char === ' ' || char === '\t' || char === '\n' || char === '$') {
      break;
    }
    wordStartPos--;
  }

  // Now look backwards from wordStartPos to count $ characters
  let dollarsBeforeWord = 0;
  for (let i = wordStartPos - 1; i >= 0 && lineBeforeCursor[i] === '$'; i--) {
    dollarsBeforeWord++;
  }

  // If there are $ characters before the current word, we're in variable expansion context
  if (dollarsBeforeWord > 0) {
    return true;
  }

  // Check for contexts where variables are commonly used (check original line, not trimmed)
  if (line === 'echo ' ||
        line === 'set -q ' ||
        line.startsWith('set ') && line.endsWith(' ')) {
    return true;
  }

  return false;
}
