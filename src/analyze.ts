import { CompletionItem, Connection, Diagnostic, DocumentUri, Hover, Location, Position, PublishDiagnosticsParams, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import {collectFishSymbols, FishSymbol, FishSymbolMap} from './symbols';
import {containsRange} from './workspace-symbol'
import {SymbolKind} from 'vscode-languageserver';
import {getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isVariable} from './utils/node-types';
import {DiagnosticQueue} from './diagnostics/queue';
import {uriToPath} from './utils/translation';
import {getDiagnostics} from './diagnostics/validate';

export class Analyzer {

    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();

    constructor(parser: Parser) {
        this.parser = parser;
        //this.console = console || undefined;
        this.uriTree = {};
    }

    public analyze(document: LspDocument, useCache: boolean = false) {
        //this.parser.reset()
        //const tree = shouldCache ? ;
        const uri = document.uri;
        const tree = this.parser.parse(document.getText())
        if (!uri) return
        if (!tree?.rootNode) return
        this.uriTree[uri] = tree;
        if (!useCache) {
            this.diagnosticQueue.clear(uri);
        } 
        this.diagnosticQueue.set(uri, getDiagnostics(tree.rootNode, document));
    }


    public getDiagnostics(doc: LspDocument): PublishDiagnosticsParams {
        return {
            uri: doc.uri,
            diagnostics: this.diagnosticQueue.get(doc.uri) || [],
        }
    }

    clear(doc: LspDocument) {
        this.diagnosticQueue.clear(doc.uri);
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
