import { CompletionItem, Connection, DocumentUri, Hover, Location, Position, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import {collectFishSymbols, FishSymbol, FishSymbolMap} from './symbols';
import {containsRange} from './workspace-symbol'
import {SymbolKind} from 'vscode-languageserver';
import {getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isVariable} from './utils/node-types';

export class Analyzer {

    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };

    constructor(parser: Parser) {
        this.parser = parser;
        //this.console = console || undefined;
        this.uriTree = {};
    }

    public analyze(document: LspDocument) {
        this.parser.reset()
        const tree = this.parser.parse(document.getText())
        if (!tree?.rootNode) {
            return
        }
        this.uriTree[document.uri] = tree;
    }

    /**
     * Find the node at the given point.
     */
    public nodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null {
        const tree = this.uriTree[uri]
        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {  
            return null;
        }
        return tree.rootNode.descendantForPosition({ row: line, column });
    }

    public namedNodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null {
        const tree = this.uriTree[uri]
        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) { 
            return null;
        }
        return tree.rootNode.namedDescendantForPosition({ row: line, column });
    }



}
