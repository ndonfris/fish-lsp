
import {execCompleteAbbrs, execCompleteVariables, execEscapedCommand} from '../src/utils/exec'



async function execComplete(cmd: string){
    let results = await execEscapedCommand(`complete --do-complete='${cmd} -'`)

    let i = 0;
    let fixedResults: string[] = [];
    while ( i < results.length) {
        const line = results[i]
        if (!line.startsWith('-', 0)) {
            //fixedResults.slice(i-1, i).join(' ')
            fixedResults.push(fixedResults.pop()?.trimEnd() + ' ' + line.trim())
        } else {
            fixedResults.push(line)
        }  
        i++;
    }
    console.log(fixedResults)
}

jest.setTimeout(7000)

const jestConsole = console;

beforeEach(() => {
    global.console = require('console');
});

afterEach(() => {
    global.console = jestConsole;
});

describe('complete simple tests', () => {

    it('test execEscapeCommand', async () => {
        let results = await execEscapedCommand('complete --do-complete="ls -"')
        //results.forEach(arg => console.log(arg))
    })

    it('test execCommand', async () => {
        let results = await execEscapedCommand('complete --do-complete="ls -"')
        //results.forEach(arg => console.log(arg))
    })

    it('test execCommand', async () => {
        let results = await execEscapedCommand('complete --do-complete="ls -"')

        let i = 0;
        let fixedResults: string[] = [];
        while ( i < results.length) {
            const line = results[i]
            if (!line.startsWith('-', 0)) {
                //fixedResults.slice(i-1, i).join(' ')
                fixedResults.push(fixedResults.pop()?.trimEnd() + ' ' + line.trim())
            } else {
                fixedResults.push(line)
            }  
            i++;
        }
        console.log(fixedResults)

        //const args = results
        //    .map(arg => arg.split('\t', 1))

        //args.forEach(result => console.log(result))
    })


    it('test allCompletions', async () => {
        //let results = await execEscapeCommand('functions | string split ", "')
        console.log(await execCompleteVariables())

        console.log(await execCompleteAbbrs())
        //results.forEach(command => {
        //    try {
        //        const result = execComplete(command.trim())
        //    } catch (err) {
        //        console.log(err)
        //    } finally {
        //        console.log
        //    }
        //})

        //results.forEach(result => console.log(result))
    })

})
