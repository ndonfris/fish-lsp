import {CompletionItem,  CompletionContext, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier, CompletionTriggerKind, CompletionItemKind} from 'vscode-languageserver';
import { assert } from 'chai'
//import { generateCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {LspDocument} from '../src/document';
import { DocumentationCache, initializeDocumentationCache } from '../src/utils/documentationCache'
import { containsRange, findDefinitionSymbols, } from '../src/workspace-symbol';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';
import { setLogger } from './helpers'
import { execCmd, execCompleteGlobalDocs, execCompleteVariables, execCompletionHelper, execEscapedCommand } from '../src/utils/exec';
//import  from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { toLspDocument } from '../src/utils/translation';
import { homedir } from 'os';
import { FishCompletionItem, FishCompletionItemKind, toCompletionKindString } from '../src/utils/completion-strategy';
import { isBeforeCommand, isBlockBreak, isCommand, isCommandName, isPartialForLoop, isScope, isSemicolon } from '../src/utils/node-types';
import { Node } from './mock-datatypes';
import { FishCompletionList } from '../src/completion-list';
import { getChildNodes,  getLeafs } from '../src/utils/tree-sitter';
import { AbbrList, EventNamesList, FunctionNamesList, GlobalVariableList, isBuiltin, isFunction } from '../src/utils/builtins';
import { createShellItems, findShellPath, ShellItems, spawnSyncRawShellOutput } from '../src/utils/startup-shell-items';

let parser: Parser;
let workspaces: Workspace[] = []
let analyzer: Analyzer;
let completions: FishCompletionList;
//let items: ShellItems;

setLogger(
    async () => {
        parser = await initializeParser();
        //workspaces = await initializeDefaultFishWorkspaces()
        analyzer = new Analyzer(parser);
        completions = await FishCompletionList.create()
    },
    async () => {
    }
)

describe('complete simple tests', () => {

    it('testing edits to completionLine, to find commands";`', async () => {
        const inputs: string[] = [
            'echo',
            'ls -',
            'if',
            'if t',
            'if [',
            'if test',
            'if (a',
            'printf "',
            'for _',
            'for i in',
        ];
        type tblItem = {input: string, addChar: string, hasCmd: boolean, cmd: string, lineNodes: string} 
        const buildTable = (addChar: string) => {
            console.log("LOGGING WHAT HAPPENS WHEN CHAR ADDED TO LINE IS : ", `'${addChar}'`);
            const tbl: tblItem[] = []
            inputs.forEach( (input: string) => {
                const {rootNode} = parser.parse(input + addChar)
                let cmd = rootNode.descendantsOfType('command')
                let firstCmd = cmd.at(0)?.text || 'NULL'
                let hasCmd = cmd.length > 0
                tbl.push({input, addChar, hasCmd: hasCmd, cmd: firstCmd, lineNodes: rootNode.toString()})
            })
            console.table(tbl);
        }
        //buildTable('-')
        buildTable(';')
        buildTable(';end;')
    }, 1000)

    it('complete AllShellItems";`', async () => {
        type tblItem = {input: string, cmd: string, word: string} 
        const tbl: tblItem[] = [];

        [
            'echo ',
            'ls',
            'ls ',
            'ls -',
            'if',
            'if ',
            'if t',
            ';',
            'if [',
            'if test',
            'if (a',
            'printf "',
            '',
            'for',
            'for ',
            'for i',
            'for i ',
            'for i in',
            'while',
            'while (',
            'while ()',
            'echo "hi" > ',
            'function',
            'else if',
            'else',
            'case',
            'case ',
            "case '*",
            'end',
            'ls |',
            'not',
            'and',
            'or ',
            'if test -f file.txt; and test -f file2.txt; or ',
        ].forEach((input: string) => {
            const {word} = completions.parseWord(input);
            const cmd = completions.parseCommand(input);
            tbl.push({input: input, cmd: cmd?.text || 'NULL', word: word || 'NULL'})
        })

        console.table(tbl);
    }, 1000)
})


function runTest(input: string, parser: Parser) {
    function parseRoot(start: string, text: string, end: string) {
        let {rootNode} = parser.parse(start + text + end);
        if (start.length > 0) {
            //console.log('text', text, 'node', rootNode.toString());
            const result = rootNode.descendantsOfType(skipStartDescendantType(start, text))[0]!
            return result.parent || result
        }
        return rootNode
    }

    function skipStartDescendantType(start: string, text: string) {
        if (start.startsWith('if')) return 'else' 
        if (start.startsWith('switch')) return 'case'
        return 'name'
    }

    let start = input.startsWith('else') 
        ? `if 1;` 
        : input.startsWith('case') ? `switch 1;` : ''

    let text = input.endsWith(' ') ? input : input + ' '

    let rootNode = parser.parse(start + text).rootNode

    let endFixes = ['', '"', "'", '_', '\*',  ']', ')', '}', 'true', '$argv', 'in _', 'i in _']

    while (endFixes.length > 0) {
        if (!rootNode.hasError()) break;
        const addToEnd = endFixes.shift()!
        let [end1, end2, end3] = [addToEnd, `${addToEnd};`, `${addToEnd};end;`]
        let [root1, root2, root3] = [
            parseRoot(start, text, end1),
            parseRoot(start, text, end2),
            parseRoot(start, text, end3),
        ];
        if (!root1.hasError()) {rootNode = root1; break}
        if (!root2.hasError()) {rootNode = root2; break}
        if (!root3.hasError()) {rootNode = root3; break}
    }

    rootNode = rootNode.type === 'program' ? rootNode.firstChild! || rootNode : rootNode
    const leafs = getLeafs(rootNode).filter((v: SyntaxNode) => v.startPosition.column < start.length + input.length) || [] as SyntaxNode[]
    console.log(
        JSON.stringify(
            {
                line: input,
                text: rootNode.text,
                //lastNode: leafs[leafs.length-1]?.parent ? leafs[leafs.length-1]?.parent?.text + ',str: ' + leafs[leafs.length-1]?.parent?.toString() : '',
                lastNode: leafs[leafs.length-1] ? leafs[leafs.length-1]?.text + ',str: ' + leafs[leafs.length-1]?.toString() : '',
                str: rootNode.toString(),
                leafs: leafs.map((l) => `\`${l.text}\` ${l.type} ${l.startPosition.column}`),
            }, null, 2)
    );
}