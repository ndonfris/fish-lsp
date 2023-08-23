import {CompletionItem,  CompletionContext, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier, CompletionTriggerKind} from 'vscode-languageserver';
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
import { execCompleteGlobalDocs, execCompleteVariables, execCompletionHelper, execEscapedCommand } from '../src/utils/exec';
//import  from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { toLspDocument } from '../src/utils/translation';
import { homedir } from 'os';
import { FishCompletionItem, FishCompletionItemKind, toCompletionKindString } from '../src/utils/completion-strategy';
import { isBeforeCommand, isBlockBreak, isCommand, isCommandName, isScope, isSemicolon } from '../src/utils/node-types';
import { Node } from './mock-datatypes';
import { FishCompletionList } from '../src/completion-list';
import { getChildNodes,  getLeafs } from '../src/utils/tree-sitter';
import { isBuiltin } from '../src/utils/builtins';

let parser: Parser;
let workspaces: Workspace[] = []
let analyzer: Analyzer;
let completions: FishCompletionList;

setLogger(
    async () => {
        parser = await initializeParser();
        workspaces = await initializeDefaultFishWorkspaces()
        analyzer = new Analyzer(parser, workspaces);
        completions = await FishCompletionList.create()
    },
)

const spoofedPath = `${homedir()}/.config/fish/functions`

function noMock(filename: string){
    return filename.startsWith(spoofedPath) && filename.endsWith('.fish')
}

function getMockFile(filename: string){
    if (noMock(filename)) return filename
    const startIdx = filename.lastIndexOf('/') ===  -1 ? 0 : filename.lastIndexOf('/')
    const endIdx = filename.lastIndexOf('.fish') === -1 ? filename.length : filename.lastIndexOf('.fish')
    //console.log({startIdx, endIdx});
    const name = filename.slice(startIdx, endIdx)
    return `${spoofedPath}/${name}.fish`
}

function createContext(kind: CompletionTriggerKind, character?: string) : CompletionContext  {
    return { 
        triggerKind: kind,
        triggerCharacter: character,
    }
}

function mockAnalyzeCompletion(filename: string, ...lines: string[]){
    let path = getMockFile(filename)
    let content = lines.join('\n')
    const doc = toLspDocument(path, content)
    analyzer.analyze(doc);
    let pos = doc.getLineEnd(doc.lineCount)
    let node = analyzer.nodeAtPoint(doc.uri, pos.line, pos.character)!
    return {
        document: doc,
        position: { line: pos.line, character: pos.character + 1},
        analyzer: analyzer,
        node: node,
    }
}


const logArr = (items: SyntaxNode[]) => {
    type tableItem = {type: string, text: string, indexes: string}
    const table: tableItem[] = []
    items.forEach((v: SyntaxNode, i: number) => {
        table.push({type: v.type, text: v.text, indexes: `${v.startIndex}:::${v.endIndex}`});
    })
    console.table(table)
}

function runTestWithOutput(input: string, matchWord: string) {
    
    let {rootNode, lastNode, tokens, word} = completions.parseLine(input);
    //console.log("---".repeat(20));
    //console.log(`'${input}'`);
    //completions.parseLine(input);
    //let l : SyntaxNode = lastNode;
    //for (const child of getChildNodes(root)) {
    //    if (child.text.split(' ').length === 0) {
    //        l = child
    //    }
    //}
    //console.table();
    //const table: [string, string, string, string][] = []
    //const other = gatherLeafs(root)
    //const table: [string, string][] = logArr(tokens)
    //logArr(tokens)
    //logArr(leafs)
    //console.log(root.descendantForIndex(-1).text);
    //console.log(JSON.stringify({lastNode: lastNode.text, type: lastNode.type, word}, null, 2));
    assert.equal(word, matchWord)
    
}

describe('complete simple tests', () => {


    it('complete `set -lx var "asdf";`', async () => {
        const matchOutput = (inputStr: string, wordStr: string) => {
            let {rootNode, lastNode, tokens, word} = completions.parseLine(inputStr);
            assert.equal(word, wordStr)
        }

        const logOutput = (inputStr: string, matchStr: string) => {
            let {rootNode, lastNode, tokens, word} = completions.parseLine(inputStr);
            console.log(JSON.stringify({inputStr, matchStr, word}, null, 2));
        }
        matchOutput('    echo "a', '"a');
        matchOutput('    echo "a b', 'b');
        matchOutput('    echo "a b c"', 'c"');
        matchOutput('    echo "a b c";', ";");
        matchOutput('    echo "a b c"; ', ' ');
        matchOutput('    echo "a b c"; ls', 'ls');
        matchOutput('    echo "a b c"; ls && ', ' ');
        matchOutput('    echo "a b c"; ls && grep ', ' ');
        matchOutput('    echo "a b c"; ls && grep -e \'', '\'');
        matchOutput('    echo "a b c"; ls && grep -e "*', '"*');
        matchOutput('    return ', ' ');
        matchOutput('    i', 'i');
        matchOutput('    if', 'if');
        matchOutput('    if ', ' ');
        matchOutput('    if tes', 'tes');
        matchOutput('    if test ', ' ');
        matchOutput('    if test -', '-');
        matchOutput('    if test -n', '-n');
        matchOutput('    if test -n $', '$');
        matchOutput('    if test -n $a', '$a');
        matchOutput('    if test -n $argv', '$argv');
        matchOutput('    if test -n /path/$argv', '/path/$argv');
    })

    it('complete `set -lx var "asdf";`', async () => {
        const inputs: [string, string][] = [
            //['set -lx var (', '('],
            //['while test -f foo.txt; or test -f bar.txt; echo file exists; sleep 10; en', 'en'],     // notice while vs while_statement
            //['while test -f foo.txt; or test -f bar.txt; echo file exists; sleep 10; end', 'end'],
            //['if', ';'],
            //['else if', ';'],
            //['echo |', '|'],
            ['echo ', ''],
        ];
        inputs.forEach(( [input, match]: [string, string] ) => {
            const output = completions.getNodeContext(input);
            const {tokens} = completions.parseLine(input);
            const cmd = tokens[tokens.length-1]!;
            logArr(tokens.filter(n => isCommandName(n) || isBuiltin(n.text)))
            let  {conditionalNode, commandNode} = output;
            if (commandNode) {
                console.log('cmd', {text: commandNode.text, type: commandNode.type})
            }
            if (conditionalNode) {
                console.log('conditional',{text: conditionalNode.text, type: conditionalNode.type})
            }
            logArr(getChildNodes(output.rootNode))
            const values = Object.entries(output).filter(([k, v]) => v).map(([k, v]) => `${k}: \`${v!.text}\``)
            console.log(JSON.stringify({input, values, match}, null, 2));
            //assert.equal(output, match)
        })
    })
})

export namespace TestCompletionItem {

    export interface Item {
        label: string,
        kind: string,
        fishKind: string,
    }

    export function fromCompletion(cmp: FishCompletionItem) : Item {
        return {
            label: cmp.label,
            kind: toCompletionKindString[cmp.fishKind],
            fishKind: FishCompletionItemKind[cmp.fishKind],
        }
    }

    export function create(label: string, fishKind: FishCompletionItemKind ) : Item {
         return {
             label: label,
             kind: toCompletionKindString[fishKind], 
             fishKind: FishCompletionItemKind[fishKind],
        }
    }

    export function readable(item: FishCompletionItem){
        return {
            ...item,
            kind: toCompletionKindString[item.fishKind],
            fishKind: FishCompletionItemKind[item.fishKind],
        };
    }

    export function log(items: FishCompletionItem[], max: number = 5){
        items.forEach((item: FishCompletionItem, i: number) => {
            if (i < max) console.log(i, '::', readable(item), '\n');
        })
        console.log(`...`)
        console.log(`total items: ${items.length}`);
    }
}

export function getCompletionsViaPosition(analyzer: Analyzer, document: LspDocument, position: Position) {

    function backtrack(node: SyntaxNode, callback: (node: SyntaxNode) => boolean) {
        let current: SyntaxNode | null = node;
        while (current) {
            if (!current.previousSibling) {
                current = current.parent;
            }  else {
                current = current.previousSibling;
            }
            if (current && callback(current)) {
                return current;
            }

        }
        return null
    }

    const {line, word, lineRootNode, lineLastNode} = analyzer.parseCurrentLine(document, position);

    console.log('line', `'${line}'`);
    console.log('word', `'${word}'`);
    console.log('lineRootNode', `'${lineRootNode.text}'`);
    console.log('lineLastNode', `'${lineLastNode.text}'`);
    const cmdName = backtrack(lineLastNode, isCommand)
    const cmdBreak =  backtrack(lineLastNode, isSemicolon)
    const cmdScope =  backtrack(lineLastNode, (n) => isScope(n) || isBlockBreak(n))
    console.log('cmdName', `'${cmdName?.text}'`);
    console.log('cmdBreak', `'${cmdBreak?.text}'`);
    console.log('cmdScope', `'${cmdScope?.text}'`);

    console.log('lineLastNode', Node.debugSyntaxNode(lineLastNode));
    if (cmdName) {
        console.log('cmdName is true');
        console.log('cmdName', Node.debugSyntaxNode(cmdName));
        // cmp variables
        // cmp pipes
        // cmp status
        // cmp flags
        // dont cmp commands
        //
    } 

    if (cmdBreak) {
        console.log('cmdBreak is true');
        console.log('cmdBreak', Node.debugSyntaxNode(cmdBreak));
        // cmp commands
        // cmp builtins
    }

    if (cmdScope) {
        console.log('cmdScope is true');
        console.log('cmdScope', Node.debugSyntaxNode(cmdScope));
        // cmp commands
        // cmp builtins
    }

}


type NoNullFields<Ob> = { [K in keyof Ob]: Ob[K] extends object ? NoNullFields<Ob[K]> : NonNullable<Ob[K]> };
function logNonNull<T>(O: NoNullFields<T>) {
    console.log(JSON.stringify(O, null, 2));
}