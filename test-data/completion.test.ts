import {resolveLspDocumentForHelperTestFile, TestLogger} from './helpers';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier} from 'vscode-languageserver';
import { BUILT_INS, createCompletionList, generateShellCompletionItems, getShellCompletions, workspaceSymbolToCompletionItem } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {resolve} from 'dns';
import {LspDocument} from '../src/document';
import { DocumentationCache, initializeDocumentationCache } from '../src/utils/documentationCache'
import { containsRange, getDefinitionSymbols, getNearbySymbols} from '../src/workspace-symbol';
import {getNodeAtRange, getRange} from '../src/utils/tree-sitter';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';
import { execCompleteGlobalDocs, execCompleteVariables, execCompletionHelper, execEscapedCommand } from '../src/utils/exec';
//import  from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

let parser: Parser;
let analyzer: Analyzer;
let loggedAmount: number = 0;
let cache : DocumentationCache 

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
        cache = await initializeDocumentationCache()
        analyzer = new Analyzer(parser, cache);
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
        //const cmps = createCompletionList([...BUILT_INS, ...BUILT_INS], emptyPosition, 0)
        //const str = await execCommandDocs('if');
        //console.log(str);
    })

    

    //it('complete local symbols test', async () => {
        //const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
        //const root = parser.parse(doc.getText()).rootNode
        //const cursorRanges :Range[] = [
            //{
                //start:{line: 4, character: 27},
                //end:  {line: 4, character: 28}
            //},
            //{
                //start:{line: 10, character: 2},
                //end:  {line: 10, character: 4}
            //},
            //{
                //start:{line: 25, character: 2},
                //end:  {line: 25, character: 4}
            //}
        //]
//
        ////for (const cursorRange of cursorRanges) {
        ////    const curr = getNodeAtRange(root, cursorRange);
        ////    //const symbols: DocumentSymbol[] = flattenSymbols(getDefinitionSymbols(root))
        ////    console.log(`current_text: ${getRootNodeToTextRange(root, cursorRange)}`.bgBlack)
        ////    //logColor(`current_text: ${curr?.text}`);
        ////    const symbols: DocumentSymbol[] = getNearbySymbols(root, cursorRange)
//
        ////    const tbl : { selectionRange: string, range: string}[] = []
        ////    for (const sym of symbols) {
        ////        tbl.push({selectionRange: getNodeAtRange(root, sym.selectionRange)?.text || '', range: getNodeAtRange(root, sym.range)?.text || ''})
        ////    }
        ////    console.table(tbl);
        ////    loggedAmount++;
//
        ////}
    //})

    //it('testing variable completions on string "set -l arg_one $" in symbols.fish [line:4]', async () => {
    //    const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
    //    const params: CompletionParams = {
    //        textDocument:{
    //            uri: doc.uri
    //        } as TextDocumentIdentifier,
    //        position: {line: 3, character: 20},
    //    }
    //    analyzer.analyze(doc);
    //    const pos = params.position
    //    const {line , lineRootNode, lineLastNode} = analyzer.parseCurrentLine(doc, pos)
    //    expect(line).toMatch('set -l arg_one $')
    //    expect(lineRootNode!.text).toMatch('set -l arg_one $')
    //    expect(lineLastNode!.text).toMatch('$')
    //    const [output, errors]: [CompletionItem[], CompletionItem[]] = [await generateShellCompletionItems(line, lineLastNode), []];
    //    for (const cmp of output) {
    //        if (!cmp.label.startsWith("\$")) {
    //            errors.push(cmp)
    //            console.log(JSON.stringify({errorCompletionItem: cmp}, null, 2));
    //        }
    //    }
    //    expect(errors.length).toBe(0)
    //})

    //it('testing flag completions on string "function func_c --" in symbols.fish [line:20]', async () => {
    //    const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
    //    const params: CompletionParams = {
    //        textDocument:{
    //            uri: doc.uri
    //        } as TextDocumentIdentifier,
    //        position: {line: 19, character: 18},
    //    }
    //    analyzer.analyze(doc);
    //    const pos = params.position
    //    const {line , lineRootNode, lineLastNode} = analyzer.parseCurrentLine(doc, pos)
    //    expect(line).toMatch('function func_c --')
    //    expect(lineRootNode!.text).toMatch('function func_c --')
    //    expect(lineLastNode!.text).toMatch('--')
    //    const [output, errors]: [CompletionItem[], CompletionItem[]] = [await generateShellCompletionItems(line, lineLastNode), []];
    //    for (const cmp of output) {
    //        if (!cmp.label.startsWith("--")) {
    //            errors.push(cmp)
    //            console.log(JSON.stringify({errorCompletionItem: cmp}, null, 2));
    //        }
    //    }
    //    expect(output.length).toBe(10)
    //    //expect(errors.length).toBe(0)
    //})

    //it('testing symbol completions in symbols.fish [line:20]', async () => {
    //    const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
    //    const params: CompletionParams = {
    //        textDocument:{
    //            uri: doc.uri
    //        } as TextDocumentIdentifier,
    //        position: {line: 22, character: 7},
    //    }
    //    analyzer.analyze(doc);
    //    const pos = params.position
    //    const {root, currentNode} = analyzer.parsePosition(doc, {
    //        line : pos.line,
    //        character: pos.character - 1,
    //    });
    //    const {line , lineRootNode, lineLastNode} = analyzer.parseCurrentLine(doc, pos)
    //    expect(line).toMatch(' ')
    //    expect(lineRootNode!.text).toMatch('')
    //    expect(lineLastNode!.text).toMatch('')
    //    const [output, errors]: [CompletionItem[], CompletionItem[]] = [workspaceSymbolToCompletionItem(root, getNearbySymbols(root, getRange(currentNode))),[]];
    //    for (const cmp of output) {
    //        console.log(cmp.label);
    //    }
    //})
    it("testing Documentation Cache", async () => {
        //console.time('test execCompletionHelper');
        const docCache = new DocumentationCache();
        await docCache.parse()
        //console.log(await docCache.resolve('PATH'));
        //console.log(await docCache.resolve('while'));
        //console.log(await docCache.resolve('get-completions'));
        //console.timeEnd('test execCompletionHelper')
    })


    it('testing line completions', async () => {
        const doc: LspDocument =  resolveLspDocumentForHelperTestFile('./fish_files/simple/symbols.fish');
        const position: Position = Position.create(0, 16)
        const logger = new TestLogger(console)
        const positions: Position[] = [
            Position.create(1, 1),
            Position.create(0, 16),
            Position.create(0, 32),
            Position.create(0, 26),
        ]
        positions.forEach((position) => { 
            const line = doc.getLineBeforeCursor(position).replace(/^(.*)\n$/, '$1')
            console.log(`line: *${line.toString()}*`);
            //let lastIndex = line.lastIndexOf("'");
            //const i = line.match(/^[\s|\S]*([\'.*\'|\".*\"|\w+])$/)
            //console.log(`i ${i?.toString()}`);
            //if (lastIndex === -1) {
                //lastIndex = line.lastIndexOf('"');
            //}
            //if (lastIndex === -1) {
                //lastIndex = line.lastIndexOf(' ');
            //}
            const lastWord = line.slice(line.lastIndexOf(" ")+1)
            console.log(`last word: *${lastWord}*`);
            //const root = parser.parse(line).rootNode;
            //console.log(`root: ${root.text}`);
            //logger.logNode(root);
            //console.log(root.firstChild!.descendantForIndex(-2)?.text);
            //console.log(root.toString())
        })
    })

})


