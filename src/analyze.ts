import { Hover, MarkupContent, MarkupKind, Position, PublishDiagnosticsParams, SymbolInformation, SymbolKind, WorkspaceSymbol, URI } from "vscode-languageserver";
import Parser, { SyntaxNode, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import { containsRange } from './workspace-symbol'
import { findFirstParent , getChildNodes, getRange} from './utils/tree-sitter';
import { LspDocument } from './document';
import { isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition} from './utils/node-types';
import { DiagnosticQueue } from './diagnostics/queue';
import {pathToRelativeFunctionName, toLspDocument, uriInUserFunctions, uriToPath} from './utils/translation';
import { DocumentationCache } from './utils/documentationCache';
import { DocumentSymbol } from 'vscode-languageserver';
import { GlobalWorkspaceSymbol } from './symbols';
import fs from 'fs'
import { SymbolTree } from './symbolTree';
import { Workspace } from './utils/workspace';
import { collectFishWorkspaceSymbols, FishWorkspaceSymbol } from './utils/fishWorkspaceSymbol';
import { filterGlobalSymbols, FishDocumentSymbol, getFishDocumentSymbols, isGlobalSymbol, isUniversalSymbol } from './document-symbol';


export class Analyzer {
    protected parser: Parser;
    public workspaces: Workspace[];
    public cache: AnalyzedDocumentCache = new AnalyzedDocumentCache();
    public globalSymbols: GlobalDefinitionCache = new GlobalDefinitionCache();
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();

    constructor(parser: Parser, workspaces: Workspace[]) {
        this.parser = parser;
        this.workspaces = workspaces;
    }

    public analyze(document: LspDocument) {
        this.parser.reset()
        const analyzedDocument = this.getAnalyzedDocument(this.parser, document);
        this.cache.setDocument(document.uri, analyzedDocument);
        this.cache.getDocumentSymbols(document.uri)
            .filter((symbol: FishDocumentSymbol) => isGlobalSymbol(symbol) || isUniversalSymbol(symbol))
            .forEach((symbol: FishDocumentSymbol) => {
                this.globalSymbols.add(symbol);
            })
        return this.cache.getDocumentSymbols(document.uri);
    }

    private getAnalyzedDocument(parser: Parser, document: LspDocument): AnalyzedDocument {
        const tree = parser.parse(document.getText());
        const documentSymbols =  getFishDocumentSymbols(document.uri, tree.rootNode);
        const commands = this.getCommandNames(document);
        return {
            document,
            documentSymbols,
            commands,
            tree,
        };
    }

    public async initiateBackgroundAnalysis() : Promise<{ filesParsed: number }> {
        let amount = 0;
        for (const workspace of this.workspaces) {
            await workspace.initializeFiles()
            workspace.docs.forEach((doc: LspDocument) => {
                try {
                    this.analyze(doc);
                    amount++;
                } catch (err) {
                    console.error(err)
                }
            })
        }
        return { filesParsed: amount };
    }

    
    /**
     * method that returns all the workspaceSymbols that are in the same scope as the given 
     * shell
     * @returns {WorkspaceSymbol[]} array of all symbols
     */
    public getWorkspaceSymbols(query: string = ""): WorkspaceSymbol[] {
        const results : WorkspaceSymbol[] = 
            this.globalSymbols.allSymbols.map(s => FishDocumentSymbol.toWorkspaceSymbol(s));
        return query === '' || query.trim() === ''
            ? results 
            : results.filter((symbol: WorkspaceSymbol) => {
                symbol.name.includes(query)
            });
    }

    public getHover(document: LspDocument, position: Position): Hover | null {
        const tree = this.getTree(document)
        if (!tree) return null;
        const node = this.nodeAtPoint(document, position.line, position.character);
        if (!node || !this.globalSymbols.has(node.text)) return null
        const symbols = this.globalSymbols.find(node.text);
        if (!this.globalSymbols.has(node.text) || symbols.length === 0) return null;
        const symbol = symbols[0];
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: symbol.detail,
            } as MarkupContent
        }
    }

    getTree(document: LspDocument) {
        return this.cache.getDocument(document.uri)?.tree;
    }

    /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
    getRootNode(document: LspDocument): SyntaxNode | undefined {
        return this.cache.getTree(document.uri)?.rootNode
    }


    public parsePosition(document: LspDocument, position: Position): {root: SyntaxNode | null, currentNode: SyntaxNode | null} {
        const root = this.getRootNode(document) || null;
        return {
            root: root,
            currentNode: root?.descendantForPosition({
                row: position.line,
                column: Math.max(0, position.character - 1),
            }) || null,
        };
    }

    /**
     * Find the node at the given point.
     */
    public nodeAtPoint(document: LspDocument,line: number,column: number): Parser.SyntaxNode | null {
        const root = this.getRootNode(document)
        // Check for lacking rootNode (due to failed parse?)
        return root?.descendantForPosition({ row: line, column }) || null
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
        lastWord: string;
        lineRootNode: SyntaxNode;
        lineLastNode: SyntaxNode;
    } {
        //const linePreTrim: string = document.getLineBeforeCursor(position);
        //const line = linePreTrim.slice(0,linePreTrim.lastIndexOf('\n'));
        const line = document.getLineBeforeCursor(position).replace(/^(.*)\n$/, '$1')
        const lastWord = line.slice(line.lastIndexOf(' ')+1) || ""
        const lineRootNode = this.parser.parse(line).rootNode;
        const lineLastNode = lineRootNode.descendantForPosition({
            row: 0,
            column: line.length - 1,
        });
        return { line, lastWord, lineRootNode, lineLastNode };
    }

    public getNodes(document: LspDocument): SyntaxNode[] {
        return getChildNodes(this.parser.parse(document.getText()).rootNode);
    }

    public getNodesInRange(document: LspDocument, range: LSP.Range): SyntaxNode[] {
        const root = this.parser.parse(document.getText()).rootNode;
        return getChildNodes(root).filter((node) => containsRange(range, getRange(node)));
    }

    private getCommandNames(document: LspDocument): string[] {
        const allCommands = this.getNodes(document)
            .filter((node) => isCommandName(node))
            .map((node) => node.text);
        const result = new Set(allCommands);
        return Array.from(result);
    }

    public clearDiagnostics(doc: LspDocument) {
        this.diagnosticQueue.clear(doc.uri);
    }

    public getDiagnostics(doc: LspDocument): PublishDiagnosticsParams {
        return {
            uri: doc.uri,
            diagnostics: this.diagnosticQueue.get(doc.uri) || [],
        };
    }

}

export class GlobalDefinitionCache {
    constructor(private _definitions: Map<string, FishDocumentSymbol[]> = new Map()) {}
    add(symbol: FishDocumentSymbol) {
        return this._definitions.has(symbol.name) 
            ? this._definitions.set(symbol.name, [...this.find(symbol.name), symbol]) 
            : this._definitions.set(symbol.name, [symbol]);
    }   
    find(name: string): FishDocumentSymbol[] {
        return this._definitions.get(name) || [];
    }
    has(name: string): boolean {
        return this._definitions.has(name);
    }
    get allSymbols(): FishDocumentSymbol[] {
        return [...this._definitions.values()].flat();
    }
    get allNames(): string[] {
        return [...this._definitions.keys()];
    }
    get map() { return this._definitions };
}

type AnalyzedDocument = {
    document: LspDocument,
    documentSymbols: FishDocumentSymbol[],
    commands: string[],
    tree: Parser.Tree
};

export class AnalyzedDocumentCache {
    constructor(private _documents: Map<URI, AnalyzedDocument> = new Map()) {}
    uris(): string[] {
        return [...this._documents.keys()];
    }
    setDocument(uri: URI, analyzedDocument: AnalyzedDocument) {
        this._documents.set(uri, analyzedDocument);
    }
    getDocument(uri: URI): AnalyzedDocument | undefined {
        if (!this._documents.has(uri)) return undefined;
        return this._documents.get(uri);
    }
    getDocumentSymbols(uri: URI): FishDocumentSymbol[] {
        return this._documents.get(uri)?.documentSymbols || [];
    }
    getCommands(uri: URI): string[] {
        return this._documents.get(uri)?.commands || [];
    }
    getTree(uri: URI): Parser.Tree | undefined {
        return this._documents.get(uri)?.tree;
    }
    get map() { return this._documents }
}