import { Position, PublishDiagnosticsParams, WorkspaceSymbol, } from "vscode-languageserver";
import Parser, { SyntaxNode, Range, Tree } from "web-tree-sitter";
import * as LSP from 'vscode-languageserver';
//import {collectFishSymbols, FishSymbol} from './symbols';
import {containsRange} from './workspace-symbol'
import {findFirstParent, getChildNodes, getRange} from './utils/tree-sitter';
import {LspDocument} from './document';
import {isCommandName, isDefinition} from './utils/node-types';
import {DiagnosticQueue} from './diagnostics/queue';
import {pathToRelativeFunctionName, toLspDocument, uriInUserFunctions, uriToPath} from './utils/translation';
import { DocumentationCache } from './utils/documentationCache';
import { DocumentSymbol } from 'vscode-languageserver';
import { GlobalWorkspaceSymbol } from './symbols';
import fs from 'fs'
import { homedir } from 'os';
import * as fastGlob from 'fast-glob'

type SourceCommand = {
    name: string,
    uri: string,
}

type Definition = { [name: string] : WorkspaceSymbol[] }

type uriToAnalyzedDocument = {
    document: LspDocument,
    globalDefinitions: Definition,
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
        cwd: rootPath,
        followSymbolicLinks: true,
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


export class Analyzer {

    protected parser: Parser;

    // maps the uri of document to the parser.parse(document.getText())
    protected uriTree: { [uri: string]: Tree };
    private diagnosticQueue: DiagnosticQueue = new DiagnosticQueue();
    protected uriToTreeMap: Map<string, Tree> = new Map();
    public uriToAnalyzedDocument: {[uri: string]: uriToAnalyzedDocument} = {}

    public allUris: string[] = [];
    public lookupUriMap: Map<string, string> = new Map();

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
        //this.uriTree[uri] = tree
        this.uriToTreeMap.set(document.uri, tree)
        const globalDefinitions = collectScopes(tree.rootNode, uri)
        const sourcedUris = uniqueCommands(tree.rootNode, this.lookupUriMap)
        this.uriToAnalyzedDocument[uri] = {
            document,
            globalDefinitions,
            sourcedUris,
            tree
        }
        //if (!uri) return;
        //if (!tree?.rootNode) return;
        //this.uriToSymbols[uri] = getDefinitionSymbols(this.uriTree[uri].rootNode)
        //this.diagnosticQueue.set(
        //    uri,
        //    collectDiagnosticsRecursive(tree.rootNode, document)
        //);
        //return this.uriToSymbols[uri]
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

    public getAllWorkspaceSymbols() {
        const symbols: WorkspaceSymbol[] = []
        for (const [key, value] of Object.entries(this.uriToAnalyzedDocument)) {
            const { globalDefinitions } = this.uriToAnalyzedDocument[key]
            Object.values(globalDefinitions).forEach((def) => {
                symbols.push(...def)
            })
        }
        return symbols
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

 export async function getAllPaths() {
    const paths = [
        `${homedir}/.config/fish`,
        `/usr/share/fish/functions`,
    ]
    const allPaths: string[] = [];
    for (const path of paths) {
        const newPaths = await getFilePaths({rootPath: path , maxItems: 10000});
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

const checkUriIsAutoloaded = (uri: string) => {
    const paths = [
        `${homedir}/.config/fish/functions`,
        `${homedir}/.config/fish/config.fish`,
        `/usr/share/fish/functions`,
    ]
    if (uri.startsWith('file://')) {
        const path = uriToPath(uri)!
        return paths.some(p => p.startsWith(path))
    }
    //return
    return paths.some(p => uri.startsWith(p))
    
}

function collectScopes(root: SyntaxNode, uri: string): Definition {
    const isAutoloaded = checkUriIsAutoloaded(uri)
    const functionName = pathToRelativeFunctionName(uri)
    const result : Definition = {};
    const definitionNodes = getChildNodes(root).filter(n => isDefinition(n))
    for (const node of definitionNodes) {
        const scope = DefinitionSyntaxNode.getScope(node)
        if (node.text === "argv" || node.text === "$argv") continue;
        if (scope === "global" && isAutoloaded) {
            const symbol = GlobalWorkspaceSymbol().createVar(node, uri);
            if (!result[symbol.name]) result[symbol.name] = []
            result[symbol.name].push(symbol)
        } else if (scope === "function" && [functionName, "config"].includes(node.text)) {
            const symbol = GlobalWorkspaceSymbol().createFunc(node, uri)
            if (!result[symbol.name]) result[symbol.name] = []
            result[symbol.name].push(symbol)
        //} else if (scope === "function" && "config" === functionName && isAutoloaded) {
            //const symbol = GlobalWorkspaceSymbol().createFunc(node, uri)
            //if (!result[symbol.name]) result[symbol.name] = []
            //result[symbol.name].push(symbol)
        }
    }
    return result;
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

    export const getScope = (definitionNode: SyntaxNode) => {
        if (!isDefinition(definitionNode)) return null;
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


