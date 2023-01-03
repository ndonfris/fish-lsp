import {  getRootNodesFromTexts, logCompareNodes, logDocSymbol, logFile, logNode, logSymbolInfo, logVerboseNode, printDebugSeperator, printTestName } from './helpers';
import {Point, SyntaxNode} from 'web-tree-sitter';
import {isScope} from '../src/utils/node-types';
import {getRange} from '../src/utils/tree-sitter';
import { Range, DocumentSymbol } from 'vscode-languageserver'
import {initializeParser} from '../src/parser';
import * as colors from 'colors'
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

describe('spans tests', () => {
    it('simple span', async () => {
        const rootNodes = await getRootNodesFromTexts(test_1)

        rootNodes.forEach(root => {
            const spans: SpanNode[] = [];
            buildSpans(root, spans);
            //console.log(spans[0].text?.slice(0, 20));
            console.log(spans.length)
            logSpan(spans[0], root)
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

function logNodeText(node: SyntaxNode, rootNode: SyntaxNode) {
    const lines = rootNode.text.split('\n')
    const start = node.startPosition.row
    const end = node.endPosition.row
    const result: string[] = [];
    lines.forEach((line, row) => {
        result.push(lineSyntaxHighlighter(line, row, node.startPosition, node.endPosition))
        //if (row === start || row === end) {
        //} else if (row > start && row < end) {
        //    result.push(line.bgBlack)
        //} else {
        //    result.push(line)
        //}
    })
    console.log(result.join('\n'))

    //const t = rootNode.text.split('\n').slice(node.startPosition.row)
    //console.log(`${node.startPosition.row}, ${node.startPosition.column}`);
    //console.log(`${node.endPosition.row}, ${node.endPosition.column}`);
    console.log(node.type.black);
    console.log(node.text.slice(0, 20).black);
    console.log('-----------------------'.bgBlack)

    //lines.forEach((line, i) => {
        //// get longest leading whitespace
        //const leadingWhitespace = line.match(/^\s*/)?.[0] ?? ''
        //const leadingWhitespaceLength = leadingWhitespace.length
        //indentAmount = Math.max(indentAmount, leadingWhitespaceLength)
    //})
    //console.log(indentAmount)
    //console.log(t.join('\n').black)
}

function lineSyntaxHighlighter(line: string, row: number, start: Point, end: Point) {
    if (row >= start.row && row <= end.row) {
        //const startCol = start.column;
        //const endCol = end.column;
        //const startStr = line.slice(0, startCol);
        //const endStr = line.slice(endCol);
        //const midStr = line.slice(startCol, endCol);
        //return startStr + midStr.bgBlack + endStr;
        return line.bgBlack
    } else {
        return line
    }
}

function logSpan(n: SpanNode, rootNode: SyntaxNode) {
    //console.log("span: \n".bgRed, n?.text.toString(),)
    logNodeText(n, rootNode)
    //console.log(n?.type, n?.startPosition, n?.endPosition);
    n.innerSpans.forEach((child) => {
        logSpan(child, rootNode)
    })
}
