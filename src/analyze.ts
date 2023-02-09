import { Hover, MarkupContent, MarkupKind, Position, PublishDiagnosticsParams, SymbolInformation, SymbolKind, WorkspaceSymbol, } from "vscode-languageserver";
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
import { FishWorkspaces, Workspace } from './utils/workspace';
import { collectFishWorkspaceSymbols, FishWorkspaceSymbol } from './utils/fishWorkspaceSymbol';

type SourceCommand = {
    name: string,
    uri: string,
}
type GlobalDefinition = { [name: string] : WorkspaceSymbol[] }
type uriToAnalyzedDocument = {
    document: LspDocument,
    documentSymbols: SymbolTree,
    globalDefinitions: WorkspaceSymbol[],
    sourcedUris: SourceCommand[]
    tree: Parser.Tree
}

export class Analyzer {
    protected parser: Parser;
    // maps the uri of document to the parser.parse(document.getText())
    protected uriTree: { [uri: string]: Tree };
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();
    protected uriToTreeMap: Map<string, Tree> = new Map();
    public uriToAnalyzedDocument: {[uri: string]: uriToAnalyzedDocument} = {}
    public workspaceSymbols: Map<string, WorkspaceSymbol[]> = new Map();

    public allUris: string[] = [];
    public lookupUriMap: Map<string, string> = new Map();
    public workspaces: FishWorkspaces;

    private uriToSymbols: { [uri: string]: DocumentSymbol[]} = {};
    private globalSymbolsCache: DocumentationCache;

    constructor(parser: Parser, globalSymbolsCache: DocumentationCache, workspaces: FishWorkspaces) {
        this.parser = parser;
        this.workspaces = workspaces;
        this.uriTree = {};
        this.globalSymbolsCache = globalSymbolsCache;
        //this.allUris = allUris;
        this.allUris = workspaces.workspaces.map((ws: Workspace) => ws.files).flat();
        this.workspaces = workspaces;
        this.lookupUriMap = createLookupUriMap(this.allUris);
    }

    public analyze(document: LspDocument) {
        const uri = document.uri;
        this.parser.reset()
        const tree = this.parser.parse(document.getText());
        this.uriToTreeMap.set(document.uri, tree)
        const sourcedUris = uniqueCommands(tree.rootNode, this.lookupUriMap)
        const documentSymbols = SymbolTree(tree.rootNode, uri)
        const workspaceSymbols = collectFishWorkspaceSymbols(tree.rootNode, uri)
        this.uriToAnalyzedDocument[uri] = {
            document,
            documentSymbols,
            globalDefinitions: workspaceSymbols,
            sourcedUris,
            tree
        }
        for (const symbol of workspaceSymbols) {
            //console.log(symbol)
            const existing: WorkspaceSymbol[] = this.workspaceSymbols.get(symbol.name) ?? [];
            const count = existing.filter(s => symbol.location.uri === s.location.uri).length
            if (count === 0) {
                existing.push(symbol)
            } else if (existing.length === 0) {
               existing.push(symbol)
            }
            //existing.push(symbol)
            this.workspaceSymbols.set(symbol.name, existing)
        }

    }

    public async initiateBackgroundAnalysis() : Promise<{ filesParsed: number }> {
        let amount = 0;
        const allDocs = this.workspaces.workspaceDocs
        for (const document of allDocs) {
            try {
                this.analyze(document);
                amount++;
            } catch (err) {
                console.error(err)
            }
        }
        return { filesParsed: amount };
    }

    public getWorkspaceSymbols() {
        const results: WorkspaceSymbol[] = []
        for (const [name, symbols] of this.workspaceSymbols) {
            let toAdd: WorkspaceSymbol[] = []
            for (const symbol of symbols) {
                //if (symbol.kind == SymbolKind.Function) {
                    //toAdd = [symbol]
                    //break;
                //} else {
                //}
                toAdd.push(symbol)
            }
            results.push(...toAdd)
        }
        return results
    }


    public autoloadedInWorkspace(symbol: WorkspaceSymbol) {
        const uri = symbol.location.uri;
        const workspace = this.workspaces.find(uri)
        if (!workspace) return false;
        switch (symbol.kind) {
            case SymbolKind.Function:
                if (workspace.functions.some((doc: LspDocument) => doc.getAutoLoadName()  === symbol.name)) {
                    return true
                }
                return uri.endsWith("config.fish")
            case SymbolKind.Variable:
                return workspace.canRename
            default:
                return false
        }
    }

    get(document: LspDocument) {
        return this.uriToTreeMap.get(document.uri)
    }

    public getHover(document: LspDocument, position: Position): Hover | null {
        const tree = this.get(document)
        if (!tree) return null;
        const node = this.nodeAtPoint(document, position.line, position.character);
        if (!node) return null
        const symbols = this.workspaceSymbols.get(node.text)
        if (!symbols) return null
        const symbol = symbols.at(0) as FishWorkspaceSymbol
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: symbol.documentation.markdown,
            } as MarkupContent
        }
    }

    /**
     * Finds the rootnode given a LspDocument. If useCache is set to false, it will
     * use the parser to parse the document passed in, and then return the rootNode.
     */
    public getRootNode(
        document: LspDocument
    ): SyntaxNode | undefined {
        const tree = this.uriToTreeMap.get(document.uri)
        return tree?.rootNode
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
        root: SyntaxNode | null,
        currentNode: SyntaxNode | null
    } {
        const root = this.getRootNode(document)
        return {
            root: root || null,
            currentNode: root?.descendantForPosition({
                    row: position.line,
                    column: Math.max(0, position.character - 1),
                }) || null,
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

function createLookupUriMap(uris: string[]): Map<string, string> {
    const lookupUris = new Map<string, string>()
    uris.forEach(fullUri => {
        lookupUris.set(
            fullUri.slice(
                fullUri.lastIndexOf("/") + 1,
                fullUri.lastIndexOf(".fish")
            ),
            fullUri
        );
    })
    return lookupUris
}

function uniqueCommands(root: SyntaxNode, uris: Map<string, string>): SourceCommand[] {
    const result: SourceCommand[] = []
    const commands = getChildNodes(root).filter(n => isCommandName(n)).map(n => n.text)
    const uniqueCommands = new Set(commands)
    uniqueCommands.forEach(cmd => {
        if (uris.has(cmd)) {
            const command: SourceCommand = {
                name: cmd,
                uri: uris.get(cmd)!,
            }
            result.push(command)
        }
    })
    return result
}

