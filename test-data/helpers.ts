import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path'
import { initializeParser } from '../src/parser';
import { Point, SyntaxNode, Tree, Logger } from 'web-tree-sitter'
import { Analyzer } from '../src/analyze';
import {getChildNodes, getNodesTextAsSingleLine, getRange, positionToPoint} from '../src/utils/tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {SymbolInformation, Location, SymbolKind, Range, DocumentSymbol, TextDocumentItem} from 'vscode-languageserver';
import {symbolKindToString} from '../src/symbols';
import {bgBlack, bgBlue, black, inverse, white} from 'colors';
import {LspDocument} from '../src/document';
import console from 'console';
import {homedir} from 'os';
import { URI } from 'vscode-uri';
//import { Marked }
//import { blue, inverse } from 'colors'

const util = require('util')

export function buildUri(absolutePath: string) {
    return URI.parse(absolutePath).toString()
}

export function setLogger(
    beforeCallback: () => Promise<void> = async () => {},
    afterCallback: () => Promise<void> = async () => {}
){
    const jestConsole = console;
    beforeEach(async () => {
        global.console = require("console");
        await beforeCallback();
    }, 10000);

    afterEach(async () => {
        global.console = jestConsole;
        await afterCallback();
    }, 10000);
}



/**
 * texts: array of file contents (entire file as a string), 
 *       one for each file to be parsed
 */
export async function getRootNodesFromTexts(...texts: string[]): Promise<SyntaxNode[]> {
    const parser = await initializeParser();
    const rootNodes: SyntaxNode[] = [];
    for (const t of texts) {
        parser.reset()
        rootNodes.push(parser.parse(t).rootNode)
    }
    return rootNodes;
}

/**
 * @async
 * takes an absolute path to a file, and returns the parsed root node.
 * For more simple tests, where no file text is already available (as a string),
 * use getRootNodesFromTexts instead.
 *
 * @param {string} fname - absolute path to file
 * @returns {Promise<SyntaxNode>} - root node of the parsed file
 */
export async function getRootNodeFromPath(fname: string): Promise<SyntaxNode> {
    const file = await resolveAbsPath(fname)
    const parser = await initializeParser();
    const tree = parser.parse(file.join('\n'));
    return tree.rootNode;
}


const logChildShort = (node: SyntaxNode | undefined | null) => {
    if (!node) return {}
    return {
        type: node.type,
        text: node.text,
    }
}


export function getLogNodeChild(root: SyntaxNode, node: SyntaxNode) {
    const range = getRange(node)
    let text = getNodesTextAsSingleLine([node])
    let parentText = getNodesTextAsSingleLine([root])
    if (text.length > 20) text = text.slice(0, 20) + '...';
    if (parentText.length > 20) parentText = parentText.slice(0, 20) + '...';
    return {
        type: node.type,
        text: text,
        parentText: parentText,
        parentType: root.type,
    }
}

export function logNode(node: SyntaxNode, ...extraData: string[]) {
    const range = getRange(node)
    if (extraData.length > 0) {
        console.log(extraData.join('\n'))
    }
    console.log(JSON.stringify({
        text: node.text,
        type: node.type,
        id: node.id,
        range: {start: range.start, end: range.end},
        isNamed: node.isNamed(),
        hasError: node.hasError(),
        firstChild: logChildShort(node.firstChild),
        firstNamedChild: logChildShort(node.firstNamedChild),
        lastChild: logChildShort(node.lastChild),
        lastNamedChild: logChildShort(node.lastNamedChild),
        siblings: {
            previousSibling: logChildShort(node.previousSibling),
            previousNamedSibling: logChildShort(node.previousNamedSibling),
            nextSibling: logChildShort(node.nextSibling),
            nextNamedSibling: logChildShort(node.nextNamedSibling),
        },
        namedChildCount: node.namedChildCount,
        namedChildren: node.namedChildren.map(n => JSON.parse(JSON.stringify(getLogNodeChild(node, n)))),
        childCount: node.childCount,
        children: node.children.map(n => JSON.parse(JSON.stringify({text: n.text, type: n.type}))),
        tree: node.toString(),
    }, null, 2));
}

export function nodeToString(node: SyntaxNode, shouldLog = true) : string {
    const pos = `(${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`.bgBlack.white
    return shouldLog
        ? `\nNODE: ${node.text.bgBlack.white},\nTYPE: ${node.type.bgBlack.white},\n      ${pos}\n`
        : "";
}

type nodeConsoleArray = {text: string, node_type: string, start: string, end: string}

export function nodeToArrayString(node: SyntaxNode) : nodeConsoleArray {
    return {
        text: node.text.toString(),
        //node_type: node.previousNamedSibling?.type.toString() + " || " + node.type.toString(),
        //node_type: node.parent?.childForFieldName('option')?.text || node.childForFieldName('option')?.text || "none",
        //node_type: node.parent?.walk().nodeType || "none",
        node_type: node.isNamed() ? node.type : "anonymous",
        //node_type: node.childForFieldName("option")?.text.toString() || "",
        //node_type: node.descendantsOfType("word").toString() || "",
        start: `(${node.startPosition.row}, ${node.startPosition.column})`,
        end: `(${node.endPosition.row}, ${node.endPosition.column})`
    }
}

/**
 * @param {string} fname - relative path to file, in test-data folder 
 * @param {boolean} inAutoloadPath - simulate the doc uri being in ~/.config/fish/functions/*.fish
 * @returns {LspDocument} - lsp document (from '../src/document.ts')
 */
export function resolveLspDocumentForHelperTestFile(fname: string, inAutoloadPath: boolean = true): LspDocument {
    // check which path type is fname -----------> absolute path  | relative path
    const filepath = fname.startsWith(homedir()) ? resolve(fname) : resolve(__dirname, fname)
    const file = readFileSync(filepath, 'utf8')
    const filename = inAutoloadPath ? `file://${homedir()}/.config/fish/functions/${fname.split('/').at(-1)}` : `file://${filepath}`
    const doc = TextDocumentItem.create(filename, 'fish', 0, file)
    return new LspDocument(doc)
}

export function resolveRelPath(dirname: string, fname: string): string {
    const file = readFileSync(resolve(dirname, fname), 'utf8');
    return file.toString();
}

export async function resolveAbsPath(fname: string): Promise<string[]> {
    //if ( fname.startsWith('/usr/share/fish/functions') ) {
        //const fstr = fname.replace('/usr/share/fish/functions/', '')
        //const file = readFileSync(resolve('/usr/share/fish/functions/', fstr), 'utf8');
        //return file.toString();
    //}
    const file = readFileSync(resolve(fname), 'utf8');
    return file.split('\n');
}


export function positionStr(pos: Point){
    return `(${pos.row.toString()}, ${pos.column.toString()})`
}



export async function readFishDir(dir: string): Promise<string[]> {
    let files: string[] = []
    try {
        files = readdirSync(dir, {encoding:'utf8', withFileTypes: false})
    } catch (e) {
        console.log(e)
    }
    return files.map(file => dir + '/' + file.toString())
}

export async function readShareDir(): Promise<string[]> {
    let files: string[] = []
    try {
        files = readdirSync('/usr/share/fish/functions/', {encoding:'utf8', withFileTypes: false})
        //files.forEach(file => {
        //    result.push('/usr/share/fish/functions/'+file)
        //})
    } catch (e) {
        console.log(e)
    }
    return files.map(file => '/usr/share/fish/functions/' + file.toString())
}

// determine a node to check for a file, to keep implementationo
// that is not in the lsp-server, test-cases just mainly check 
// for nodes in the beggining of a line
export function getRandomNodeType(): string {
    const choices = [
        'if',
        'else if',
        'set',
        'string', 
        'echo',
        'return',
        'case'
    ]
    return choices[Math.floor(Math.random() * choices.length)]
}

// handle other types of fish system files
export async function getRandomNodeMatches(fileStr: string, nodeStr: string): Promise<string[]> {
    const file = await resolveAbsPath(fileStr)
    return file
        .map(line => line.trimStart())
        .filter(line => line.startsWith(nodeStr))
}


export async function parseFile(fname: string) : Promise<Tree> {
    const file = await resolveAbsPath(fname)
    const parser = await initializeParser();
    const tree = parser.parse(file.join('\n'));
    return tree;
}


export function printAllChildNodes(root: SyntaxNode) {
    console.log(nodeToString(root))
    root.children.forEach(child => {
        printAllChildNodes(child)
    })
}

function buildChildNodesTable(root: SyntaxNode) {
    const table: nodeConsoleArray[] = []
    for (const child of getChildNodes(root)) {
        table.push(nodeToArrayString(child))
    }
    return table
}

export function printChildNodesTable(root: SyntaxNode) {
    const table = buildChildNodesTable(root)
    const properties = ['text', 'node_type', 'start', 'end']
    console.table(table, properties)
}


export function printDebugSeperator(shouldLog = true) {
    if (!shouldLog) return
    console.log('--------------------------------------------')
}

export function printTestName(name = "NEW TEST", shouldLog = true) {
    if (!shouldLog) return
    console.log()
    printDebugSeperator(shouldLog)
    console.log(`${name}`)
    printDebugSeperator(shouldLog)
} 


export function logCompareNodes(shouldLog = true, ...nodes: SyntaxNode[]) {
    if (!shouldLog) return
    console.log('COMPARING:')
    const out = nodes.map(node => {
        return {
            "this.text": node.text,
            "this.parent.parent": node.parent?.text.slice(0, 15) + '...',
            "more": nodeToString(node),
        }
    })
    console.table(out)
}

export function nodesSingleLine(nodes: SyntaxNode[]) : string{
    let text = '';
    for (const node of nodes) {
        text += node.text.split('\n').map(n => n.trim()).join(';')
        if (!text.endsWith(';')) text+=';'
    }
    return text
    //return `named: ${node?.isNamed()} text: ${node?.text.split('\n').map(n => n.trim()).join(';')}  type: ${node?.type}`)
}

export function logNodeSingleLine(node?: SyntaxNode) {
    if (!node) {
        console.log('Node is undefined'.white)
        return
    }
    console.log(`named: ${node.isNamed()} text: ${node.text.split('\n').map(n => n.trim()).join(';')}  type: ${node.type}`)
}

export function logVerboseNode(shouldLog = true, node: SyntaxNode) {
    if (!shouldLog) return
    console.log('VERBOSE: ' + node.text)
    console.log(nodeToString(node))
    console.log('parent: "' + node.parent?.text.slice(0, 15) + '"...')
    console.log(node.toString())
}

export class ShouldLogger {

    constructor(private shouldLog: boolean) {}

    toggle() {
        this.shouldLog = !this.shouldLog
    }

    get isOn() {
        return this.shouldLog
    }

}

export function rangeToString(range: Range) {
    return locationToString({uri: '', range})
}

export function locationToString(loc: Location) {
    let result = '';
    if (loc.uri) {
        result += loc.uri + ' ';
    }
    result += `(${loc.range.start.line}, ${loc.range.start.character}), (${loc.range.end.line}, ${loc.range.end.character})`
    return result
}

export function logSymbolInfo(shouldLog = true, symbol: SymbolInformation) {
    if (!shouldLog) return
    console.log('------------------------------------')
    console.log(`SYMBOL\n{\n\tname: ${symbol.name}`)
    console.log(`\tkind: ${symbolKindToString(symbol.kind)}`)
    console.log(`\tlocation: ${locationToString(symbol.location)}`)
    if (symbol.containerName) {
        console.log(`\tcontainerName: ${symbol.containerName}`)
    }
    console.log('}')
}

export function logDocSymbol(shouldLog = true, symbol: DocumentSymbol, indent = 0) {
    if (!shouldLog) return
    const indentStr = '\t'.repeat(indent)
    console.log(`${indentStr}{`);
    console.log(`${indentStr} name:`, ` ${symbol.name}`)
    console.log(`${indentStr} detail:\n${indentStr}`,`${symbol.detail?.split('\n').join('\n' + indentStr)}`)
    console.log(`${indentStr} kind:`,` ${symbolKindToString(symbol.kind)}`)
    console.log(`${indentStr} range:`,` ${rangeToString(symbol.range)}`)
    console.log(`${indentStr} selection range:`,` ${rangeToString(symbol.selectionRange)}`)
    console.log(`${indentStr} children amount:`,` ${symbol.children?.length || 0}`)
    const children = symbol.children || []
    for (const child of children) {
        logDocSymbol(shouldLog, child, indent + 1)
    }
    console.log(`${indentStr}}`);

}

export function logFile(shouldLog = true, uri: string, text: string) {
    if (!shouldLog) return
    console.log('------------------------------------')
    console.log(`URI: ${uri}`)
    console.log(`TEXT:\n${text}`)
    console.log('------------------------------------')
}

//export colorOutput(text: string, otherText: string) {
    //return text.inverse.underline + otherText
//}



export function setMarkedterminal() {
    const marked = require('marked');
    const TerminalRenderer = require('marked-terminal');
    marked.setOptions({
        // Define custom renderer
        renderer: new TerminalRenderer()
    });
}