import {  getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName } from './helpers';
import {Point, SyntaxNode, Tree} from 'web-tree-sitter';
import {findEnclosingVariableScope, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariable, isVariableDefinition} from '../src/utils/node-types';
import {getNodeAtRange, getRange, nodesGen} from '../src/utils/tree-sitter';
import { Range, DocumentSymbol } from 'vscode-languageserver'
import {getChildNodes, positionToPoint} from '../src/utils/tree-sitter';
import {initializeParser} from '../src/parser';
import * as colors from 'colors'
import {toSymbolKind} from '../src/symbols';
import {containsRange, SymbolTree} from '../src/workspace-symbol';
//import

let SHOULD_LOG = true
const jestConsole = console;
jest.setTimeout(25000)

beforeEach(() => {
    global.console = require('console');
});
afterEach(() => {
    global.console = jestConsole;
});

function createSymbol(node: SyntaxNode, children?: DocumentSymbol[]) : DocumentSymbol | null{
    if (isVariableDefinition(node)) {
        return {
            name: node.text,
            kind: toSymbolKind(node),
            range: getRange(node),
            selectionRange: getRange(node),
            children: children || []
        }
    } else if (isFunctionDefinitionName(node)) {
        const name = node.firstNamedChild || node
        return {
            name: name.text,
            kind: toSymbolKind(name),
            range: getRange(node.parent!),
            selectionRange: getRange(name),
            children: children || []
        }
    } else {
        return null;
    }
}

function getSymbols(root: SyntaxNode) {
    let parentSymbol: DocumentSymbol | null = null;
    let currentSymbol: DocumentSymbol | null = null;
    let symbols: DocumentSymbol[] = [];
    let queue: SyntaxNode[] = [root];

    while (queue.length > 0) {
        const node = queue.shift()!;
        if (isVariableDefinition(node)) {
            currentSymbol = createSymbol(node);
            if (!currentSymbol) continue; // should never happen
            if (!parentSymbol) symbols.push(currentSymbol);
            if (parentSymbol && containsRange(parentSymbol.range, currentSymbol.range)) {
                if (!parentSymbol.children) {
                    parentSymbol.children = [];
                }
                parentSymbol.children.push(currentSymbol);
            }
        } else if (isFunctionDefinitionName(node)) {
            currentSymbol = createSymbol(node);
            parentSymbol = currentSymbol;
        } else if (parentSymbol && !containsRange(parentSymbol.range, getRange(node))) {
            symbols.push(parentSymbol)
            parentSymbol = null;
        }
        queue.unshift(...node?.children)
    }
    return symbols;
}

describe('spans tests', () => {
    it('simple definition spans', async () => {
        const rootNodes = await getRootNodesFromTexts(test_1)
        rootNodes.forEach(root => {
            let symbols: DocumentSymbol[] = []
            symbols = getSymbols(root)
            for (const c of symbols) {
                console.log(logStringSymbol(c))
            }
        })
        expect(true).toBe(true);
    })


    it('simple ref spans', async () => {
        const rootNodes = await getRootNodesFromTexts(test_1)
        const root = rootNodes[0]
        const tree = new SymbolTree(root)
        tree.setDefinitions()
        tree.setScopes()
        const testNodes = [
            //root.descendantForPosition({ row: 15, column: 14 }),
            //root.descendantForPosition({ row: 14, column: 7 }),
            root.descendantForPosition({ row: 2, column: 8 }),
            //root.descendantForPosition({ row: 3, column: 28 }),
        ]
        testNodes.forEach(testNode => {
            console.log(getNodeText(testNode, root))
            const defs = tree.definitions
            const scopes = tree.scopes
            for (const def of tree.definitions) {
                //const defNode = getNodeAtRange(root, def.range)
                //if (defNode) {
                //    console.log(getNodeText(defNode, root))
                //}
                console.log(def.name);
                if (def.name === testNode.text) {
                    console.log("DEF: ".black + def.name)
                }
                
                //const defNode = getNodeAtRange(root, def.range)
                //if (containsRange(def.range, getRange(testNode)) && defNode) {
                //    console.log(getNodeText(defNode, root).white)
                //}
            }

            //for (const scope of scopes) {
            //    if (containsRange(getRange(scope), getRange(node))) {
            //        console.log(getNodeText(scope, root))
            //    }
            //}
        })
        //console.log(getNodeText(node, root))
        expect(true).toBe(true);
    })

 })


const test_1 = `
function span_test --argument-names arg1 arg2
    for arg in $argv
        if string match -q $arg $arg1
            echo "$arg matches arg1"
        else if string match -q $arg $arg2
            echo "$arg matches arg2"
        else
            echo "arg does not match either arg1 or arg2"
        end 
    end
end

set -l h "hello"
set -l w "world"
span_test $h $w
`

function getNodeText(node: SyntaxNode, rootNode: SyntaxNode) {
    const lines = rootNode.text.split('\n')
    const start = node.startPosition
    const end = node.endPosition
    const result: string[] = [];
    lines.forEach((line, row) => {
        let resultLine = '';
        line.split('').forEach((char, col) => {
            if (row === start.row && row === end.row) {
                if (col >= start.column && col <= end.column) {
                    resultLine += char.bgBlack
                } else {
                    resultLine += char
                }
            } else if (row === start.row) {
                if (col >= start.column) {
                    resultLine += char.bgBlack
                } else {
                    resultLine += char
                }
            } else if (row === end.row) {
                if (col < end.column) {
                    resultLine += char.bgBlack
                } else {
                    resultLine += char
                }
            } else if (row > start.row && row < end.row) {
                resultLine += char.bgBlack
            } else {
                resultLine += char
            }
        })
        result.push(resultLine)
    })
    return [
        node.type.bgBlack.blue,
        result.join('\n').trim(),
        '-'.repeat(30).bgBlack
    ].join('\n')
}

function logStringSymbol(sym: DocumentSymbol, indent=0) {
    const indentStr = '    '.repeat(indent)
    const result: string[] = [
        indentStr+ `name: ${sym.name.toString()}`,
        indentStr+ `len: ${sym.children?.length.toString()}`,
    ]
    for (const t of sym.children || []) {
        result.push(logStringSymbol(t, indent+1))
    }
    return result.join('\n')
}
