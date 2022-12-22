import { CompletionItem, Connection, DocumentUri, Hover, Location, Position, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver/node"; import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";

export class Analyzer {
    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };

    constructor(parser: Parser) {
        this.parser = parser;
        //this.console = console || undefined;
        this.uriTree = {};
    }

    public analyze(document: TextDocument) {
        this.parser.reset();
        const tree = this.parser.parse(document.getText())
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
