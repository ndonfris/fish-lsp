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

    parseWord(line: string) : {
        wordNode: SyntaxNode | null,
        word: string | null,
    } {
        const { rootNode } = this.parser.parse(line)
        const node = getLastLeaf(rootNode)
        if (!node || node.text.trim() === '') {
            return { word: null, wordNode: null}
        }
        return {
            word: node.text.trim(),
            wordNode: node,
        }
    }

    parseCommand(line: string) {
        const { word, wordNode } = this.parseWord(line);
        if (wordPrecedesCommand(word)) return null
        let {virtualLine, maxLength } =  Line.appendEndSequence(line, wordNode)
        const { rootNode } = this.parser.parse(virtualLine)
        //let maxIndex = line.length
        let node = getLastLeaf(rootNode, maxLength)
        if (!node) return null
        let command = firstAncestorMatch(node, n => ['command', 'for_statement', 'case', 'function'].includes(n.type))
        return command?.firstChild || command
    }

    //needsCommand(line: string) {
    //    const fixedLine = `${line}`
    //    //const { rootNode } = this.parser.parse(fixedLine)
    //
    //    console.log(`line: '${line}'`);
    //    const {root, leafs} = findFix(line, this.parser)
    //    console.log(root.toString());
    //    leafs.forEach((c: SyntaxNode, i: number) => {
    //        console.log(i, `text: '${c.text}'`, `type: '${c.type}'`, `${c.startPosition.row}, ${c.startPosition.column} - ${c.endPosition.row}, ${c.endPosition.column}`);
    //    })
    //    console.log('line.length', line.length);
    //    console.log();
    //    //let first = children[0]
    //    //while (first.parent !== null) {
    //    //    first = first.parent
    //    //}
    //    //console.log(first.toString());
    //
    //    //let children = getLeafs(rootNode)
    //    //children = children.slice(0, children.length - 4)
    //    //const focusedNode = children[children.length - 1]
    //    //console.log();
    //    //console.log(rootNode.toString());
    //    //console.log('line: ', `'${line}'`, `fixedLine: '${fixedLine}'`);
    //    //children.forEach((c) => {
    //    //    console.log('text', `"${c.text}"`, 'isCommandName', `"${isCommandName(c)}"`);
    //    //})
    //    //let lastNode = rootNode.descendantForPosition({row: 0, column: line.length - 1})!
    //    //console.log('lastNode', `'${lastNode.text}'`, `${lastNode.toString()}`);
    //    //console.log('focusedNode', `'${focusedNode.text}'`, `, commandName: ${isCommandName(focusedNode)}`, `${focusedNode.toString()}`);
    //
    //    //console.log(rootNode.toString());
    //    //console.log(rootNode.hasError() ? 'rootNode.hasError() -> true' : 'NO ERROR');
    //    //console.log(rootNode.isMissing() ? 'rootNode.isMissing() -> true' : 'NO MISSING');
    //    //console.log('lastNode', `'${lastNode.text}'`, `${lastNode.toString()}`);
    //    //console.log();
    //}

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
        //console.log({lastNode: lastNode.type, parent: parent!.type});

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

        //console.log({lastNode: lastNode.text});
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

export function wordPrecedesCommand(word: string | null) {
    if (!word) return false;

    let chars = ['(', ';']
    let combiners = ['and', 'or', 'not', '!', '&&', '||']
    let conditional = ['if', 'while', 'else if', 'switch']
    let pipes = ['|', '&', '1>|', '2>|', '&|']

    return (chars.includes(word)
        || combiners.includes(word)
        || conditional.includes(word)
        || pipes.includes(word))
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


// fixParse get matching trees for addToStartOfLine and addToEndOfLine:
//      
function fixParse(line: string, addToStartOfLine: string, addToEndOfLine: string, parser: Parser): {root: SyntaxNode, leafs: SyntaxNode[]} {
    let fixedLine = addToStartOfLine + line + addToEndOfLine
    let {rootNode} = parser.parse(fixedLine)
    if (addToStartOfLine.trim() !== '') {
        rootNode = rootNode.descendantsOfType(line.split(' ')[0])[0].parent!
    }
    if (addToEndOfLine.trim() === '') {
        return {root: rootNode, leafs: getLeafs(rootNode)}
    }
    //const addedRoot = parser.parse(addToEndOfLine).rootNode
    rootNode = rootNode.type === 'program' ? rootNode.firstChild! : rootNode
    return {root: rootNode, leafs: getLeafs(rootNode).filter(c => c.startPosition.column < addToStartOfLine.length + line.length) }
}

function findAddToStartStr(line: string) {
    if (line.startsWith('else')) return 'if true;'
    if (line.startsWith('case')) return 'switch $argv;'
    return ''
}

function parseRootNode(line: string, start: string, end: string, parser: Parser): SyntaxNode {
    let checkLine = start + line + end
    if (start != '') return parser.parse(checkLine).rootNode.lastChild!.parent!
    return parser.parse(checkLine).rootNode
}

function findFix(line: string, parser: Parser): {root: SyntaxNode, leafs: SyntaxNode[]} {
    let startFix = findAddToStartStr(line)
    const fixes = [
        ";",
        ")",
        ");",
        '";',
        "';",
        " true;end;",
        ";end;",
        '";end;',
        "';end;",
        '\*; end;',
        " true);end;",
        " true)",
        " i in $argv;end;",
        " in $argv;end;",
        " $argv;end;",
        "i in $argv;end;",
        "in $argv;end;",
        "n $argv;end;",
        "$argv;end;",
        " head; end;",
    ];
    let endFix =  ""
    let rootNode = parseRootNode(line, startFix, endFix, parser)
    while (rootNode.hasError()) {
        endFix = fixes.shift() || ""
        rootNode = parseRootNode(line, startFix, endFix, parser)
        if (endFix === '') break;
    }
    return fixParse(line, startFix, endFix, parser)
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
        if (isFunction(curr.text) || isCommandName(curr) || isBuiltin(curr.text)) return curr
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