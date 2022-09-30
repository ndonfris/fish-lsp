import {
    //resolveRelPath,
    resolveAbsPath,
    getRootNode,
    readShareDir,
    positionStr,
    readFishDir,
    startAnalyze,
    parseFile
} from './helpers'

import {getNodes, getNodeText, nodesGen} from '../src/utils/tree-sitter';
import {FishSyntaxNode} from '../src/utils/fishSyntaxNode';

import {initializeParser} from '../src/parser';
import {findParentCommand} from '../src/utils/node-types';
import {execCommandDocs, execCommandType, execCompleteCmdArgs, execCompleteSpace} from '../src/utils/exec';
import {SyntaxNode} from 'web-tree-sitter';
import {documentationHoverProvider, HoverFromCompletion} from '../src/documentation';


//
// string match -ra '.*' 'hi' -- $argv 
// should return 'string match'
//
// for strings without subcommands, returns just the command
//
//
async function getSubCommandString(cmdNode: SyntaxNode): Promise<string> {
    let cmdStr = cmdNode.child(0)!.text.trim()
    // check if subCommands completions exist 
    const spaceCmps = await execCompleteSpace(cmdStr)
    if (spaceCmps.length == 0) return cmdStr
    const cmdArr = cmdNode.text.split(' ').slice(1);
    var i = 0;
    while (i < cmdArr.length) {
        const argStr = cmdArr[i].trim();
        if (!argStr.startsWith('-') && spaceCmps.includes(argStr)) {
            cmdStr += ' ' + argStr.toString()
        } else if (argStr.includes('-')) {
            break;
        }
        i++
    }
    return cmdStr
}

function extractCmdNodeFlags(cmdNode: SyntaxNode, cmpFlags: string[]) {
    const cmdArr = cmdNode.text.split(' ').slice(1);
    if (cmdArr.length == 0) return 
    if (hasOldStyleOptions(cmpFlags)) {
        return cmdArr
            .filter(arg => arg.startsWith('-'))
            .map(arg => arg.split('=')[0])
    }
    const newArr: string[] = []
    for (const flag of cmpFlags) {
        if (flag.startsWith('-') && flag.length > 2) {
            const flags = 
                flag.split('').slice(1)
                .map(curr => curr = '-' + curr.toString())
            newArr.push(...flags)
        }
    }
    return newArr;    
}

/**
 * @see man complete: styles --> long options
 * enables the ability to differentiate between
 * short flags chained together, or a command 
 * that 
 * a command option like:
 *            '-Wall' or             --> returns true
 *            find -name '.git'      --> returns true
 *
 *            ls -la                 --> returns false
 * @param {string[]} cmpFlags - [TODO:description]
 * @returns {boolean} true if old styles are valid
 *                    false if short flags can be chained
 */
function hasOldStyleOptions(cmpFlags: string[]): boolean {
    for (const cmpFlag of cmpFlags) {
        if (cmpFlag.startsWith('--')) {
           continue;
        } else if (cmpFlag.startsWith('-') && cmpFlag.length > 2) {
            return true
        }
    }
    return false

}

async function generateCompletionFlags(cmpStr: string, cmd: SyntaxNode) {
    const res = await execCompleteCmdArgs(cmpStr);
    const flags = extractCmdNodeFlags(cmd, res)
    console.log(res)
    console.log(flags)
}


async function generateDocumentationFromComplete(node: SyntaxNode) {
    const cmd = findParentCommand(node)!; // string
    //const cmdText = cmd.child(1)!.text; // match
    var cmdText = await getSubCommandString(cmd);
    await generateCompletionFlags(cmdText, cmd)
    console.log()
    console.log()
    console.log(`cmdText: ${cmdText}`);
    //if (cmdArr.includes(cmdText)) {
    //    console.log(`\ntrue: cmdArray contains ${cmdText}`)
    //}
}

describe("fish syntax node output", () => {
    jest.setTimeout(7000)

    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });


    it('testing nodes if getNodeText() works', async () => {

        const uri = '/home/ndonfris/.config/fish/functions/set_random_color.fish'
        const tree = await parseFile(uri)

        const variableDefNodes = [
            tree.rootNode.namedDescendantForPosition({column: 14, row: 34}),
            tree.rootNode.namedDescendantForPosition({column: 12, row: 54}),
            tree.rootNode.namedDescendantForPosition({column: 44, row: 418}),
            tree.rootNode.namedDescendantForPosition({column: 22, row: 374}),
        ]

        const functionNodes = [
            tree.rootNode.namedDescendantForPosition({column: 9, row: 471}),
            tree.rootNode.namedDescendantForPosition({column: 9, row: 457}),
            tree.rootNode.namedDescendantForPosition({column: 0, row: 412}),
            tree.rootNode.namedDescendantForPosition({column: 0, row: 387}),
        ]

        const commandNodes = [
            tree.rootNode.namedDescendantForPosition({column: 4, row: 353}),
            tree.rootNode.namedDescendantForPosition({column: 4, row: 349}),
            tree.rootNode.namedDescendantForPosition({column: 4, row: 272})
        ]

        //for (const node of variableDefNodes) {
        //    console.log(`[${node.type}]: ${getNodeText(node)}`)
        //}

        //for (const node of functionNodes) {
        //    console.log(`[${node.type}]: ${getNodeText(node)}`)
        //}

        //for (const node of commandNodes) {
        //    console.log(`[${node.type}]: ${getNodeText(node)}`)
        //}   
        expect(true).toBeTruthy()
    })


    // variable definition vs variable 
    it('testing documentationResolver for subcommand args', async () => {

        const uri = '/home/ndonfris/.config/fish/functions/test-fish-lsp.fish'
        const tree = await parseFile(uri)

        //const nodes = getNodes(tree.rootNode)
        const commandNodes = [
            ...getNodes(tree.rootNode),
            tree.rootNode.descendantForPosition({row: 1, column: 4}),
            //tree.rootNode.namedDescendantForPosition({column: 11, row: 1}),
            //tree.rootNode.namedDescendantForPosition({column: 4, row: 349}),
            //tree.rootNode.namedDescendantForPosition({column: 4, row: 271})
        ]

        console.log('-----')
        for (const node of commandNodes) {
            const cmd = findParentCommand(node)!
            if (node.text == "string match -ra '.*' 'hi' -- echo") {
                const onode = node.child(2)!
                //const cmdType = await execCommandType('string match')
                console.log(onode)
                //const hovert = await execCommandDocs('string match')
                //if (hovert) console.log(hovert)
                const hoverProvider = new HoverFromCompletion(cmd, onode)
                const hover = await hoverProvider.generate()
                if (hover) console.log(hover.contents)
            }
            //const cmdText = cmd.child(1)!.text
            //const cmdArray = await execCompleteSpace(cmd.child(0)!.text)
            //for (const arg of cmdArray) {
            //}
            //console.log(`[${cmd.type}]: ${cmdText}`)
            //console.log(getNodeText(node))
            //console.log(`[${node.type}]: ${node.text}`)
        }   
        expect(true).toBeTruthy()
    })
})
