import { CompletionItem, Connection, DocumentUri, Hover, Location, Position, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver/node"; import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import {collectFishSymbols, FishSymbol, FishSymbolMap} from './symbols';
import {SymbolKind} from 'vscode-languageserver';
import {getRange} from './utils/tree-sitter';
import {LspDocument} from './document';

export class Analyzer {

    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };

    private fishSymbols: FishSymbolMap;


    constructor(parser: Parser) {
        this.parser = parser;
        //this.console = console || undefined;
        this.uriTree = {};
        this.fishSymbols = {};
    }

    public analyze(document: LspDocument) {
        this.parser.reset()
        const tree = this.parser.parse(document.getText())
        if (!tree?.rootNode) {
            return
        }
        this.uriTree[document.uri] = tree;
        const fishSymbols = collectFishSymbols(document.uri, tree?.rootNode);
        this.fishSymbols[document.uri] = fishSymbols;
    }

    getCompletionFishSymbols(uri: string): FishSymbol[] {
        return this.fishSymbols[uri].filter((symbol) => {
            return symbol.kind === SymbolKind.Function || symbol.kind === SymbolKind.Variable
        });
    }

    getDefinition(uri: string, node: SyntaxNode): Location[]{
        const first = 
            this.fishSymbols[uri]
            .filter((symbol) => symbol.name === node.text)
            .find((symbol) => symbol.location.range.start.line != getRange(node).start.line)?.location
        if (first) {
            return [first]
        }
        return [];
    }

    getRefrences(uri: string, node: SyntaxNode): Location[] | null {
        return this.fishSymbols[uri]
                .filter(
                    (symbol) => {
                    return symbol.name === node.text
                })
                .map((symbol) => symbol.location) || null;
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

    getSymbols(uri: string): FishSymbol[] {
        return this.fishSymbols[uri] || [];
    }

}
