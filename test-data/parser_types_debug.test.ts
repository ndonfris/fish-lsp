import {readFileSync, readdirSync} from 'fs';
import path, {resolve} from 'path'
import {TextDocument} from 'vscode-languageserver-textdocument';
import { SyntaxNode } from 'web-tree-sitter'
import * as Parser from 'web-tree-sitter'
import {initializeParser} from '../src/parser';
import {
    //nodesGen,
    //isStatement,
    getChildrenArray,
} from '../src/utils/tree-sitter'
import {
    isStatement
} from '../src/contexts'
import {
    getRandomNodeMatches,
    getRandomNodeType,
    //resolveRelPath,
    resolveAbsPath,
    nodeToString,
    getRootNode

} from './helpers'
import {getAllFunctionLocations, getAllShareLocations, getLargeShareFunctionFiles, getRandomShareFunctionFile} from './fish_share_files';
//import {
//  execFishCommand,
//  execFishType,
//  execFishDocumentation,
//  resolveAllFishAbbr,
//  resolveAllFishBuiltins,
//  resolveFishFunctionPath,
//} from "../utils/exec";
                        


//function allFishFiles(subDirName: string) {
//    const files = readdirSync(`${__dirname}/${subDirName}`)
//    return files.map(str => 
//        fish_share_func_location.concat(str)
//    )
//}

//function buildTextDocument(input_name: string) {
//    const text = readFileSync(input_name, 'utf8');
//
//    const uri = 'file:///' + input_name;
//
//    return {
//        uri: uri,
//        td: TextDocument.create(uri, 'fish', 1, text)
//    }
//}


function constructFileNodes(root: SyntaxNode): SyntaxNode[]{
    return [...getChildrenArray(root)];
}

function getNamedNodesArray(root: SyntaxNode): SyntaxNode[] {
    let queue: SyntaxNode[] = [root]
    let result: SyntaxNode[] = []

    while (queue.length) {
        let current : SyntaxNode | undefined = queue.pop();
        if (current && current.namedChildCount > 0) {
            result.push(current)
            queue.unshift(...current.namedChildren.filter(child => child))
        } else if (current && current.childCount > 0){
            result.push(current)
            //queue.unshift(...current.children)
        } else {
            continue
        }
    }
    return result.filter(child => child)
}

// guess -> the guesses amount at the start of lines from random generator.
// actual -> the amount the parser found. 
interface randomTestResult {
    guess: number
    actual: number
}

async function singleRandomTest(fname: string) : Promise<randomTestResult> {
    const usrShareFile = await resolveAbsPath(fname)
    const tree = await getRootNode(fname)
    const namedNodes = getNamedNodesArray(tree)
    const randomType = getRandomNodeType();
    const randomsFound = (await getRandomNodeMatches(fname, randomType)).length
    const nodesFound = namedNodes.filter(node => (node.text.startsWith(randomType))).length
    console.log(`\nnode ====>>>> ${randomType}`)
    console.log(`randomsFound: ${randomsFound}`)
    console.log(`nodesFound:   ${nodesFound}`)
    return {guess: randomsFound, actual: nodesFound}
}

/**
*  For each node visit if node not a hashMap key, insert 
*  into array.  Then append node into end of the array.
*  @params node - object to check
*  @param hashMap - object literal used for deduping
*  @param array - final array that nodes are inserted
*/
//function visitNode(node, hashMap, array) {
//    if(!hashMap[node.data]) {
//        hashMap[node.data] = true;
//        array.push(node);
//    }
//}
//
interface tnode {
    file: string
    type: string
    node: string
}

describe("helpful", () => {
    jest.setTimeout(7000)

    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });



    it("get unique tokens from ten largest fish files", async () => {
        let roots: SyntaxNode[]= [];
        let files: string[] = [];
        let cmdMap: Map<string, SyntaxNode> = new Map<string, SyntaxNode>()
        try {
            files = getLargeShareFunctionFiles()
            console.log(files)
        } catch (e) {
            console.log(e)
        } finally {
            for (var idx in files) {
                let file = files[idx]
                let result = await getRootNode(file)
                if (result) {
                    roots.push(result)
                }
            }
            roots.forEach((root, index) => {
                getNamedNodesArray(root).forEach((node) => {
                    if (!cmdMap.has(node.type)) {
                        //console.log(`\n${files[index]}` )
                        //console.log(`type: ${node.type}              text: ${node.firstNamedChild?.text}` )
                        console.log(node.type)
                        cmdMap.set(node.type, node)
                    }
                })
            })
            expected_commands.forEach(key => 
                expect(cmdMap.has(key)).toBeTruthy()
            )
        }
    })


    it("/usr/share/fish/functions/__fish_print_help.fish", async () => {
        const usrShareFileName = '/usr/share/fish/functions/__fish_print_help.fish'
        const usrShareFile = await resolveAbsPath(usrShareFileName)
        const tree = await getRootNode(usrShareFileName);
        //getNamedNodesArray(tree).forEach(node => console.log(node.text))
        const namedNodes = getNamedNodesArray(tree)

        //const checkStringOne = `if test (less --version | string match -r 'less (\d+)')[2] -lt 530 2>/dev/null`
        //console.log(checkStringOne)
        const switches = namedNodes.filter(node => (isStatement(node) && node.text.startsWith('switch'))).length
        //console.log(switches)
        expect(switches == 5).toBeTruthy()
    })

    // you can effectively use this to test entire directory
    it("/usr/share/fish/functions/abbr.fish", async () => {
        const usrShareFileName = '/usr/share/fish/functions/abbr.fish'
        const result = await singleRandomTest(usrShareFileName)

        expect(result.guess <= result.actual).toBeTruthy()
    })

    it('/usr/share/fish/*.fish 10 random', async () => {
        let checks = 0
        while (checks < 10 ) {
            let fname = getRandomShareFunctionFile()
            console.log(`filename: ${fname}`)
            const result = await singleRandomTest(fname)
            expect(result.guess <= result.actual).toBeTruthy()
            checks++
        }
        expect(checks == 10).toBeTruthy()


    })

    it("parse for all unique tokens function fileall system fish files", async () => {
        let roots: SyntaxNode[]= [];
        let files: string[] = [];
        let cmdMap: Map<string, SyntaxNode> = new Map<string, SyntaxNode>()
        try {
            files = getAllFunctionLocations()
            //console.log(files)
        } catch (e) {
            console.log(e)
        } finally {
            for (var idx in files) {
                let file = files[idx]
                let result = await getRootNode(file)
                if (result) {
                    roots.push(result)
                }
            }
            let table: tnode[]= [];
            roots.forEach((root, index) => {
                getNamedNodesArray(root).forEach((node) => {
                    if (!cmdMap.has(node.type)) {
                        table.push({
                            file:files[index],
                            type: node.type,
                            node: node?.text?.toString().trim().substring(0, 30) || ''
                        })
                        //console.log(`\n${files[index]}` )
                        //console.log(`type: ${node.type}              text: ${node.firstNamedChild?.text}` )
                        //console.log(node.type)
                        cmdMap.set(node.type, node)
                    }
                })
            })
            expected_commands.forEach(key => 
                expect(cmdMap.has(key)).toBeTruthy()
            )
            console.log()
            console.table(table)
        }
    })


    it("all unique tokens usr/share/fish files", async () => {
        let roots: SyntaxNode[]= [];
        let files: string[] = [];
        let cmdMap: Map<string, SyntaxNode> = new Map<string, SyntaxNode>()
        try {
            files = getAllShareLocations()
            //console.log(files)
        } catch (e) {
            console.log(e)
        } finally {
            for (var idx in files) {
                let file = files[idx]
                let result = await getRootNode(file)
                if (result) {
                    roots.push(result)
                }
            }
            let table: tnode[]= [];
            roots.forEach((root, index) => {
                getNamedNodesArray(root).forEach((node) => {
                    if (!cmdMap.has(node.type)) {
                        table.push({
                            file:files[index],
                            type: node.type,
                            node: node?.text?.toString().trim().substring(0, 30) || ''
                        })
                        //console.log(`\n${files[index]}` )
                        //console.log(`type: ${node.type}              text: ${node.firstNamedChild?.text}` )
                        //console.log(node.type)
                        cmdMap.set(node.type, node)
                    }
                })
            })
            expected_commands.forEach(key => 
                expect(cmdMap.has(key)).toBeTruthy()
            )
            console.log()
            console.table(table)
        }
    })


})

const expected_commands = [
	'function_definition',
	"command",
	"if_statement",
	"double_quote_string",
	"variable_expansion",
	"test_command",
	"else_clause",
	"test_option",
	"single_quote_string",
	"command_substitution",
	"command_substitution_fish",
	"conditional_execution",
	"redirected_statement",
	"negated_statement",
	"concatenation",
	"return",
	"file_redirect",
	"begin_statement",
	"else_if_clause",
	"brace_expansion",
	"pipe",
	"list_element_access",
	"index",
	"for_statement",
	"switch_statement",
	"case_clause",
	"while_statement",
]
