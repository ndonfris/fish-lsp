
import {execCommandDocs, execEscapedCommand} from '../src/utils/exec'
//import { buildGlobalAbbrs, buildGlobalAlaises, buildGlobalBuiltins, buildGlobalCommands, Completion } from '../src/completion'
import {resolveLspDocumentForHelperTestFile} from './helpers';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier} from 'vscode-languageserver';
import { BUILT_INS, createCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {resolve} from 'dns';
import {LspDocument} from '../src/document';
import { containsRange, getDefinitionSymbols} from '../src/workspace-symbol';
import {getNodeAtRange} from '../src/utils/tree-sitter';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';

let parser: Parser;
let analyzer: Analyzer;
let loggedAmount: number = 0;

function logColor(message: string = "", color?: string) {
    let idx = 0
    if (!color) {
        idx = loggedAmount % 6;
    } else {
        const colors = ['red', 'magenta', 'white', 'black', 'blue', 'yellow'];
        idx = colors.indexOf(color) || 0;
    }
    switch (idx) {
        case 0:
            console.log(message.red);
            break
        case 1:
            console.log(message.magenta);
            break
        case 2:
            console.log(message.white);
            break
        case 3:
            console.log(message.black);
            break
        case 4:
            console.log(message.blue);
            break
        case 5:
            console.log(message.yellow);
            break
    }
}

function getRootNodeToTextRange(root: SyntaxNode, range: Range): string {
    let text = root.text.split('\n').slice(0, range.start.line).join('\n')
    let output = '\n'
    const lines = text.split('\n')
    const lastLine = lines[lines.length - 1]
    for (const line of lines) {
        if (line === lastLine) {
            output += line.slice(0, range.start.character) + '•'
        } else {
            output += line
        }
        output+='\n'
    }
    return output
}

describe('complete simple tests', () => {
    const jestConsole = console;

    beforeEach(async () => {
        global.console = require('console');
        parser = await  initializeParser();
        analyzer = new Analyzer(parser);
    });

    afterEach(() => {
        global.console = jestConsole;
        parser.delete()
    });

    it('complete BUILT_INS ', async () => {
        //for (const cmp of BUILT_INS) {
        //    console.log(cmp.label);
        //}
        //console.log();
        //console.log();
    })

    it('complete defaults ', async () => {
        const emptyPosition : Position = {line: 0, character: 0};
        const cmps = createCompletionList([...BUILT_INS, ...BUILT_INS], emptyPosition, 0)
        //const str = await execCommandDocs('if');
        //console.log(str);
    })

    

    it('complete local symbols test', async () => {
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
        const root = parser.parse(doc.getText()).rootNode
        const cursorRanges :Range[] = [
            {
                start:{line: 4, character: 27},
                end:  {line: 4, character: 28}
            },
            {
                start:{line: 10, character: 2},
                end:  {line: 10, character: 4}
            },
            {
                start:{line: 25, character: 2},
                end:  {line: 25, character: 4}
            }
        ]

        //for (const cursorRange of cursorRanges) {
        //    const curr = getNodeAtRange(root, cursorRange);
        //    //const symbols: DocumentSymbol[] = flattenSymbols(getDefinitionSymbols(root))
        //    console.log(`current_text: ${getRootNodeToTextRange(root, cursorRange)}`.bgBlack)
        //    //logColor(`current_text: ${curr?.text}`);
        //    const symbols: DocumentSymbol[] = getNearbySymbols(root, cursorRange)

        //    const tbl : { selectionRange: string, range: string}[] = []
        //    for (const sym of symbols) {
        //        tbl.push({selectionRange: getNodeAtRange(root, sym.selectionRange)?.text || '', range: getNodeAtRange(root, sym.range)?.text || ''})
        //    }
        //    console.table(tbl);
        //    loggedAmount++;

        //}
    })

    it('testing analyzer completion', async () => {
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
        console.log(doc.getText().bgRed.white.bold);
        const params: CompletionParams = {
            textDocument:{
                uri: doc.uri
            } as TextDocumentIdentifier,
            position: {line: 0, character: 5},
        }
        analyzer.analyze(doc);
        const pos = params.position
        const currNode = analyzer.nodeAtPoint(doc, pos.line, pos.character - 1);
        const line: string = doc.getLineBeforeCursor(params.position)
        console.log(line);
        const currCommand = analyzer.commandAtPoint(doc, pos.line, line.trimEnd().length - 1)
        console.log(currCommand?.text);
        const word = analyzer.wordAtPoint(doc, pos.line, pos.character-1)
        console.log(word);
    })
})


