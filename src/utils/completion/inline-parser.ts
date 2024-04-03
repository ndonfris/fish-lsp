import { Position } from 'vscode-languageserver';
import { exec } from 'child_process';
import { promisify } from 'util';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../../document';
import { initializeParser } from '../../parser';
import { getChildNodes, getNamedChildNodes, getLeafs, getLastLeaf, ancestorMatch, firstAncestorMatch } from '../tree-sitter';
import { isCommand, isCommandName, isOption, isConditional, isString, isStringCharacter, isIfOrElseIfConditional, isUnmatchedStringCharacter, isPartialForLoop } from '../node-types';
import { FishCompletionItem } from './types';
//import { CompletionItemsArrayTypes, WordsToNotCompleteAfter } from './utils/completion-types';
//import { isBuiltin, BuiltInList, isFunction } from "./utils/builtins";
import { execCompleteLine } from '../exec';

export class InlineParser {
  private readonly COMMAND_TYPES = ['command', 'for_statement', 'case', 'function'];

  static async create() {
    const parser = await initializeParser();
    return new InlineParser(parser);
  }

  constructor(private parser: Parser) {
    this.parser = parser;
  }

  /**
     * returns a context aware node, which represents the current word
     * where the completion list is being is requested.
     *        ________________________________________
     *       |     line       |         word         |
     *       |----------------|----------------------|
     *       |    `ls -`      |         `-`          |
     *       |----------------|----------------------|
     *       |    `ls `       |        `null`        |
     *       -----------------------------------------
     */
  parseWord(line: string): {
    wordNode: SyntaxNode | null;
    word: string | null;
  } {
    if (line.endsWith(' ') || line.endsWith('(')) {
      return { word: null, wordNode: null };
    }
    const { rootNode } = this.parser.parse(line);
    //let node = rootNode.descendantForPosition({row: 0, column: line.length-1});
    //const node = getLastLeaf(rootNode);
    const node = getLastLeaf(rootNode);
    if (!node || node.text.trim() === '') {
      return { word: null, wordNode: null };
    }
    return {
      word: node.text.trim() + line.slice(node.endIndex),
      wordNode: node,
    };
  }

  /**
     * Returns a command SyntaxNode if one is seen on the current line.
     * Will return null if a command is needed at the current cursor.
     * Later will be useful to narrow down, which possible types of FishCompletionItems
     * should be sent to the client, based on the command.
     *  ───────────────────────────────────────────────────────────────────────────────
     *  • Some examples of the expected behavior can be seen below:
     *  ───────────────────────────────────────────────────────────────────────────────
     *    '', 'switch', 'if', 'while', ';', 'and', 'or',  ⟶   returns 'null'
     *  ───────────────────────────────────────────────────────────────────────────────
     *    'for ...', 'case ...', 'function ...', 'end ',  ⟶   returns 'command' node shown
     *  ───────────────────────────────────────────────────────────────────────────────
     */
  parseCommand(line: string) : {
    command: string | null;
    commandNode: SyntaxNode | null;
  } {
    const { word, wordNode } = this.parseWord(line.trimEnd());
    if (wordPrecedesCommand(word)) {
      return { command: null, commandNode: null };
    }
    const { virtualLine, maxLength } = Line.appendEndSequence(line, wordNode);
    const { rootNode } = this.parser.parse(virtualLine);
    const node = getLastLeaf(rootNode, maxLength);
    if (!node) {
      return { command: null, commandNode: null };
    }
    let commandNode = firstAncestorMatch(node, (n) => this.COMMAND_TYPES.includes(n.type));
    commandNode = commandNode?.firstChild || commandNode;
    return {
      command: commandNode?.text || null,
      commandNode: commandNode || null,
    };
  }

  parse(line: string): SyntaxNode {
    this.parser.reset();
    return this.parser.parse(line).rootNode;
  }

  getNodeContext(line: string) {
    const { word, wordNode } = this.parseWord(line);
    const { command, commandNode } = this.parseCommand(line);
    const index = this.getIndex(line);
    if (word === command) {
      return { word, wordNode, command: null, commandNode: null, index: 0 };
    }
    return {
      word,
      wordNode,
      command,
      commandNode,
      //last,
      //lastNode,
      index: index,
    };
  }

  lastItemIsOption(line: string): boolean {
    const { command } = this.parseCommand(line);
    if (!command) {
      return false;
    }

    const afterCommand = line.lastIndexOf(command) + 1;
    const lastItem = line.slice(afterCommand).trim().split(' ').at(-1);
    if (lastItem) {
      return lastItem.startsWith('-');
    }
    return false;
  }

  getLastNode(line: string): SyntaxNode | null {
    const { wordNode } = this.parseWord(line.trimEnd());
    //if (wordPrecedesCommand(word)) return {command: null, commandNode: null};
    const { virtualLine, maxLength } = Line.appendEndSequence(line, wordNode);
    const rootNode = this.parse(virtualLine);
    const node = getLastLeaf(rootNode);
    return node;
  }

  hasOption(command: SyntaxNode, options: string[]) {
    return getChildNodes(command).some(n => options.includes(n.text));
  }

  getIndex(line: string): number {
    const { commandNode } = this.parseCommand(line);
    if (!commandNode) {
      return 0;
    }
    if (commandNode) {
      const node = firstAncestorMatch(commandNode, (n) => this.COMMAND_TYPES.includes(n.type))!;
      const allLeafs = getLeafs(node).filter(leaf => leaf.startPosition.column < line.length);
      return Math.max(allLeafs.length - 1, 1);
    }
    return 0;
  }

  /**
    * here we will specifically populate the completion list with items specific to their
    * command & word context.
    * For example:
    * ••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••
    *     LINE      •   CONTEXTUAL INFO FROM LINE       •    ITEMS ADDED
    * ••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••
    *     `end `    •  {word: null, command: 'end'}     •   pipes
    * ••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••
    *    `printf "` •  {word: '"',  command: 'printf'}  •   format specifiers,
    *               •                                   •   strings, variables
    * ••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••
    */
  //getCompletionArrayTypes(line: string) {
  //    const {word, command, wordNode, commandNode} = this.getNodeContext(line)
  //    const result: CompletionItemsArrayTypes[] = []
  //    switch (command) {
  //        case 'functions': result.push(CompletionItemsArrayTypes.FUNCTIONS); break
  //        case 'end': result.push(CompletionItemsArrayTypes.PIPES); break
  //        case 'printf': result.push(CompletionItemsArrayTypes.FORMAT_SPECIFIERS); break
  //        case 'set': result.push(CompletionItemsArrayTypes.VARIABLES); break
  //        case 'function':
  //            //if (isOption(lastNode) && ['-e', '--on-event'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.FUNCTIONS);
  //            //if (isOption(lastNode) && ['-v', '--on-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
  //            //if (isOption(lastNode) && ['-V', '--inherit-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
  //            result.push(CompletionItemsArrayTypes.AUTOLOAD_FILENAME);
  //            break
  //        case 'return':
  //            result.push(CompletionItemsArrayTypes.STATUS_NUMBERS, CompletionItemsArrayTypes.VARIABLES);
  //            break
  //        default:
  //            result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.FUNCTIONS, CompletionItemsArrayTypes.PIPES, CompletionItemsArrayTypes.WILDCARDS, CompletionItemsArrayTypes.ESCAPE_CHARS)
  //            break
  //    }
  //    //if (isStringCharacter(lastNode)) result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.ESCAPE_CHARS)
  //    return result
  //}

  async createCompletionList(line: string): Promise<FishCompletionItem[]> {
    const result: FishCompletionItem[] = [];
    const { word, command, wordNode, commandNode } = this.getNodeContext(line);
    if (!command) {
      //result.push(items.allCo)
    }
    //const completionArrayTypes = this.getCompletionArrayTypes(line)
    //const completionData: FishCompletionData = {
    //    word, command, wordNode, commandNode, line
    //}
    //for (const arrayType of completionArrayTypes) {
    //    //result.push(...await createCompletionItem(arrayType, completionData))
    //}
    return result;
  }
}

/**
 * Checks input 'word' against lists of strings that represent fish shell tokens that
 * denote the next item could be a command. The tokens seen below, are mostly commands
 * that should be treated specially (to help determine the current completion context)
 *
 * @param {string | null} word - the current word which might not exists
 * @returns {boolean} - True if the word is a token that precedes a command.
 *                      False if the word is not something that precedes a command, (i.e. a flag)
 */
export function wordPrecedesCommand(word: string | null) {
  if (!word) {
    return false;
  }

  const chars = ['(', ';'];
  const combiners = ['and', 'or', 'not', '!', '&&', '||'];
  const conditional = ['if', 'while', 'else if', 'switch'];
  const pipes = ['|', '&', '1>|', '2>|', '&|'];

  return (
    chars.includes(word) ||
        combiners.includes(word) ||
        conditional.includes(word) ||
        pipes.includes(word)
  );
}

/**
 * Helper functions to edit lines in the ComletionList methods.
 */
export namespace Line {
  export function isEmpty(line: string): boolean {
    return line.trim().length === 0;
  }
  export function isComment(line: string): boolean {
    return line.trim().startsWith('#');
  }
  export function hasMultipleLastSpaces(line: string): boolean {
    return line.trim().endsWith(' ');
  }
  export function removeAllButLastSpace(line: string): string {
    if (line.endsWith(' ')) {
      return line;
    }
    return line.split(' ')[-1] || line;
  }
  export function appendEndSequence(
    oldLine: string,
    wordNode: SyntaxNode | null,
    endSequence: string = ';end;',
  ) {
    let virtualEOLChars = endSequence;
    let maxLength = oldLine.length;
    if (wordNode && isUnmatchedStringCharacter(wordNode)) {
      virtualEOLChars = wordNode.text + endSequence;
      maxLength -= 1;
    }
    if (wordNode && isPartialForLoop(wordNode)) {
      const completeForLoop = ['for', 'i', 'in', '_'];
      const errorNode = firstAncestorMatch(wordNode, (n) =>
        n.hasError,
      )!;
      const leafs = getLeafs(errorNode);
      virtualEOLChars =
                ' ' +
                completeForLoop.slice(leafs.length).join(' ') +
                endSequence;
    }
    return {
      virtualLine: [oldLine, virtualEOLChars].join(''),
      virtualEOLChars: virtualEOLChars,
      maxLength: maxLength,
    };
  }
}
