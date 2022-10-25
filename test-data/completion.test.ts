
import {execEscapedCommand} from '../src/utils/exec'
//import { buildGlobalAbbrs, buildGlobalAlaises, buildGlobalBuiltins, buildGlobalCommands, Completion } from '../src/completion'
import {parseFile} from './helpers';
import {CompletionItem} from 'vscode-languageserver';
import {buildDefaultCompletions} from '../src/completion';



jest.setTimeout(7000)

const jestConsole = console;

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
});

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
        buildDefaultCompletions()

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
        const file = '/home/ndonfris/.config/fish/functions/test-fish-lsp.fish'
        const tree = await  parseFile(file)
        //let completions = await Completion.initialDefaults()
        const root = tree.rootNode

        const completionSpots = [
            root.descendantForPosition({ column: 8, row: 13}),
            root.descendantForPosition({ column: 8, row: 12}),
            root.descendantForPosition({ column: 8, row: 11}),
            root.descendantForPosition({ column: 8, row: 10}),
            root.descendantForPosition({ column: 8, row: 9}),
            root.descendantForPosition({ column: 8, row: 8}),
        ]
        expect(true).toBeTruthy();
    })

})
