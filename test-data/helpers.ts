import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path'
import { initializeParser } from '../src/parser';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter'
import { Analyzer } from '../src/analyze';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {getChildNodes, positionToPoint} from '../src/utils/tree-sitter';
import {SymbolInformation, Location, SymbolKind, Range, DocumentSymbol} from 'vscode-languageserver';
import {symbolKindToString} from '../src/symbols';
import {bgBlack, bgBlue, black, inverse, white} from 'colors';
//import { blue, inverse } from 'colors'


export function nodeToString(node: SyntaxNode, shouldLog = true) : string {
    return shouldLog ? `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})` : ""
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


// @ts-ignore
export async function getRootNode(fname: string): Promise<SyntaxNode> {
    const file = await resolveAbsPath(fname)
    const parser = await initializeParser();
    const tree = parser.parse(file.join('\n'));
    return tree.rootNode;
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

export async function startAnalyze(fname: string) : Promise<Analyzer> {
    const usrShareFile = await resolveAbsPath(fname)
    const output = usrShareFile.join('\n')
    const parser = await initializeParser()
    //const tree = await getRootNode(fname)

    const analyzer = new Analyzer(parser);
    //const td = TextDocument.create(fname,'fish', 1, output);
    //analyzer.analyze(td);
    return analyzer;
}


export async function getDocumentFromFilename(fname: string) : Promise<TextDocument> {
    const usrShareFile = await resolveAbsPath(fname)
    const output = usrShareFile.join('\n')
    const parser = await initializeParser()
    //const tree = await getRootNode(fname)
    const analyzer = new Analyzer(parser);
    return TextDocument.create(fname,'fish', 1, parser.parse(output).rootNode.text.toString());
}

export function getDocumentFromString(text: string = "") : TextDocument {
    return TextDocument.create(`file://test_textdocument_from_string.fish`,'fish', 1, text);
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

export function logNode(shouldLog = true, node?: SyntaxNode) {
    if (!shouldLog) return
    if (!node) {
        console.log('Node is undefined')
        return
    }
    console.log(nodeToString(node))
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
    logColor(`${indentStr}{`);
    logColor(`${indentStr} name:`, ` ${symbol.name}`)
    logColor(`${indentStr} detail:\n${indentStr}`,`${symbol.detail?.split('\n').join('\n' + indentStr)}`)
    logColor(`${indentStr} kind:`,` ${symbolKindToString(symbol.kind)}`)
    logColor(`${indentStr} range:`,` ${rangeToString(symbol.range)}`)
    logColor(`${indentStr} selection range:`,` ${rangeToString(symbol.selectionRange)}`)
    logColor(`${indentStr} children amount:`,` ${symbol.children?.length || 0}`)
    const children = symbol.children || []
    for (const child of children) {
        logDocSymbol(shouldLog, child, indent + 1)
    }
    logColor(`${indentStr}}`);

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

export function logColor(infoStr: string, ...text: string[]) {
    if (text.length === 0) {
        console.log(infoStr.green.bold);
    } else {
        const s1 =  splitSpaceStr(toBlackFg, infoStr); 
        const s2 = splitSpaceStr(toWhite, text.toString()); 
        console.log(s1 + s2);
    }
}

const toBlackFg = (text: string) => {
    return text.black.underline.bold.toString()
}
const toBlack = (text: string) => {
    return text.bgBlue.black.underline.bold.toString()
}

const toWhite = (text: string) => {
    return white.bgYellow(text)
}

function splitSpaceStr(c: (s: string) => string, ...strs: string[]) {
    const preText = strs.map(t => t.split('\n')).flat()
    const result = []
    for (const t of preText) {
        const whiteSpace = Math.max(0, t.length - t.trimStart().length)
        result.push(t.slice(0, whiteSpace) + c(t.slice(whiteSpace)))
    }
    return result.join('\n')


}


