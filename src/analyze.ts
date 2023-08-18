import { Hover, MarkupContent, MarkupKind, Position, PublishDiagnosticsParams, SymbolInformation, SymbolKind, WorkspaceSymbol, URI, CallHierarchyOutgoingCall } from "vscode-languageserver";
import Parser, { SyntaxNode, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import { containsRange, precedesRange } from './workspace-symbol'
import { isPositionWithinRange, findFirstParent , getChildNodes, getRange, isNodeWithinRange, equalRanges, findEnclosingScope} from './utils/tree-sitter';
import { LspDocument } from './document';
import { isCommand, isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariable, isVariableDefinition} from './utils/node-types';
import { DiagnosticQueue } from './diagnostics/queue';
import {pathToRelativeFunctionName, toLspDocument, uriInUserFunctions, uriToPath} from './utils/translation';
import { DocumentationCache } from './utils/documentationCache';
import { DocumentSymbol } from 'vscode-languageserver';
import { GlobalWorkspaceSymbol } from './symbols';
import fs from 'fs'
import { SymbolTree } from './symbolTree';
import { FishWorkspace, Workspace } from './utils/workspace';
import { collectFishWorkspaceSymbols, FishWorkspaceSymbol } from './utils/fishWorkspaceSymbol';
import { filterGlobalSymbols, filterLastPerScopeSymbol, findLastDefinition, findSymbolsForCompletion, FishDocumentSymbol, getFishDocumentSymbols, isGlobalSymbol, isUniversalSymbol, symbolIsImmutable } from './document-symbol';
import { GenericTree } from './utils/generic-tree';
import { FishCompletionItem, FishCompletionData } from './utils/completion-strategy';

export class Analyzer {

    protected parser: Parser;
    public workspaces: FishWorkspace[];
    public cache: AnalyzedDocumentCache = new AnalyzedDocumentCache();
    public globalSymbols: GlobalDefinitionCache = new GlobalDefinitionCache();
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();

    constructor(parser: Parser, workspaces: FishWorkspace[] = []) {
        this.parser = parser;
        this.workspaces = workspaces;
    }

    public analyze(document: LspDocument) {
        this.parser.reset()
        const analyzedDocument = this.getAnalyzedDocument(this.parser, document);
        this.cache.setDocument(document.uri, analyzedDocument);
        const symbols = this.cache.getDocumentSymbols(document.uri)
        filterGlobalSymbols(symbols).forEach((symbol: FishDocumentSymbol) => {
            this.globalSymbols.add(symbol);
        })
        return this.cache.getDocumentSymbols(document.uri);
    }

    private getAnalyzedDocument(parser: Parser, document: LspDocument): AnalyzedDocument {
        const tree = parser.parse(document.getText());
        const documentSymbols =  getFishDocumentSymbols(document.uri, tree.rootNode);
        const commands = this.getCommandNames(document);
        return AnalyzedDocument.create(document, documentSymbols, commands, tree);
    }

    public async initiateBackgroundAnalysis() : Promise<{ filesParsed: number }> {
        let amount = 0;
        this.workspaces.forEach(workspace => {
            workspace
                .urisToLspDocuments()
                .filter((doc: LspDocument) => doc.shouldAnalyzeInBackground())
                .forEach((doc: LspDocument) => {
                    try {
                        this.analyze(doc);
                        amount++;
                    } catch (err) {
                        console.error(err)
                    }
                })
        })
        return { filesParsed: amount };
    }

    public getDocumentSymbols(document: LspDocument, types: 'variables' | 'functions' | 'clientTree' | 'all' = 'all'): FishDocumentSymbol[] {
        const symbols = this.cache.getDocumentSymbols(document.uri);
        switch (types) {
            case 'variables':
                return symbols.filter((symbol: FishDocumentSymbol) => SymbolKind.Variable === symbol.kind);
            case 'functions':
                return symbols.filter((symbol: FishDocumentSymbol) => SymbolKind.Function === symbol.kind);
            case 'clientTree':
                return filterLastPerScopeSymbol(symbols)
            case 'all':
                return symbols
        }
        return this.cache.getDocumentSymbols(document.uri) || [];
    }

    public findDocumentSymbol(document: LspDocument, position: Position): FishDocumentSymbol | undefined {
        const symbols = FishDocumentSymbol.flattenArray(this.cache.getDocumentSymbols(document.uri))
        return symbols.find(symbol => isPositionWithinRange(position, symbol.selectionRange));
    }

    
    /**
     * method that returns all the workspaceSymbols that are in the same scope as the given 
     * shell
     * @returns {WorkspaceSymbol[]} array of all symbols
     */
    public getWorkspaceSymbols(query: string = ""): WorkspaceSymbol[] {
        return this.globalSymbols.allSymbols
                .map(s => FishDocumentSymbol.toWorkspaceSymbol(s))
                .filter((symbol: WorkspaceSymbol) => {
                    return symbol.name.startsWith(query)
                })
    }

    public getDefinition(document: LspDocument, position: Position): LSP.Location[] {
        const symbols: FishDocumentSymbol[] = [];
        const localSymbol = this.findDocumentSymbol(document, position)
        if (localSymbol) symbols.push(localSymbol)
        const tree = this.getTree(document)
        const node = this.nodeAtPoint(document.uri, position.line, position.character);
        if (!tree || !node) return [];
        if (symbols.length === 0) symbols.push(...this.globalSymbols.find(node.text))
        return symbols.map(symbol => FishDocumentSymbol.toLocation(symbol)) || [];
    }

    public getHover(document: LspDocument, position: Position): Hover | null {
        const tree = this.getTree(document)
        const node = this.nodeAtPoint(document.uri, position.line, position.character);
        if (!tree || !node) return null;
        const symbol = this.findDocumentSymbol(document, position) || this.globalSymbols.findFirst(node.text);
        if (symbol) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: symbol.detail,
                } as MarkupContent
            }
        }
        return null;
    }

    public findCompletions(document: LspDocument, position: Position, data: FishCompletionData): FishCompletionItem[] {
        const symbols = this.cache.getDocumentSymbols(document.uri);
        const localSymbols = findSymbolsForCompletion(symbols, position)

        const globalSymbols = 
            this.globalSymbols
            .uniqueSymbols()
            .filter(s => !localSymbols.some(l => s.name === l.name))
            .map(s => FishDocumentSymbol.toGlobalCompletion(s, data));

        return [
            ...localSymbols.map(s => FishDocumentSymbol.toLocalCompletion(s, data)),
            ...globalSymbols
        ]
    }

    getTree(document: LspDocument) {
        return this.cache.getDocument(document.uri)?.tree;
    }

    /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
    getRootNode(document: LspDocument): SyntaxNode | undefined {
        return this.cache.getParsedTree(document.uri)?.rootNode
    }

    getDocument(documentUri: string): LspDocument | undefined {
        return this.cache.getDocument(documentUri)?.document;
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
        word: string;
        lineRootNode: SyntaxNode;
        lineLastNode: SyntaxNode;
    } {
        //const linePreTrim: string = document.getLineBeforeCursor(position);
        //const line = linePreTrim.slice(0,linePreTrim.lastIndexOf('\n'));
        const line = document.getLineBeforeCursor(position).replace(/^(.*)\n$/, '$1')
        const word =
            this.wordAtPoint(
                document.uri,
                position.line,
                Math.max(position.character - 1, 0)
            ) || "";
        const lineRootNode = this.parser.parse(line).rootNode;
        const lineLastNode = lineRootNode.descendantForPosition({
            row: 0,
            column: line.length - 1,
        });
        return { line, word, lineRootNode, lineLastNode };
    }
    public wordAtPoint(uri: string, line: number, column: number): string | null {
        const node = this.nodeAtPoint(uri, line, column)

        if (!node || node.childCount > 0 || node.text.trim() === '') {
            return null
        }

        return node.text.trim()
    }
    /**
   * Find the node at the given point.
   */
    public nodeAtPoint(
        uri: string,
        line: number,
        column: number,
    ): Parser.SyntaxNode | null {
        const tree = this.cache.getParsedTree(uri)
        if (!tree?.rootNode) {
            // Check for lacking rootNode (due to failed parse?)
            return null
        }
        return tree.rootNode.descendantForPosition({ row: line, column })
    }

    /**
   * Find the name of the command at the given point.
   */
    public commandNameAtPoint(uri: string, line: number, column: number): string | null {
        let node = this.nodeAtPoint(uri, line, column)

        while (node && !isCommand(node)) {
            node = node.parent
        }

        if (!node) {
            return null
        }

        const firstChild = node.firstNamedChild

        if (!firstChild || !isCommandName(firstChild)) {
            return null
        }

        return firstChild.text.trim()
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

    public isRenamablePosition(doc: LspDocument, position: Position): boolean {
        const { currentNode } = this.parsePosition(doc, position);
        if (!currentNode) return false;

        const localSymbol = this.findDocumentSymbol(doc, position);
        if (localSymbol) return true;

        if (this.globalSymbols.has(currentNode.text)) {
            const globalSymbol = this.globalSymbols.find(currentNode.text);
            for (const symbol of globalSymbol) {
                if (symbolIsImmutable(symbol)) {
                    return true;
                }
            }
        }
        return false;
    }


    public getRenames(doc: LspDocument, position: Position): LSP.Location[] {
        const currentNode = this.nodeAtPoint(doc.uri, position.line, position.character)
        if (!currentNode) return [];

        const renames : LSP.Location[] = [];

        const pushRename = (uri: string, range: LSP.Range) => {
            if (!renames.some((rename) => rename.uri === uri && equalRanges(rename.range, range))) {
                renames.push({
                    uri,
                    range,
                })
            }
        }

        // first we check the current document
        const foundLocal = this.findDocumentSymbol(doc, position);
        if (foundLocal) {
            const { scopeNode } = foundLocal.scope;
            getChildNodes(scopeNode).forEach((node) => {
                if (node.text === foundLocal.name) {
                    pushRename(doc.uri, getRange(node))
                }
            })
            return renames;
        } 

        const containingWorkspace = this.workspaces.find((workspace) => workspace.contains(doc.uri));
        //this.workspaces.forEach((w) => console.log(w.path, doc.uri))
        //console.log();
        //console.log(containingWorkspace);
        if (!containingWorkspace) return [];

        containingWorkspace.forEach((doc: LspDocument) => {
            const root = this.cache.getParsedTree(doc.uri)?.rootNode;
            if (!root) return
            const symbols = this.cache
                .getFlatDocumentSymbols(doc.uri)
                .some((symbol) => symbol.name === currentNode.text);
            const commands = this.cache
                .getCommands(doc.uri)
                .includes(currentNode.text);
            if (commands || symbols) {
                const foundRefs = getReferences(doc.uri, root, currentNode)
                renames.push(...foundRefs)
            }

        })
        return renames;
        
        // then we check the global symbols
        //if (currentNode && this.globalSymbols.has(currentNode.text)) {
        //    const configSymbols = this.globalSymbols
        //        .find(currentNode.text)
        //        .filter(symbolIsImmutable);

        //    if (!configSymbols) return [];

        //    const editableWorkspaces = this.workspaces.filter((workspace) =>
        //        configSymbols.some((symbol) => workspace.contains(symbol.uri))
        //    )

        //    for (const workspace of editableWorkspaces) {
        //        workspace.uris.forEach((uri) => {
        //            const root = this.cache.getParsedTree(uri)?.rootNode;
        //            if (!root) return [];
        //            getChildNodes(root)
        //                .filter((node) => node.text === currentNode.text)
        //                .map((node) => {
        //                    pushRename(uri, getRange(node))
        //                })
        //        })
        //    }
        //    return renames
        //} 
        //return [];
    }


}
export function getReferences(
    uri: string,
    root: SyntaxNode,
    current: SyntaxNode
): LSP.Location[] {
    return (
        getChildNodes(root)
            .filter((n) => n.text === current.text)
            .filter(
                (n) =>
                    isVariable(n) ||
                    isFunctionDefinitionName(n) ||
                    isCommandName(n)
            )
            .filter((n) =>
                containsRange(
                    getRange(findEnclosingScope(n)),
                    getRange(current)
                )
            )
            .map((n) => LSP.Location.create(uri, getRange(n))) || []
    );
}

export class GlobalDefinitionCache {
    constructor(private _definitions: Map<string, FishDocumentSymbol[]> = new Map()) {}
    add(symbol: FishDocumentSymbol) {
        const current = this._definitions.get(symbol.name) || [];
        if (!current.some(s => FishDocumentSymbol.equal(s, symbol))) {
            current.push(symbol);
        }
        this._definitions.set(symbol.name, current);
    }   
    find(name: string): FishDocumentSymbol[] {
        return this._definitions.get(name) || [];
    }
    findFirst(name: string): FishDocumentSymbol | undefined {
        const symbols = this.find(name);
        if (symbols.length === 0) return undefined;
        return symbols[0];
    }
    has(name: string): boolean {
        return this._definitions.has(name);
    }
    uniqueSymbols(): FishDocumentSymbol[] {
        const unique: FishDocumentSymbol[] = [];
        this.allNames.forEach(name => {
            const u = this.findFirst(name);
            if (u) unique.push(u);
        });
        return unique;
    }
    get allSymbols(): FishDocumentSymbol[] {
        const all: FishDocumentSymbol[] = [];
        for (const [_, symbols] of this._definitions.entries()) {
            all.push(...symbols);
        }
        return all;

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

export namespace AnalyzedDocument {
    export function create(document: LspDocument, documentSymbols: FishDocumentSymbol[], commands: string[], tree: Parser.Tree): AnalyzedDocument {
        return {
            document,
            documentSymbols,
            commands,
            tree,
        }
    }
}

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
    getFlatDocumentSymbols(uri: URI): FishDocumentSymbol[] {
        return FishDocumentSymbol.flattenArray(this.getDocumentSymbols(uri));
    }
    getCommands(uri: URI): string[] {
        return this._documents.get(uri)?.commands || [];
    }
    getRootNode(uri: URI): Parser.SyntaxNode | undefined {
        return this.getParsedTree(uri)?.rootNode;
    }
    getParsedTree(uri: URI): Parser.Tree | undefined {
        return this._documents.get(uri)?.tree;
    }
    getSymbolTree(uri: URI): GenericTree<FishDocumentSymbol> {
        const document = this.getDocument(uri);
        if (!document) return new GenericTree<FishDocumentSymbol>([]);
        return new GenericTree<FishDocumentSymbol>(document.documentSymbols);
    }
    /**
     * Name is a string that will be searched across all symbols in cache. tree-sitter-fish
     * type of symbols that will be searched is 'word' (i.e. variables, functions, commands)
     * @param {string} name - string SyntaxNode.name to search in cache
     * @returns {map<URI, SyntaxNode[]>} - map of URIs to SyntaxNodes that match the name
     */
    findMatchingNames(name: string): Map<URI, SyntaxNode[]> {
        const matches = new Map<URI, SyntaxNode[]>();
        this.forEach((uri, doc) => {
            const root = doc.tree.rootNode;
            const nodes = root.descendantsOfType('word').filter(node => node.text === name);
            if (nodes.length > 0) matches.set(uri, nodes);
        });
        return matches;
    }
    forEach(callbackfn: (uri: URI, document: AnalyzedDocument) => void) {
        for (const [uri, document] of this._documents) {
            callbackfn(uri, document);
        }
    }
    filter(callbackfn: (uri: URI, document?: AnalyzedDocument) => boolean): AnalyzedDocument[] {
        const result: AnalyzedDocument[] = [];
        this.forEach((currentUri, currentDocument) => {
            if (callbackfn(currentUri, currentDocument)) result.push(currentDocument);
        })
        return result
    }
    mapUris<U>(callbackfn: (doc: AnalyzedDocument) => U, uris: URI[] = this.uris()): U[] {
        const result: U[] = [];
        for (const uri of uris) {
            const doc = this.getDocument(uri);
            if (!doc) continue;
            result.push(callbackfn(doc));
        }
        return result;
    }
}

export class SymbolCache {
    constructor(
        private _names: Set<string> = new Set(),
        private _variables: Map<string, FishDocumentSymbol[]> = new Map(),
        private _functions: Map<string, FishDocumentSymbol[]> = new Map(),
    ) {}
    
    add(symbol: FishDocumentSymbol) {
        const oldVars = this._variables.get(symbol.name) || [];
        switch (symbol.kind) {
            case SymbolKind.Variable:
                this._variables.set(symbol.name, [...oldVars, symbol]);
                break;
            case SymbolKind.Function:
                this._functions.set(symbol.name, [...oldVars, symbol]);
                break;
        }
        this._names.add(symbol.name);
    }

    isVariable(name: string): boolean {
        return this._variables.has(name);
    }

    isFunction(name: string): boolean {
        return this._functions.has(name);
    }

    has(name: string): boolean {
        return this._names.has(name);
    }

}

const MatchesNeedle = (needle: SyntaxNode, symbol: FishDocumentSymbol) => symbol.name === needle.text && precedesRange(symbol.selectionRange, getRange(needle))
/**
 * recursive function that finds all variable definitions in a given syntax tree,
 * returning an array of FishDocumentSymbols that are in heirarchical order, and before
 * needle
 */
export function findLocalDefinitionSymbol(allSymbols: FishDocumentSymbol[], needle: SyntaxNode) : FishDocumentSymbol[] {
    return bfs(allSymbols, needle)
}

const bfs = (root: FishDocumentSymbol[], needle: SyntaxNode, results: FishDocumentSymbol[] = []) => {
    if (!root) return results;

    const q: FishDocumentSymbol[] = [...root]
    const scopeQ: boolean[] = [...root.map((node) => true)]

    while (q.length > 0) {
        const node = q.shift();
        const pScope = scopeQ.shift();
        if (!node || pScope === undefined) continue;
        if (
            node.name === needle.text &&
            precedesRange(node.selectionRange, getRange(needle)) &&
            pScope
        ) {
            results.push(node);
        }
        if (containsRange(node.range, getRange(needle))) {
            for (let child of node.children) {
                q.unshift(child)
                scopeQ.unshift(true)
            } 
        }
    }
    return results
}

export function findDefs(allSymbols: FishDocumentSymbol[], needle: SyntaxNode): FishDocumentSymbol[] {
    const needleScopeQueue: SyntaxNode[] = findParentScopes(needle);
    const results: FishDocumentSymbol[] = []

    while (needleScopeQueue.length > 0) {
        const scope = needleScopeQueue.shift();
        if (!scope) continue;
        const possibleSymbols = allSymbols.filter((symbol) =>  containsRange(getRange(scope), symbol.range))
        if (possibleSymbols.length > 0) {
            const found = possibleSymbols.filter((symbol) => MatchesNeedle(needle, symbol)) || []
            results.unshift(...found);
        }
    }
    return results
}

export function findParentScopes(needle: Parser.SyntaxNode) {
    const scopes: Parser.SyntaxNode[] = [];
    let current = needle.parent;
    while (current) {
        if (isScope(current)) {
            scopes.push(current);
        }
        current = current.parent;
    }
    return scopes;
}