import { Position, PublishDiagnosticsParams, SymbolInformation, SymbolKind, WorkspaceSymbol, } from "vscode-languageserver";
import Parser, { SyntaxNode, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import {containsRange} from './workspace-symbol'
import {findFirstParent, getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isVariableDefinition} from './utils/node-types';
import {DiagnosticQueue} from './diagnostics/queue';
import {pathToRelativeFunctionName, toLspDocument, uriInUserFunctions, uriToPath} from './utils/translation';
import { DocumentationCache } from './utils/documentationCache';
import { DocumentSymbol } from 'vscode-languageserver';
import { GlobalWorkspaceSymbol } from './symbols';
import fs from 'fs'
import { homedir } from 'os';
import * as fastGlob from 'fast-glob'
import { DocumentSymbolTree, SymbolTree } from './symbolTree';

type SourceCommand = {
    name: string,
    uri: string,
}

type GlobalDefinition = { [name: string] : WorkspaceSymbol[] }

type uriToAnalyzedDocument = {
    document: LspDocument,
    documentSymbols: SymbolTree,
    //sourcedUris: Set<string>
    sourcedUris: SourceCommand[]
    tree: Parser.Tree
}

export async function getFilePaths({
  rootPath,
  maxItems,
}: {
  rootPath: string
  maxItems: number
}): Promise<string[]> {
    const stream = fastGlob.stream(['**.fish'], {
        absolute: true,
        onlyFiles: true,
        globstar: true,
        cwd: rootPath,
        deep: 1,
        followSymbolicLinks: false,
        suppressErrors: true,
    })

    // NOTE: we use a stream here to not block the event loop
    // and ensure that we stop reading files if the glob returns
    // too many files.
    const files: string[] = []
    let i = 0
    for await (const fileEntry of stream) {
        if (i >= maxItems) {
            // NOTE: Close the stream to stop reading files paths.
            stream.emit('close')
            break
        }

        files.push(fileEntry.toString())
        i++
    }
    return files
}

export class Workspace {

    public path: string ;
    public autoloaded: boolean;
    public files: Set<string> = new Set();

    constructor(name: string, autoloaded: boolean = false) {
        this.path = name;
        this.autoloaded = autoloaded;
        this.setFiles();
    }

    private setFiles() {
        const files = fastGlob.sync('*.fish', {
            cwd: this.path,
            absolute: true,
            onlyFiles: true,
            globstar: true,
            deep: 1,
            unique: true,
            followSymbolicLinks: false,
            suppressErrors: true,
        })
        for (const file of files) {
            this.files.add(file)
        }
    }

    contains(uri: string) {
        //const uriPath = uri.startsWith('file://') ? uriToPath(uri) || uri : uri;
        return this.files.has(uri)
    }

    hasFunction(uri: string) {
        if (uri.endsWith('config.fish')) return true
        return this.contains(uri) && uri.includes('/functions/')
    }

    hasCompletion(uri: string) {
        return this.contains(uri) && uri.includes('/completions/')
    }

    // don't care about completions
    isAutoloadedSymbol(uri: string) {
        return this.autoloaded ? this.hasFunction(uri) : false
    }
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
    public static workspaces: Workspace[] = [
        new Workspace(`${homedir()}/.config/fish`, true),
        new Workspace(`/usr/share/fish`, true),
    ];

    private uriToSymbols: { [uri: string]: DocumentSymbol[]} = {};
    private globalSymbolsCache: DocumentationCache;

    constructor(parser: Parser, globalSymbolsCache: DocumentationCache, allUris: string[]) {
        this.parser = parser;
        this.uriTree = {};
        this.globalSymbolsCache = globalSymbolsCache;
        this.allUris = allUris;
        this.lookupUriMap = createLookupUriMap(allUris);
    }

    public analyze(document: LspDocument) {
        const uri = document.uri;
        this.parser.reset()
        const tree = this.parser.parse(document.getText());
        this.uriToTreeMap.set(document.uri, tree)
        const sourcedUris = uniqueCommands(tree.rootNode, this.lookupUriMap)
        const documentSymbols = DocumentSymbolTree(tree.rootNode)
        this.uriToAnalyzedDocument[uri] = {
            document,
            documentSymbols,
            sourcedUris,
            tree
        }
        this.setWorkspaceSymbols(tree.rootNode, uri)
    }

    public async initiateBackgroundAnalysis({
        backgroundAnalysisMaxFiles
    }:{
        backgroundAnalysisMaxFiles: number
    }) : Promise<{ filesParsed: number }> {
        let amount = 0;
        for (const filePath of this.allUris) {
            if (amount >= backgroundAnalysisMaxFiles) break;
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8')
                const document = toLspDocument(filePath, fileContent);
                this.analyze(document);
                amount++;
            } catch (err) {
                console.error(err)
            }
        }
        return { filesParsed: amount };
    }

    private setWorkspaceSymbols(root: SyntaxNode, uri: string) {
        const result: WorkspaceSymbol[] = []
        const definitionNodes = getChildNodes(root).filter(n => isDefinition(n))
        const ws = Analyzer.workspaces.find(w => w.contains(uri))
        for (const node of definitionNodes) {
            const scope = DefinitionSyntaxNode.getScope(node, uri)
            if (scope != 'global') continue;
            if (isVariableDefinition(node)) {
                result.push(GlobalWorkspaceSymbol().createVar(node, uri))
            }
            if (isFunctionDefinitionName(node) && ws?.isAutoloadedSymbol(uri)) {
                result.push(GlobalWorkspaceSymbol().createFunc(node, uri))
            }
        }
        result.forEach((symbol: WorkspaceSymbol) => {
            const existing: WorkspaceSymbol[] = this.workspaceSymbols.get(symbol.name) || []
            const count = existing.filter(s => symbol.location.uri === s.location.uri).length
            if (count === 0) {
                existing.push(symbol)
            }
            this.workspaceSymbols.set(symbol.name, existing)
        })
        return result
    }

    public static setWorkspaces(dirs: string[]) {
        dirs.forEach(dir => {
            Analyzer.workspaces.push(new Workspace(dir))
        })
    }

    public static getWorkspaces() {
        return Analyzer.workspaces;
    }
    
    public static getContainingWorkspace(uri: string) {
        return Analyzer.workspaces.find(w => w.contains(uri))
    }

    public static autoloadedInWorkspace(symbol: WorkspaceSymbol) {
        const uri = symbol.location.uri;
        switch (symbol.kind) {
            case SymbolKind.Function:
                return Analyzer.workspaces.some(w => w.isAutoloadedSymbol(uri)) 
            case SymbolKind.Variable:
                return Analyzer.getContainingWorkspace(uri)?.path === `${homedir()}/.config/fish`
            default:
                return false
        }
    }

    get(document: LspDocument) {
        return this.uriToTreeMap.get(document.uri)
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

function equalWorkspaceSymbols(a: LSP.Location, b: LSP.Location) {
    if (a.uri !== b.uri) {
        return false
    } 
    if (a.range.start.line !== b.range.start.line || a.range.end.line !== b.range.end.line) {
        return false
    } 
    if (a.range.start.character !== b.range.start.character || a.range.end.character !== b.range.end.character) {
        return false
    }
    return true
}


 export async function getAllPaths() {
    const workspaces = Analyzer.getWorkspaces().map(w => w.path);
    const allPaths: string[] = [];
    for (const path of workspaces) {
        const newPaths = await getFilePaths({rootPath: path, maxItems: 10000});
        allPaths.push(...newPaths)
    }
    return allPaths;
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

export namespace DefinitionSyntaxNode {
    export const ScopeTypesSet = new Set(["global", "function", "local", "block"]);
    export type ScopeTypes = "global" | "function" | "local" | "block";
    export type VariableCommandNames = "set" | "read" | "for" | "function" // FlagsMap.keys()
    export interface CommandOption {
        short: string[]
        long: string[]
        isDefault: boolean
    }
    export class CommandOption {
        constructor(short: string[], long: string[], isDefault: boolean) {
            this.short = short;
            this.long = long;
            this.isDefault = isDefault;
        }
        has(option: string): boolean {
            if (option.startsWith('--')) {
                const withoutDash = option.slice(2);
                return this.long.includes(withoutDash);
            } else if (option.startsWith('-')) {
                const withoutDash = option.slice(1);
                return this.short.some(opt => withoutDash.split('').includes(opt));
            } else {
                return false;
            }
        }
        toString() {
            return '[' + this.short.map(s => '-'+s).join(', ') + ', ' + this.long.map(l => '--'+l).join(', ') + ']';
            //return returnString;
        }
    }
    const createFlags = (flags: string[], isDefault: boolean = false): CommandOption => {
        return new CommandOption(
            flags.filter((flag) => flag.startsWith("-") && flag.length === 2).map((flag) => flag.slice(1)),
            flags.filter((flag) => flag.startsWith("--")).map((flag) => flag.slice(2)), 
            isDefault
        );
    }
    const _Map = {
        read: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        set: {
            global:   createFlags(["-g", '--global'])      ,
            local:    createFlags(["-l", "--local"], true) ,
            function: createFlags(["-f", "--function"])    ,
        },
        for: {
            block: createFlags([]) 
        },
        function: { 
            function: createFlags(["-A", "--argument-names", "-v", "--on-variable"], true)   ,
            global:   createFlags(["-V", "--inherit-variable", '-S', '--no-scope-shadowing']),
        },
    }
    /**
     * Map containing the flags, for a command
     * {
     *     "read": => Map(3) {
     *           "global" => Set(2) { "-g", "--global" },
     *           "local" => Set(2) { "-l", "--local" },
     *           "function" => Set(2) { "-f", "--function" }
     *     }
     *     ...
     * }
     * Usage:
     * FlagsMap.keys()                    => Set(4) { "read", "set", "for", "function }
     * FlagsMap.get("read").get("global") => Set(2) { "-g", "--global" }
     * FlagsMap.get("read").get("global").has("-g") => true
     */
    export const FlagsMap = new Map(Object.entries(_Map).map(([command, scopes]) => {
        return [command, new Map(Object.entries(scopes).map(([scope, flags]) => {
            return [scope, flags];
        }))];
    }));

    function collectFlags(cmdNode: SyntaxNode): string[] {
        return cmdNode.children
            .filter((n) => n.text.startsWith("-"))
            .map((n) => n.text);
    }

    export const getScope = (definitionNode: SyntaxNode, uri: string) => {
        if (!isDefinition(definitionNode)) return null;
        if (definitionNode.text.startsWith("$") || definitionNode.text === "argv" || definitionNode.text.endsWith("]")) return 'local';
        //const isAutoloaded = uriInUserFunctions(uri) || uri.endsWith("config.fish");
        //const isAutoloaded =  || uri.endsWith("config.fish");
        if (isFunctionDefinitionName(definitionNode)) {
            const loadedName = pathToRelativeFunctionName(uri);
            return loadedName.endsWith(definitionNode.text) || loadedName.endsWith('config') ? "global" : "local";
        }
        const command = findFirstParent(definitionNode, isCommandName) || definitionNode.parent;
        const commandName = command?.firstChild?.text || "";
        if (!command || !commandName) return
        const currentFlags = collectFlags(command)
        let saveScope : string = 'local';
        for (const [scope, scopeFlags] of FlagsMap.get(commandName)!.entries()) {
            if (currentFlags.some(flag => scopeFlags.has(flag))) {
                return scope
            } else if (scopeFlags.isDefault) {
                saveScope = scope
            }
        }
        return saveScope
    }
}


