import {
    //resolveRelPath,
    resolveAbsPath,
    getRootNode,
    readShareDir,
    positionStr
} from './helpers'

import {AstNodes} from '../src/analyzer';
import {execCommandDocs} from '../src/utils/exec'
import {TextDocument} from 'vscode-languageserver-textdocument';
import {SyntaxNode} from 'web-tree-sitter';
import {getNodes, getNodeText, nodesGen} from '../src/utils/tree-sitter';
import {findDefinedVariable} from '../src/utils/node-types';

async function startAnalyze(fname: string) : Promise<AstNodes> {
    const usrShareFile = await resolveAbsPath(fname)
    const tree = await getRootNode(fname)
    return new AstNodes(tree)
}

interface textDocumentResult {
    document : TextDocument;
    ast: AstNodes;
}


async function startTextDocument(fname: string) : Promise<textDocumentResult> {
    const usrShareFile = await resolveAbsPath(fname)
    const tree = await getRootNode(fname)
    return {
        document: TextDocument.create(fname, 'fish', 0, usrShareFile.join('\n')),
        ast: new AstNodes(tree)
    }
}


function compareNodesGenToNodesArr(root: SyntaxNode, logging = false) {
    const _arrNodes: SyntaxNode[] = getNodes(root)
    const _genNodes = nodesGen(root)

    let i = 0
    let j = 0
    let resultVal = true;
    for (const genNode of _genNodes) {
        const arrNode = _arrNodes.find(node => genNode == node)
        j = _arrNodes.findIndex(node => genNode == node)
        if (arrNode) {
            let startStr = positionStr(genNode.startPosition)
            let endStr = positionStr(genNode.endPosition)
            if (logging) {
                console.log('PASSED')
                console.log(`gen ${i}: '${getNodeText(genNode)}', ${startStr}, ${endStr}`)
                console.log(`arr ${j}: '${getNodeText(arrNode)}', ${startStr}, ${endStr}\n`)
            }
        } else {
            console.log(`missed node ${getNodeText(genNode)}`)
            resultVal = false;
        }
        i++
    }
    return resultVal;
}

describe("analyzer output", () => {
    jest.setTimeout(7000)

    const jestConsole = console;

    beforeEach(() => {
        global.console = require('console');
    });

    afterEach(() => {
        global.console = jestConsole;
    });

    it('testing nodes array matches nodeGen for all share files', async () => {
        const files = await readShareDir()
        if (files.length) {
            files.forEach(async file => {
                let root = await getRootNode(file)
                expect(compareNodesGenToNodesArr(root)).toBeTruthy()
            })
        } else {
            fail('readShareDir() failed in analyzer.test.ts')
        }
    })

    it('test fish_config.fish', async () => {
        const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
        //console.log('functions')
        result.functions.forEach(element => {
            console.log(element?.child(1)?.text)
        });
        //console.log('commands')
        const uniqueCommands = [...new Set([...result.commands.map(node => getNodeText(node))])]
        console.log(uniqueCommands)
        uniqueCommands.forEach(async cmd => {
            const manpage = await execCommandDocs(cmd || "")
            const mantrimmed = manpage.split('\n').slice(0, 2).join()
            console.log(mantrimmed)
        })
    })

    it('test fish_config.fish variables', async () => {
        const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
        console.log('varaiable_definitions')
        result.variable_defintions.forEach(element => {
            console.log(findDefinedVariable(element)?.text)
        })
        expect(true).toBeTruthy()
    })

    // TODO: implement get variable definitions
    it('test fish_config.fish variables', async () => {
        const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
        //console.log('varaiables')
        //result.variables.forEach(element => {
        //    console.log(getNodeText(element))
        //});
        console.log('varaiable_definitions')
        // TODO
        result.variable_defintions.forEach(element => {
            const found = result.variables.find(node => findDefinedVariable(node))
            console.log(findDefinedVariable(element)?.text)
        })
        expect(false).toBeTruthy()
    })



    it('test /usr/share/functions/*.fish', async () => {
        const files = await readShareDir()
        console.log('more tests should be added')
        expect(true).toBeTruthy()
    })
})


