import { CompletionItem, Connection, Diagnostic, DocumentUri, Hover, Location, Position, PublishDiagnosticsParams, RemoteConsole, TextDocumentPositionParams, } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Point, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import {containsRange, getDefinitionSymbols} from './workspace-symbol'
import {SymbolKind} from 'vscode-languageserver';
import {findEnclosingScope, findNodeAt, getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isCommand, isCommandName, isDefinition, isVariable} from './utils/node-types';
import {DiagnosticQueue} from './diagnostics/queue';
import {toLspDocument, uriToPath} from './utils/translation';
import {collectDiagnosticsRecursive, /* getDiagnostics */} from './diagnostics/validate';
import { DocumentationCache } from './utils/documentationCache';
import { DocumentSymbol } from 'vscode-languageserver';
import { toSymbolKind } from './symbols';
import { execOpenFile } from './utils/exec';

export class Analyzer {

    private parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    private uriTree: { [uri: string]: Tree };
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();

    private uriToSymbols: { [uri: string]: DocumentSymbol[]} = {};
    private globalSymbolsCache: DocumentationCache;

    constructor(parser: Parser, globalSymbolsCache: DocumentationCache) {
        this.parser = parser;
        this.uriTree = {};
        this.globalSymbolsCache = globalSymbolsCache;
    }

    public analyze(document: LspDocument) {
        const uri = document.uri;
        const tree = this.parser.parse(document.getText());
        if (!uri) return;
        if (!tree?.rootNode) return;
        this.uriTree[uri] = tree;
        this.uriToSymbols[uri] = getDefinitionSymbols(tree.rootNode)
        this.diagnosticQueue.set(
            uri,
            collectDiagnosticsRecursive(tree.rootNode, document)
        );
        return this.uriToSymbols[uri]
    }


    public async getDocumentation(document: LspDocument, node: SyntaxNode) {
        const localSymbols = this.uriToSymbols[document.uri].filter((symbol) => {
            return symbol.name === node.text
        });
        if (localSymbols.length > 0) {
            return localSymbols[0].detail
        }
        if (!localSymbols) {
            const documentation = await this.globalSymbolsCache.resolve(node.text);
            if (documentation) {
                return documentation.docs;
            }
        }
        return null;
    }

    public getRefrences(document: LspDocument, node: SyntaxNode): Location[] {
        const references: Location[] = [];
        const parent = findEnclosingScope(node)
        const childNodes = getChildNodes(parent);
        childNodes.forEach((child) => {
            if (child.text === node.text) {
                references.push({
                    uri: document.uri,
                    range: getRange(child),
                });
            };
        });
        return references;
    }

    protected getLocalDefinitionSymbols(document: LspDocument,node: SyntaxNode, symbols: DocumentSymbol[]): DocumentSymbol[] {
        if (this.hasLocalSymbol(document, node)) {
            let localSymbol: DocumentSymbol[];
            if (!isVariable(node)) {
                localSymbol = scopedFunctionDefinitionSymbols(symbols, node)
            } else {
                localSymbol = scopedVariableDefinitionSymbols(symbols, node) || []
            }
            if (localSymbol) {
                return localSymbol
            }
        }
        return []
    }

    public async getDefinition(document: LspDocument, node: SyntaxNode): Promise<DocumentSymbol[]> {
        if (this.hasLocalSymbol(document, node)) {
            return this.getLocalDefinitionSymbols(document, node, this.uriToSymbols[document.uri] )
        }
        await this.globalSymbolsCache.resolve(node.text)
        const globalSymbol = this.globalSymbolsCache.getItem(node.text)
        if (!globalSymbol?.uri) return []
        const fileText = await execOpenFile(globalSymbol.uri)
        const newDoc = toLspDocument(globalSymbol.uri, fileText)
        if (!newDoc) return []
        this.analyze(newDoc)
        return this.getLocalDefinitionSymbols(newDoc, node, this.uriToSymbols[globalSymbol.uri])
    }

    public hasLocalSymbol(docuemnt: LspDocument, node: SyntaxNode): boolean {
        const symbols = this.uriToSymbols[docuemnt.uri]
        return symbols.some((symbol: DocumentSymbol) => {
            return symbol.name === node.text
        }) || false;
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

    public parsePosition(
        document: LspDocument,
        position: Position
    ): {
        root: SyntaxNode,
        currentNode: SyntaxNode
    } {
        return {
            root: this.parser.parse(document.getText()).rootNode,
            currentNode: this.parser
                .parse(document.getText())
                .rootNode.descendantForPosition({
                    row: position.line,
                    column: position.character,
                }),
        };
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
    public parseCurrentLine(
        document: LspDocument,
        position: Position
    ): {
        line: string;
        lineRootNode: SyntaxNode;
        lineLastNode: SyntaxNode;
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


function scopedFunctionDefinitionSymbols(allSymbols: DocumentSymbol[], node: SyntaxNode) : DocumentSymbol[] {
    const symbolStack : DocumentSymbol[] = [...allSymbols];
    let currentSymbol: DocumentSymbol | undefined;
    while (symbolStack.length > 0) {
        currentSymbol = symbolStack.shift();
        if (!currentSymbol) break;
        if (currentSymbol.kind === SymbolKind.Function && currentSymbol.name === node.text) {
            return [currentSymbol];
        }
        if (currentSymbol?.children) {
            symbolStack.unshift(...currentSymbol?.children);
        }
    }
    return [];
}

function scopedVariableDefinitionSymbols(allSymbols: DocumentSymbol[], node: SyntaxNode) : DocumentSymbol[] {
    const symbolStack : DocumentSymbol[] = [...allSymbols];
    let currentSymbol: DocumentSymbol | undefined;
    while (symbolStack.length > 0) {
        currentSymbol = symbolStack.shift();
        if (!currentSymbol) break;
        if (currentSymbol.kind === SymbolKind.Function) {
            if ( currentSymbol.children && containsRange(currentSymbol.range, getRange(node))) {
                symbolStack.unshift(...currentSymbol?.children);
            }
        } else if (currentSymbol.name === node.text) {
            return [currentSymbol];
        }
    }
    return [];
}

