import {readFileSync} from 'fs';
import {resolve} from 'path'
import {TextDocument} from 'vscode-languageserver-textdocument';
import { SyntaxNode } from 'web-tree-sitter'
import {initializeParser} from '../parser';
import {
    //nodesGen,
    getChildrenArray,
} from '../utils/tree-sitter'

//import {
//  execFishCommand,
//  execFishType,
//  execFishDocumentation,
//  resolveAllFishAbbr,
//  resolveAllFishBuiltins,
//  resolveFishFunctionPath,
//} from "../utils/exec";
                        

async function getRootNode(fileStr: string) : Promise<SyntaxNode> {
    const file = readFileSync(resolve(__dirname, fileStr), 'utf-8');
    const parser = await initializeParser();
    const tree = parser.parse(file);
    return tree.rootNode;
}

function buildTextDocument(input_name: string) {
    const text = readFileSync(input_name, 'utf8');

    const uri = 'file:///' + input_name;

    return {
        uri: uri,
        td: TextDocument.create(uri, 'fish', 1, text)
    }
}

function printNode(node: SyntaxNode) {
    console.log(`node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`)
}

async function test_1(): Promise<Map<string, SyntaxNode>> {
    const tree = await getRootNode('fish_files/fish_git_prompt.fish');

    getChildrenArray(tree).forEach(node => printNode(node))


    let found_dic : Map<string, SyntaxNode> = new Map();

    getChildrenArray(tree).forEach(( node: SyntaxNode ) => {
        if (found_dic.has(node.type)) {
            found_dic.set(node.type, node)
        }
    });
    return found_dic;
}   

async function test_2(): Promise<void> {
    console.log('hi');
}

(async () => await test_2()
)()


//(async () => {
//const result1 = await execFishCommand('echo "hi"');
//console.log(result1)
//})()

//const result2 = execFishType('ls');
//console.log(result2);
//
//
//const result3 = execFishDocumentation('ls');
//console.log(result3);

//(async () => {
//console.log(await resolveAllFishAbbr())
//})()

//(async () => {
//console.log(await resolveAllFishBuiltins())
//})()

// (async () => {
//     const a = '__fish_abbr_show'
//     console.log(await resolveFishFunctionPath(a))
//     
//     //const t = (await resolveAllFishAbbr())
//     //const t = await execFishCommand('echo "hi"');
// })()
