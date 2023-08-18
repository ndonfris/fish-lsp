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
    } catch (e) {
        console.log(e)
    }
    return files.map(file => '/usr/share/fish/functions/' + file.toString())
}


export async function parseFile(fname: string) : Promise<Tree> {
    const text = await resolveAbsPath(fname)
    const parser = await initializeParser();
    const tree = parser.parse(text.join('\n'));
    return tree;
}

export function createFakeUriPath(path: string): string {
    return `file://${homedir()}/.config/fish/${path}`
}

export function createFakeLspDocument(name: string, text: string): LspDocument {
    const uri = createFakeUriPath(name)
    const doc = TextDocumentItem.create(uri, 'fish', 0, text)
    return new LspDocument(doc)
}

export type FakeDocumentInput = {
    name: string,
    text: string[],
}

export function createTestWorkspaceDocuments(inputs: {[uri: string]: string[]}, analyzer?: Analyzer): LspDocument[] {
    const documents: LspDocument[] = Object.entries(inputs).map(([uri, text]) => {
        return createFakeLspDocument(uri, text.join('\n'))
    })
    if (analyzer) {
        documents.forEach(document => analyzer.analyze(document))
    }
    return documents
}

export type truncatedNode = {
    text: string,
    type: string,
    startPosition: string,
    endPosition: string,
    children: truncatedNode[],
    siblings: truncatedNode[],
}
export function truncatedNode(node: SyntaxNode){
    return {
        text: node.text,
        type: node.type,
        startPosition: positionStr(node.startPosition),
        endPosition: positionStr(node.endPosition),
        //children: node.children.map(child => truncatedNode(child)),
        //siblings: node.parent?.children.map(child => truncatedNode(child)) || [],
    }
}


export function printNodes(node: SyntaxNode, depth: number = 0){
    const indent = ' '.repeat(depth * 4)
    const logStr = JSON.stringify(truncatedNode(node), null, 2).split('\n').map(l => indent + l).join('\n')
    console.log(logStr)
    node.children.forEach(child => printNodes(child, depth + 1))
}