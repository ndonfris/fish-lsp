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
        const tree = this.parser.parse(document.getText());
        if (!uri) return;
        if (!tree?.rootNode) return;
        this.uriTree[uri] = tree;
        if (!useCache) {
            this.diagnosticQueue.clear(uri);
        }
        this.diagnosticQueue.set(
            uri,
            collectDiagnosticsRecursive(tree.rootNode, document)
        );
    }

    /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
    public getRootNode(
        document: LspDocument,
        useCache: boolean = true
    ): SyntaxNode | undefined {
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
        };
    }

    clear(doc: LspDocument) {
        this.diagnosticQueue.clear(doc.uri);
    }

    /**
     * Find the node at the given point.
     */
    public nodeAtPoint(
        document: LspDocument,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {
        const tree = this.uriTree[document.uri];
        // Check for lacking rootNode (due to failed parse?)
        if (!tree?.rootNode) {
            return null;
        }
        return tree.rootNode.descendantForPosition({ row: line, column });
    }

    public namedNodeAtPoint(
        document: LspDocument,
        line: number,
        column: number
    ): Parser.SyntaxNode | null {
        const tree = this.uriTree[document.uri];
        // Check for lacking rootNode (due to failed parse?)
        if (!tree.rootNode) {
            return null;
        }
        return tree.rootNode.namedDescendantForPosition({ row: line, column });
    }

    public wordAtPoint(
        document: LspDocument,
        line: number,
        column: number
    ): string | null {
        const node = this.nodeAtPoint(document, line, column);
        if (!node || node.childCount > 0 || node.text.trim() === "")
            return null;

        return node.text.trim();
    }

    public commandAtPoint(
        document: LspDocument,
        line: number,
        column: number
    ): SyntaxNode | null {
        const tree = this.uriTree[document.uri];
        if (tree === undefined) return null;
        const node = findNodeAt(tree, line, column);
        const parent = node?.parent;
        if (parent) {
            if (isCommand(parent)) {
                return parent;
            }
            if (isCommandName(parent)) {
                return parent.parent!;
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

   /**
    * Returns an object to be deconstructed, for the onComplete function in the server.
    * This function is necessary because the normal onComplete parse of the LspDocument
    * will commonly throw errors (user is incomplete typing a command, etc.). To avoid
    * inaccurate parses for the entire document, we instead parse just the current line
    * that the user is on, and send it to the shell script to complete. 
    *
    * @Note: the position should not edited (pass in the direct position from the CompletionParams)
    *
    * @returns 
    *        line - the string output of the line the cursor is on
    *        lineRootNode - the rootNode for the line that the cursor is on
    *        lineCurrentNode - the last node in the line
    */
    public parseCurrentLine(document: LspDocument, position: Position): {
        line: string,
        lineRootNode: SyntaxNode,
        lineLastNode: SyntaxNode,
    } {
        const line: string = document.getLineBeforeCursor(position);
        const lineRootNode = this.parser.parse(line).rootNode;
        const lineLastNode = lineRootNode.descendantForPosition({
            row: 0,
            column: line.length - 1,
        });
        return { line, lineRootNode, lineLastNode };
    }

    public getNodes(document: LspDocument): SyntaxNode[] {
        return getChildNodes(this.parser.parse(document.getText()).rootNode);
    }

    public getNodesInRange(
        document: LspDocument,
        range: LSP.Range
    ): SyntaxNode[] {
        const root = this.parser.parse(document.getText()).rootNode;
        return getChildNodes(root).filter((node) =>
            containsRange(range, getRange(node))
        );
    }
}
