
import {execEscapedCommand} from '../src/utils/exec'
//import { buildGlobalAbbrs, buildGlobalAlaises, buildGlobalBuiltins, buildGlobalCommands, Completion } from '../src/completion'
import {getDocument, parseFile} from './helpers';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {CompletionItem} from 'vscode-languageserver';
import {buildDefaultCompletions} from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';



jest.setTimeout(7000)

const jestConsole = console;

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
});

function printNodes(node: Parser.SyntaxNode) {
    console.log(node.toString())
    //node.children.forEach(child => {
    //    printNodes(child)
    //})
}

function trimLast(text: string) {
    return text.split(' ').slice(0, -1).join(' ').trimEnd()
}

function removeErrorText(parser: Parser, text: string) {
    //const regexStr = /\w+[.!?]?$/;
    let newText = text;
    let parsed = parser.parse(newText) 
    if (parsed.rootNode.isMissing() || parsed.rootNode.firstChild?.type === 'ERROR') {
        newText = trimLast(text);
        parsed = parser.parse(newText) 
    }
    //while (newRoot && newRoot.hasError()) {
    //    newText = trimLast(newText)
    //    if (newRoot != null) {printNodes(newRoot)}
    //    console.log(newRoot.hasError() + 'newRoot has error ' + newText)
    //    parsed = parser.parse(newText)
    //    newRoot = parsed.rootNode.firstChild
    //    parser.reset();
    //    parser.delete();
    //}
    //return parsed.rootNode
    //while (root.hasError() || root.text) {
    //    parsed = parser.parse(root.text.split(' ').slice(0, -1).join(' '))
    //    root = parsed.rootNode
    //}
    return TextDocument.create('file://line_without_error.fish', 'fish', 0, newText)
}

describe('complete simple tests', () => {

    //it('startup time', async () => {
    //    var start = new Date().getTime();

    //    const completions = await Completion.initialDefaults()
    //    var end = new Date().getTime();
    //    var time = ((end - start) / 1000).toFixed(5);
    //    console.log(`completion took ${time.toString()}(s) to start`)
    //    expect(completions !== null).toBeTruthy()
    //})

    //it('startup time', async () => {
    //    const completions = new Completion();
    //    const line = 'ech'
    //    await completions.generateLineCompletion('ech');
    //    const cmd = line.replace(/(['$`\\])/g, '\\$1')
    //    console.log(cmd)
    //    for (const c of completions.lineCmps) {
    //        console.log(c.label);
    //    }
    //    //console.log(c)
    //    expect(completions.lineCmps).toBeTruthy()
    //})
    //it('test execEscapeCommand', async () => {
    //    let results = await execEscapedCommand('complete --do-complete="ls -"')
    //    //results.forEach(arg => console.log(arg))
    //})

    it('build escapeChars', async () => {
         //buildDefaultCompletions()

        //results.forEach(arg => console.log(arg))
        expect(true).toBeTruthy()
    })

    //it('test execCommand', async () => {
    //    let results = await execEscapedCommand('complete --do-complete="ls -"')

    //    let i = 0;
    //    let fixedResults: string[] = [];
    //    while ( i < results.length) {
    //        const line = results[i]
    //        if (!line.startsWith('-', 0)) {
    //            //fixedResults.slice(i-1, i).join(' ')
    //            fixedResults.push(fixedResults.pop()?.trimEnd() + ' ' + line.trim())
    //        } else {
    //            fixedResults.push(line)
    //        }  
    //        i++;
    //    }
    //    console.log(fixedResults)

    //    //const args = results
    //    //    .map(arg => arg.split('\t', 1))

    //    //args.forEach(result => console.log(result))
    //})


    it('test allCompletions', async () => {
        //const file = '/home/ndonfris/.config/fish/functions/test-fish-lsp.fish'
        let document = TextDocument.create(
            'file://error.fish', 
            'fish',
            0, 
            `string match --regex '.*' '$[[`
        )
        const errStrings = [
            `if string match --regex '.*' '$[[`,
            `string match --regex '.*' '$[[`,
            `string match '.*'`
        ]
        //console.log(trimLast(document.getText()))
        for (const errString of errStrings) {
            const parser = await initializeParser()
            document = removeErrorText(parser, errString)
            parser.reset();
            console.log("----------------------")
            console.log("input: \"" + errString +'"\noutput: "' + document.getText() + '"')
            console.log("----------------------")
            expect(1).toBeTruthy();
        }
    })

})
