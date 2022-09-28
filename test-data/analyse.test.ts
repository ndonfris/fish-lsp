import {
    //resolveRelPath,
    resolveAbsPath,
    getRootNode,
    readShareDir,
    positionStr
} from './helpers'

//import {AstNodes} from '../src/analyzer';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {SyntaxNode} from 'web-tree-sitter';
import {getNodes, getNodeText, nodesGen} from '../src/utils/tree-sitter';
import {MyAnalyzer} from '../src/analyse';
import {initializeParser} from '../src/parser';
import {findDefinedVariable, findFunctionScope, findGlobalNodes, isVariable, isVariableDefintion} from '../src/utils/node-types';

async function startAnalyze(fname: string) : Promise<MyAnalyzer> {
    const usrShareFile = await resolveAbsPath(fname)
    const output = usrShareFile.join('\n')
    const parser = await initializeParser()
    //const tree = await getRootNode(fname)
    const analyzer = new MyAnalyzer(parser);
    const td = TextDocument.create(fname,'fish', 1, output);
    await analyzer.analyze(fname, td);
    return analyzer;
}
//
//interface textDocumentResult {
//    document : TextDocument;
//    ast: MyAnalyzer;
//}
//
//
//async function startTextDocument(fname: string) : Promise<textDocumentResult> {
//    const usrShareFile = await resolveAbsPath(fname)
//    const tree = await getRootNode(fname)
//    const parser = await initializeParser()
//    return {
//        document: TextDocument.create(fname, 'fish', 0, usrShareFile.join('\n')),
//        ast: new MyAnalyzer(parser.parse(tree, 'fish', 1, usrShareFile))
//    }
//}


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

    it('testing variable_finding', async () => {
        const uri = '/home/ndonfris/.config/fish/functions/set_random_color.fish'
        const analyzer = await startAnalyze(uri)
        analyzer.uriToSyntaxTree[uri]?.ensureAnalyzed()
        const tree = analyzer.getTreeForUri(uri)
        if (!tree) return
        //const nodes = findGlobalNodes(tree.rootNode);
        //for (const node of nodes) {
        //    if (node.text.trim() != "") {
        //        console.log(node.type)
        //        for (const child of node.children) {
        //            console.log(child.text)
        //        }
        //    }
        //}
        const variableTestNodes = [
            tree.rootNode.descendantForPosition({column: 14, row: 34}),
            tree.rootNode.descendantForPosition({column: 12, row: 54}),
            tree.rootNode.descendantForPosition({column: 44, row: 418}),
            //tree.rootNode.descendantForPosition({column: 12, row: 91}),
        ]
        const functionTestNodes = [
            tree.rootNode.descendantForPosition({column: 8, row: 35}),
            tree.rootNode.descendantForPosition({column: 8, row: 119}),
        ]
        const cmpTestNodes = [
            tree.rootNode.descendantForPosition({column: 58, row: 135})
        ]
        //(54, 12)
        //console.log(testNode.text)
        //console.log(testNode.parent?.text)
        //console.log(testNode.parent?.parent?.text)
        //console.log(testNode.parent?.parent?.parent?.text)
        //console.log(testNode.parent?.parent?.parent?.parent?.text)
        ////console.log(testNode.parent?.parent?.parent?.parent?.parent?.text)


        variableTestNodes.forEach(testNode => {
            const result = tree.getNearestVariableDefinition(testNode)
            //console.log(`testNode: ${testNode.text}`)
            if (result) {
                console.log(result.text);
                expect(result.text != "").toBeTruthy()
            } 
        })

        console.log('\n\n\ncompletions\n---------------')
        cmpTestNodes.forEach(testNode => {
            //const result = tree.getNearestVariableDefinition(testNode)
            console.log(`testNode: ${testNode.text}`)
            //if (result) {
            //    console.log(result.text);
            //    expect(result.text != "").toBeTruthy()
            //} 

        })
        //functionTestNodes.forEach(testNode => {
        //    const result = tree.getLocalFunctionDefinition(testNode)
        //    if (result) {
        //        console.log(result.text);
        //        expect(result.text != "").toBeTruthy()
        //    } 
        //})
        //for (const c of tree.rootNode.children) {
        //    console.log(c.child(0)?.text)
        //}
    })

    //it('testing nodes array matches nodeGen for all share files', async () => {
    //    const files = await readShareDir()
    //    if (files.length) {
    //        files.forEach(async file => {
    //            let root = await getRootNode(file)
    //            expect(compareNodesGenToNodesArr(root)).toBeTruthy()
    //        })
    //    } else {
    //        fail('readShareDir() failed in analyzer.test.ts')
    //    }
    //})

    //it('test fish_config.fish', async () => {
    //    const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
    //    //console.log('functions')
    //    const uri = '/usr/share/fish/functions/fish_config.fish'
    //    result.getTreeForUri(uri)?.functions.forEach(element => {
    //        at(index)nsole.log(element?.child(1)?.text)
    //    });
    //    //console.log('commands')
    //    //const uniqueCommands = [...new Set([...result.getTreeForUri(uri)?.commands.map(node => getNodeText(node))])]
    //    //console.log(uniqueCommands)
    //    //uniqueCommands.forEach(async cmd => {
    //    //    const manpage = await execCommandDocs(cmd || "")
    //    //    const mantrimmed = manpage.split('\n').slice(0, 2).join()
    //    //    console.log(mantrimmed)
    //    //})
    //})

    //it('test fish_config.fish variables', async () => {
    //    const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
    //    console.log('varaiable_definitions')
    //    //result.variable_defintions.forEach(element => {
    //    //    console.log(findDefinedVariable(element)?.text)
    //    //})
    //    expect(true).toBeTruthy()
    //})

    //// TODO: implement get variable definitions
    //it('test fish_config.fish variables', async () => {
    //    const result = await startAnalyze('/usr/share/fish/functions/fish_config.fish')
    //    //console.log('varaiables')
    //    //result.variables.forEach(element => {
    //    //    console.log(getNodeText(element))
    //    //});
    //    console.log('varaiable_definitions')
    //    // TODO
    //    //result.variable_defintions.forEach(element => {
    //    //    const found = result.variables.find(node => findDefinedVariable(node))
    //    //    console.log(findDefinedVariable(element)?.text)
    //    //})
    //    expect(false).toBeTruthy()
    //})



    it('test /usr/share/functions/*.fish', async () => {
        const files = await readShareDir()
        //console.log('more tests should be added')
        expect(true).toBeTruthy()
    })
})


