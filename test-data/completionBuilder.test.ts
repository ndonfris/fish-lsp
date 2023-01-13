






import { getShellCompletions  } from "../src/completion";
import { FishCompletionItem, parseLineForType  } from "../src/utils/completionBuilder";
import { exec } from 'child_process'
import { promisify } from 'util';
//import { CompletionItem, CompletionItemKind, CompletionList, CompletionTriggerKind, Position, Range } from 'vscode-languageserver';

const promiseAsync = promisify(exec)



function printArgs(label: string, keyword: string, otherInfo: string) {
    console.log(`-------------------------------------------------------------------`)
    //if (keyword === undefined && otherInfo == undefined) {
    //    console.log(`label: '${label}'`)
    //} else if (!otherInfo) {
    //    console.log(`label: '${label}'\nkeyword: '${keyword}'`)
    //} else {
    //}
    console.log(`label: '${label}'\nkeyword: '${keyword}'\notherInfo: '${otherInfo}'`)
    console.log(`-------------------------------------------------------------------`)
}


//
//function splitArray(label: string, description?: string): [string, string, string] {
//    let keyword = "";
//    let otherInfo = "";
//    if (description != undefined) {
//        const [first, rest] = description.split(/[:|\s+(.*)]/);
//        keyword = first.toLowerCase();
//        otherInfo = rest || "";
//    }
//    //console.log(`label: ${label} keyword: ${keyword} otherInfo: ${otherInfo}`)
//    return [label, keyword, otherInfo]
//}
//
//
//async function getCmp(cmd: string): Promise<[string, string, string][]> {
//    const entireCommand = `fish --command 'complete --do-complete="${cmd}" | uniq'`
//    const terminaOut = await promiseAsync(entireCommand)
//    return terminaOut.stdout.trim()
//        .split('\n').map(line => {
//        const [label, desc] = line.split('\t')
//        return splitArray(label, desc);
//    })
//}

describe('complete simple tests', () => {

    //it('startup time', async () => {
    //    var start = new Date().getTime();

    //    const completions = await Completion.initialDefaults()
    //    var end = new Date().getTime();
    //    var time = ((end - start) / 1000).toFixed(5);
    //    console.log(`completion took ${time.toString()}(s) to start`)
    //    expect(completions !== null).toBeTruthy()
    //})



    it('startup time', async () => {
        const line = "gfft    Abbreviation: git flow feature track"
        const cmp = "ff"
        const outArr = await getShellCompletions(cmp)
        //type outPut = [string, string?, string?]
        //const newArr = []
        for (const out of outArr) {
            //const descItems = out[1].split(' ', 1)
            //console.log(out)
            //if (out)
            //console.log(out[1])
            //console.log(...out)
            printArgs(...out)
        }
        expect(line).toBeTruthy()
    })
})

