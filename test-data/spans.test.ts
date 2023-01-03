import {  getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName } from './helpers';
import {Point, SyntaxNode, Tree} from 'web-tree-sitter';
import {isFunctionDefinitionName, isScope, isVariable, isVariableDefinition} from '../src/utils/node-types';
import {getRange, nodesGen} from '../src/utils/tree-sitter';
import { Range, DocumentSymbol } from 'vscode-languageserver'
import {getChildNodes, positionToPoint} from '../src/utils/tree-sitter';
import {initializeParser} from '../src/parser';
import * as colors from 'colors'
import {toSymbolKind} from '../src/symbols';
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


interface SpanNode extends SyntaxNode {
    span: Range
    innerSpans: SpanNode[]
}

function buildSpans(root: SyntaxNode, spans: SpanNode[] = []): boolean {
    let isSpan = isScope(root);
    const spanNode : SpanNode = root as SpanNode;
    const innerSpans: SpanNode[] = [];

    for (const c of root.children) {
        const childSpan = buildSpans(c, innerSpans);
        isSpan = isSpan || childSpan;
    }

    if (isSpan) {
        spanNode.span = getRange(root);
        spanNode.innerSpans = innerSpans;
        spans.push(spanNode);
    }

    return isSpan
}

class SpanTree {
    root: SyntaxNode;
    childTrees: SpanTree[] = [];

    constructor(root: SyntaxNode) {
        this.root = root;
    }

    getChildren(): SpanTree[] {
        return this.childTrees;
    }

    getDefinitionChildren(): DocumentSymbol[] {
        const result : DocumentSymbol[] = []
        for (const c of nodesGen(this.root)) {
            if (isFunctionDefinitionName(c)) {
                const range = getRange(c);
                const symbol = DocumentSymbol.create(c.text, '', toSymbolKind(c), range, range);
                result.push(symbol);
            } else if (isVariableDefinition(c)) {
                const range = getRange(c);
                const symbol = DocumentSymbol.create(c.text, '', toSymbolKind(c), range, range);
                result.push(symbol);
            }
        }
        return result
    }

    setChildren(children: SpanTree[]) {
        this.childTrees = children;
    }

    toString() {
        const result : string[] = [this.root.type.bgBlack + ', children: ' + this.childTrees.length, ""]
        for (const c of this.childTrees) {
            //result.push(getNodeText(c.root, this.root))
            result.push(c.toString())
        }
        return result.join('\n')
    }
}

function collectSymbols(root: SyntaxNode, syms: DocumentSymbol[] = []) : boolean {
    let shouldInclude = isScope(root) || isFunctionDefinitionName(root) || isVariable(root)
    const children: DocumentSymbol[] = [];
    for (const c of root.children) {
        let didAdd = collectSymbols(c, children);
        shouldInclude =  didAdd || shouldInclude;
    }
    if (shouldInclude) {
        syms.push({
            name: root.text,
            kind: toSymbolKind(root),
            range: getRange(root),
            selectionRange: getRange(root),
            children
        })
    }
    return shouldInclude
}

function buildSpanTree(root: SyntaxNode, spanTree: SpanTree) {
    let isSpan = isScope(root);
    const children: SpanTree[] = [];
    for (const c of root.children) {
        const childSpan = new SpanTree(c);
        let didAdd = buildSpanTree(c, childSpan);
        if (didAdd) {
            children.push(childSpan);
        }
    }
    if (isSpan) {
        spanTree.setChildren(children);
    }
    return isSpan
}


describe('spans tests', () => {
    it('simple span', async () => {
        const rootNodes = await getRootNodesFromTexts(test_1)
        rootNodes.forEach(root => {
            const spans: SpanNode[] = [];
            buildSpans(root, spans);
            const tree = new SpanTree(root);
            buildSpanTree(root, tree);
            const symbols: DocumentSymbol[] = [];
            collectSymbols(root, symbols)
            //logSymbol(symbols[0])
            for (const span of spans) {
                logSpan(span, root)
            }

            //console.log(spans[0].text?.slice(0, 20));
            //logSpan(spans[0], root)
        })

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

function logSymbol(sym: DocumentSymbol) {
    console.log(`name: ${sym.name.toString()}`)
    console.log(`len: ${sym.children?.length.toString()}`)
    for (const t of sym.children || []) {
        logSymbol(t)
    }
    console.log('-'.repeat(30))
}
function logSpan(n: SpanNode, rootNode: SyntaxNode) {
    //console.log("span: \n".bgRed, n?.text.toString(),)
    getNodeText(n, rootNode)
    //console.log(n?.type, n?.startPosition, n?.endPosition);
    n.innerSpans.forEach((child) => {
        logSpan(child, rootNode)
    })
}
