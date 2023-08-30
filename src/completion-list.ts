import { Position } from 'vscode-languageserver';
import { Analyzer } from './analyze'
import Parser, { SyntaxNode } from 'web-tree-sitter'
import { createCompletionItem, FishCompletionItem, FishCompletionItemKind, FishCompletionData } from './utils/completion-strategy';
import { LspDocument } from './document';
import { initializeParser } from './parser';
import { getChildNodes, getNamedChildNodes, getLeafs, getLastLeaf, ancestorMatch, firstAncestorMatch } from './utils/tree-sitter';
import { isCommand, isCommandName, isOption, isConditional, isString, isStringCharacter,  isIfOrElseIfConditional, isUnmatchedStringCharacter, isPartialForLoop, } from './utils/node-types';
import { CompletionItemsArrayTypes, WordsToNotCompleteAfter } from './utils/completion-types';
import { isBuiltin, BuiltInList, isFunction } from "./utils/builtins";

export class FishCompletionList {

    static async create() {
        const parser = await initializeParser();
        return new FishCompletionList(parser);
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
        const { rootNode } = this.parser.parse(line);
        const node = getLastLeaf(rootNode);
        if (!node || node.text.trim() === "") return { word: null, wordNode: null };
        return {
            word: node.text.trim(),
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
    parseCommand(line: string): SyntaxNode | null {
        const { word, wordNode } = this.parseWord(line);
        if (wordPrecedesCommand(word)) return null;
        let { virtualLine, maxLength } = Line.appendEndSequence(line, wordNode);
        const { rootNode } = this.parser.parse(virtualLine);
        let node = getLastLeaf(rootNode, maxLength);
        if (!node) return null;
        let command = firstAncestorMatch(node, (n) =>
            ["command", "for_statement", "case", "function"].includes(n.type)
        );
        return command?.firstChild || command;
    }

    getCompletionArrayTypes(line: string) {
        //const {rootNode, lastNode, prevNode, commandNode, conditionalNode} = this.getNodeContext(line)
        //const result: CompletionItemsArrayTypes[] = []
        ////console.log({lastNode: lastNode.text});
        //const command = commandNode ? commandNode.firstChild!.text : ''
        //switch (command) {
        //    case 'functions': result.push(CompletionItemsArrayTypes.FUNCTIONS); break
        //    case 'end': result.push(CompletionItemsArrayTypes.PIPES); break
        //    case 'printf': result.push(CompletionItemsArrayTypes.FORMAT_SPECIFIERS); break
        //    case 'set': result.push(CompletionItemsArrayTypes.VARIABLES); break
        //    case 'function':
        //        if (isOption(lastNode) && ['-e', '--on-event'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.FUNCTIONS);
        //        if (isOption(lastNode) && ['-v', '--on-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
        //        if (isOption(lastNode) && ['-V', '--inherit-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
        //        if (lastNode.text === 'function') result.push(CompletionItemsArrayTypes.AUTOLOAD_FILENAME);
        //        break
        //    case 'return': result.push(CompletionItemsArrayTypes.STATUS_NUMBERS, CompletionItemsArrayTypes.VARIABLES); break
        //    default:
        //        result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.FUNCTIONS, CompletionItemsArrayTypes.PIPES, CompletionItemsArrayTypes.WILDCARDS, CompletionItemsArrayTypes.ESCAPE_CHARS)
        //        break
        //}
        //if (isStringCharacter(lastNode)) result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.ESCAPE_CHARS)
        //return result
    }
}

export function wordPrecedesCommand(word: string | null) {
    if (!word) return false;

    let chars = ['(', ';']
    let combiners = ['and', 'or', 'not', '!', '&&', '||']
    let conditional = ['if', 'while', 'else if', 'switch']
    let pipes = ['|', '&', '1>|', '2>|', '&|']

    return (
        chars.includes(word)       ||
        combiners.includes(word)   ||
        conditional.includes(word) ||
        pipes.includes(word)
    )
}

export namespace Line {
    export function isEmpty(line: string): boolean {
        return line.trim().length === 0
    }

    export function isComment(line: string): boolean {
        return line.trim().startsWith('#')
    }

    export function hasMultipleLastSpaces(line: string): boolean {
        return line.trim().endsWith(' ')
    }
    export function removeAllButLastSpace(line: string): string {
        if (line.endsWith(' ')) return line
        return line.split(' ')[-1]
    }
    export function appendEndSequence(oldLine: string, wordNode: SyntaxNode | null, endSequence: string = ';end;') {
        let virtualEOLChars = endSequence
        let maxLength = oldLine.length
        if (wordNode && isUnmatchedStringCharacter(wordNode)) {
            virtualEOLChars = wordNode.text + endSequence
            maxLength -= 1
        }
        if (wordNode && isPartialForLoop(wordNode)) {
            const completeForLoop = ['for', 'i', 'in', '_']
            const errorNode = firstAncestorMatch(wordNode, n => n.hasError())!
            const leafs = getLeafs(errorNode)
            virtualEOLChars = ' ' + completeForLoop.slice(leafs.length).join(' ') + endSequence
        }
        return {
            virtualLine: [oldLine, virtualEOLChars].join(''),
            virtualEOLChars:  virtualEOLChars,
            maxLength: maxLength
        }
    }
}