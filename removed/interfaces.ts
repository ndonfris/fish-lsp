import { TextDocument, } from 'vscode-languageserver-textdocument'
import {
    ClientCapabilities,
    Connection,
    Hover,
    Range,
    TextDocumentPositionParams,
    SymbolInformation,
    SymbolKind,
    TextDocuments,
} from "vscode-languageserver";
import { Tree } from 'web-tree-sitter'
import * as Parser from 'web-tree-sitter'
//import {AstNodes} from './analyzer';
//import {DependencyMap} from './dependencies';

type SymbolName = string
type Namespace = string

export function getSymbolKind(treeKind: string): SymbolKind {
    switch (treeKind) {
        case 'variable':
        case 'variable_definition':
            return SymbolKind.Variable
        case 'function_definition': 
            return SymbolKind.Function
        case 'command':
            return SymbolKind.File
        default:
            return SymbolKind.Field
    }
}


// Value is array because symbol with the same name can be defined globally and as a function parameter
export type SymbolsMap = Map<SymbolName, SymbolInformation[]>

// namespaces can be commands, you could then check if the range of the current node is a namespace
export type NamespaceMap = Map<Namespace, Range>

export interface SymbolsByUri {
  [uri: string]: SymbolsMap
}

export interface TreesByUri {
  [uri: string]: Tree
}

export interface RootsMap extends Map<string, Parser.SyntaxNode>{
    /** Returns an iterable of entries in the map. */
    [Symbol.iterator](): IterableIterator<[string, Parser.SyntaxNode]>;
    has(k: string): boolean 
    get(k: string): Parser.SyntaxNode;
    keys(): IterableIterator<string>
    values(): IterableIterator<Parser.SyntaxNode>
}

export interface DocsMap extends Map<string, Hover> {
    /** Returns an iterable of entries in the map. */
    [Symbol.iterator](): IterableIterator<[string, Hover]>;
    has(k: string): boolean 
    get(k: string): Hover;
    keys(): IterableIterator<string>
    values(): IterableIterator<Hover>
}

//export interface AstsMap extends Map<string, AstNodes> {
//    /** Returns an iterable of entries in the map. */
//    [Symbol.iterator](): IterableIterator<[string, AstNodes]>;
//    has(k: string): boolean;
//    get(k: string): AstNodes;
//    keys(): IterableIterator<string>;
//    values(): IterableIterator<AstNodes>;
//}


export interface CliOptions {
  noIndex: boolean
}

export interface Context {
    connection: Connection
    documents: TextDocuments<TextDocument>
    //dependencies?: DependencyMap
    capabilities?: ClientCapabilities
    parser: Parser
    //asts: AstsMap
    roots: RootsMap
    symbols?: SymbolsMap
    docs: DocsMap
    cliOptions?: CliOptions
}
