import { CompletionItem, Connection, Diagnostic, DocumentUri, Hover, Location, Position, PublishDiagnosticsParams, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import {containsRange} from './workspace-symbol'
import {SymbolKind} from 'vscode-languageserver';
import {findNodeAt, getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isCommand, isCommandName, isVariable} from './utils/node-types';
import {DiagnosticQueue} from './diagnostics/queue';
import {uriToPath} from './utils/translation';
import {collectDiagnosticsRecursive, /* getDiagnostics */} from './diagnostics/validate';

export class Analyzer {

    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();

    constructor(parser: Parser) {
        this.parser = parser;
        this.uriTree = {};
    }

    public analyze(document: LspDocument, useCache: boolean = false) {
        const uri = document.uri;
        const tree = this.parser.parse(document.getText())
        if (!uri) return
        if (!tree?.rootNode) return
        this.uriTree[uri] = tree;
        if (!useCache) {
            this.diagnosticQueue.clear(uri);
        } 
        this.diagnosticQueue.set(uri, collectDiagnosticsRecursive(tree.rootNode, document));
    }

    /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
    public getRootNode(document: LspDocument, useCache: boolean = true): SyntaxNode | undefined {
        if (!useCache) {
            return this.parser.parse(document.getText()).rootNode;
        }
        if (this.uriTree[document.uri] === undefined) {
            this.uriTree[document.uri] = this.parser.parse(document.getText());
        }
        return this.uriTree[document.uri].rootNode;
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
    public nodeAtPoint(document: LspDocument, line: number, column: number): Parser.SyntaxNode | null {
        const tree = this.uriTree[document.uri]
        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {  
            return null;
        }
        return tree.rootNode.descendantForPosition({ row: line, column });
    }

    public namedNodeAtPoint(document: LspDocument, line: number, column: number): Parser.SyntaxNode | null {
        const tree = this.uriTree[document.uri]
        // Check for lacking rootNode (due to failed parse?)
        if (!tree.rootNode) { 
            return null;
        }
        return tree.rootNode.namedDescendantForPosition({ row: line, column });
    }

    public wordAtPoint(document: LspDocument, line: number, column: number): string | null {
        const node = this.nodeAtPoint(document, line, column)
        if (!node || node.childCount > 0 || node.text.trim() === '') return null;

        return node.text.trim();
    }

    public commandAtPoint(document: LspDocument, line: number, column: number): SyntaxNode | null {
        const tree = this.uriTree[document.uri]
        if (tree === undefined) return null;
        const node = findNodeAt(tree, line, column)
        const parent = node?.parent;
        if (parent) {
            if (isCommand(parent)) {
                return parent;
            }
            if (isCommandName(parent)) {
                return parent.parent!
            }
        } else if (node) {
            if (isCommand(node)) {
                return node;
            } else if (isCommandName(node)) {
                return node.parent;
            }
        }
        return null;
    }

    public getNodes(document: LspDocument): SyntaxNode[] {
        return getChildNodes(this.parser.parse(document.getText()).rootNode);
    }

    public getNodesInRange(document: LspDocument, range: LSP.Range): SyntaxNode[] {
        const root = this.parser.parse(document.getText()).rootNode;
        return getChildNodes(root).filter(node => containsRange(range, getRange(node)));
    }

}
