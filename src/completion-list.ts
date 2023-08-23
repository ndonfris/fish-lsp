import { Position } from 'vscode-languageserver';
import { Analyzer } from './analyze'
import Parser, { SyntaxNode } from 'web-tree-sitter'
import { createCompletionItem, FishCompletionItem, FishCompletionItemKind, FishCompletionData } from './utils/completion-strategy';
import { LspDocument } from './document';
import { initializeParser } from './parser';
import { getChildNodes, getNamedChildNodes, getLeafs } from './utils/tree-sitter';
import { isCommand, isCommandName, isOption, isConditional, isString, isStringCharacter,  isIfOrElseIfConditional, } from './utils/node-types';
import { CompletionItemsArrayTypes, WordsToNotCompleteAfter } from './utils/completion-types';
import { isBuiltin, BuiltInList } from "./utils/builtins";

export type ParsedLine = {
    rootNode: SyntaxNode,
    lastNode: SyntaxNode,
    tokens: SyntaxNode[],
    word: string,
    //words: string[],
}

export class FishCompletionList {
    static async create() {
        const parser = await initializeParser();
        return new FishCompletionList(parser)
    }

    constructor(private parser: Parser) {
        this.parser = parser 
    }

    parseLine(line: string): ParsedLine {
        const { rootNode } = this.parser.parse(line)

        const allNodes = getLeafs(rootNode)
        //let allNodes: SyntaxNode[] = getChildNodes(rootNode)
        //    .filter(n => n.text !== '' && !n.hasError())

        let lastNode = allNodes[allNodes.length - 1] ||
            rootNode.descendantForPosition({row: 0, column: line.length-1})

        let word =
            line.length === lastNode.endIndex
                ? lookbackExpandNonsplitToken(lastNode).text
                : line.slice(lastNode.startIndex)

        const splitWord = word.split(/(\s+)/).filter(s => s !== '')
        return {
            rootNode,
            lastNode,
            tokens: allNodes,
            word: splitWord.length <= 1  ? word : splitWord[splitWord.length - 1]
        };
    }

    getNodeContext(line: string): {
        rootNode: SyntaxNode,
        lastNode: SyntaxNode,
        prevNode?: SyntaxNode | null,
        commandNode?: SyntaxNode | null,
        conditionalNode?: SyntaxNode | null,
    }{
        let { rootNode, lastNode, tokens } = this.parseLine(line)

        if (WordsToNotCompleteAfter.includes(lastNode.text)) return {rootNode, lastNode}

        lastNode = lookbackExpandNonsplitToken(lastNode)
        let parent = lastNode.parent
        console.log({lastNode: lastNode.type, parent: parent!.type});

        let commandNode = getCommand(tokens)
        //let conditionalNode = commandNode && commandNode.parent
        //    ? isIfOrElseIfConditional(commandNode.parent) ? commandNode.parent : null
        //    : parent && isIfOrElseIfConditional(parent) ? parent : null
        let conditionalNode = getConditionalStatement(tokens)

        return {
            rootNode,
            lastNode,
            prevNode: lastNode.previousSibling,
            commandNode,
            conditionalNode,
        }
    }

    getCompletionArrayTypes(line: string) {
        const {rootNode, lastNode, prevNode, commandNode, conditionalNode} = this.getNodeContext(line)
        const result: CompletionItemsArrayTypes[] = []

        console.log({lastNode: lastNode.text});
        const command = commandNode ? commandNode.firstChild!.text : ''
        switch (command) {
            case 'functions': result.push(CompletionItemsArrayTypes.FUNCTIONS); break
            case 'end': result.push(CompletionItemsArrayTypes.PIPES); break
            case 'printf': result.push(CompletionItemsArrayTypes.FORMAT_SPECIFIERS); break
            case 'set': result.push(CompletionItemsArrayTypes.VARIABLES); break
            case 'function': 
                if (isOption(lastNode) && ['-e', '--on-event'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.FUNCTIONS);
                if (isOption(lastNode) && ['-v', '--on-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
                if (isOption(lastNode) && ['-V', '--inherit-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
                if (lastNode.text === 'function') result.push(CompletionItemsArrayTypes.AUTOLOAD_FILENAME);
                break
            case 'return': result.push(CompletionItemsArrayTypes.STATUS_NUMBERS, CompletionItemsArrayTypes.VARIABLES); break
            default:
                result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.FUNCTIONS, CompletionItemsArrayTypes.PIPES, CompletionItemsArrayTypes.WILDCARDS, CompletionItemsArrayTypes.ESCAPE_CHARS)
                break
        }

        if (isStringCharacter(lastNode)) result.push(CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.ESCAPE_CHARS)


        return result
    }

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
}

class CompletionLineQueue {

    private _items: string[] = []
    
    enqueue(line: string) {
        this._items.push(line)
    }

    dequeue(): string | undefined {
        return this._items.shift()
    }

    isEmpty(): boolean {
        return this._items.length === 0
    }

    peek(): string | undefined {
        return this._items[0]
    }
}

function checkLastNode(node: SyntaxNode) {
    if (node.text === '') return node.previousSibling
    return node
}
function getConditionalStatement(tokens: SyntaxNode[]) {
    const [first, second, ...other] = tokens
    if (first.type === 'if') return first
    if (first.type === 'else' && second.type === 'if') return first
    if (first.type === 'while') return first
    return null
}

function isConditionalStatement(first: SyntaxNode | null, second: SyntaxNode | null) {
    if (first && ['while', 'if', 'else'].includes(first.text) ) return true
    if (first && second) return first.text === 'else' && second.text === 'if';
    return false
}

function getCommand(tokens: SyntaxNode[]) {
    const notCommand = (n: SyntaxNode | null) => {
        if (!n) return true
        return [
            ";",
            "(",
            "{",
            "|",
            "&",
            ">",
            ">>",
            "<",
            "&|",
            "&&",
            "||",
        ].includes(n.type);
    }

    let prev = tokens[tokens.length-1] 
    for (let i = tokens.length - 1; i >= 0; i--) {
        let curr = tokens[i]
        if (
            notCommand(curr) ||
            isConditionalStatement(curr, prev) ||
            ["and", "or", "!", "not"].includes(curr.text)
        ) {
            return null;
        }
        if (isOption(curr)) continue
        if (isCommandName(curr) || isBuiltin(curr.text)) return curr
        prev = curr
    }
    //let current: SyntaxNode | null = last.parent || last
    //while (current) {
    //    if (notCommand(current)) return null;
    //    if (current && isCommand(current)) return current
    //    current = current.parent
    //}
    return null
}

/**
 * ---------------------------------------------------------------------------------------
 * line                         param node.text                 return node.text
 * ---------------------------------------------------------------------------------------
 * ls /path/$argv               'argv'                        /path/$argv
 * ls "inner"                    " (2nd quote)                "inner"
 * ------------------------------------------------------------------------------------
 * search the lastNode for a ParsedLine object, and expand it if the current node's 
 * parent is a character sequence that does not have spaces in it. This behavior is
 * excluded for a string character token.
 *
 * @param {SyntaxNode} node - the lastNode for a parsedLine
 * @returns {SyntaxNode} - this or a parent node 
 */
function lookbackExpandNonsplitToken(node: SyntaxNode) {
    let current: SyntaxNode | null = (isStringCharacter(node) && node.parent && isString(node.parent)) ? node.parent : node; 
    while (current) {
        if (current.parent && current.parent.text.split(' ').length > 1) return current
        current = current.parent
    }
    return node
}