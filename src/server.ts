import Parser, {SyntaxNode} from "web-tree-sitter";
import { initializeParser } from "./parser";
import { Analyzer } from "./analyze";
//import { logger } from "./logger";
import { buildDefaultCompletions, buildRegexCompletions, workspaceSymbolToCompletionItem, generateShellCompletionItems, insideStringRegex, } from "./completion";
import { InitializeParams, TextDocumentSyncKind, ServerCapabilities, CompletionParams, Connection, CompletionList, CompletionItem, MarkupContent, CompletionItemKind, DocumentSymbolParams, DefinitionParams, Location, LocationLink, ReferenceParams, DocumentSymbol, DidOpenTextDocumentParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidSaveTextDocumentParams, InitializeResult, WorkspaceSymbol, WorkspaceSymbolParams, SymbolKind } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
//import {CliOptions, Context, TreeByUri} from './interfaces';
import { LspDocuments, LspDocument } from './document';
import { FishCompletionItem, } from './utils/completion-types';
import { enrichToCodeBlockMarkdown } from './documentation';
import { execCommandDocs, execCommandType, execFindDependency } from './utils/exec';
//import { findLocalDefinition, getNearestSymbols, getReferences } from './symbols';
import { collectFishSymbols, FishSymbol, getNearestSymbols } from './symbols';
import {Logger} from './logger';
import {uriToPath} from './utils/translation';
import {ConfigManager} from './configManager';
import {nearbySymbols} from './workspace-symbol';




export default class FishServer {


    public static async create(
        connection: Connection,
        params: InitializeParams,
    ): Promise<FishServer> {
        const parser = await initializeParser();
        const documents = new LspDocuments() ;
        const analyzer = new Analyzer(await initializeParser());
        return new FishServer(connection, params, parser, analyzer, documents)
    }

    private initializeParams: InitializeParams | undefined;
    // the connection of the FishServer
    private connection: Connection;

    // the parser (using tree-sitter-web)
    private parser: Parser;

    private analyzer: Analyzer; 

    // documentManager 
    private docs: LspDocuments;

    private config: ConfigManager;

    protected logger: Logger;

    constructor(connection: Connection, params: InitializeParams ,parser : Parser, analyzer: Analyzer, docs: LspDocuments ) {
        this.connection = connection;
        this.initializeParams = params;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.config = new ConfigManager(this.docs);
        this.logger = new Logger(connection);
    }


    async initialize(params: InitializeParams): Promise<InitializeResult> {
        this.connection.console.log(
            `Initialized server FISH-LSP with ${params.workspaceFolders}`
        )
        /*const server = await FishServer.create(connection, params);*/


        const result : InitializeResult = {
            capabilities: {
                // For now we're using full-sync even though tree-sitter has great support
                // for partial updates.
                textDocumentSync: TextDocumentSyncKind.Full,
                completionProvider: {
                    resolveProvider: true,
                    triggerCharacters: ["."],
                    allCommitCharacters: [";", " ", "\t"],
                    workDoneProgress: true,
                },
                hoverProvider: true,
                documentHighlightProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                //signatureHelpProvider: {
                //    triggerCharacters: ["'", '"', "[", ":"],
                //},
                documentSymbolProvider: {
                    label: "Fish",
                },
                //workspaceSymbolProvider: {
                //    resolveProvider: true,
                //}
                
                //workspaceSymbolProvider: true,
            }
        }
        return result;
    }


    public register(): void {
        //this.docs. .listen(this.connection)
        this.connection.console.log("Starting FishLsp.register()")

        this.connection.onDidOpenTextDocument(this.didOpenTextDocument.bind(this))
        this.connection.onDidChangeTextDocument(this.didChangeTextDocument.bind(this))
        this.connection.onDidCloseTextDocument(this.didCloseTextDocument.bind(this))
        this.connection.onDidSaveTextDocument(this.didSaveTextDocument.bind(this))

        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //this.connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))

        // • for multiple completionProviders -> https://github.com/microsoft/vscode-extension-samples/blob/main/completions-sample/src/extension.ts#L15
        // • https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
        this.connection.onCompletion(this.onCompletion.bind(this))
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this)),
        //this.connection.onSignatureHelp(this.onShowSignatureHelp.bind(this));

        this.connection.onDocumentSymbol(this.onDocumentSymbols.bind(this));
        this.connection.onDefinition(this.onDefinition.bind(this));
        this.connection.onReferences(this.onReferences.bind(this));
        this.connection.console.log("FINISHED FishLsp.register()")
    }

    didOpenTextDocument(params: DidOpenTextDocumentParams): void {
        this.logger.log("[FishLsp.onDidOpenTextDocument()]")
        this.logger.log(JSON.stringify({params}, null, 2))
        const uri = uriToPath(params.textDocument.uri);
        this.logger.log(`[FishLsp.onDidOpenTextDocument()] uri: ${uri}`)
        if (!uri) {
            this.logger.log("uri is null")
            return;
        }
        if (this.docs.open(uri, params.textDocument)) { 
            const doc = this.docs.get(uri);
            if (doc) {
                this.logger.log("opened document: " + params.textDocument.uri)
                this.analyzer.analyze(doc);
                this.logger.log("analyzed document: " + params.textDocument.uri)
            }
        } else {
            this.logger.log(`Cannot open already opened doc '${params.textDocument.uri}'.`);
            this.didChangeTextDocument({
                textDocument: params.textDocument,
                contentChanges: [
                    {
                        text: params.textDocument.text,
                    },
                ],
            });
        }
        //const toAnalyze = this.docs.get(uri);
        //if (toAnalyze) {
        //    this.analyzer.analyze(toAnalyze);
        //}
    }

    didChangeTextDocument(params: DidChangeTextDocumentParams): void {
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return;
        const doc = this.docs.get(uri);
        this.logger.log(`[${ this.connection.onDidChangeTextDocument.name }]: ${params.textDocument.uri}` );
        if (!doc) return;
        params.contentChanges.forEach(newContent => {
            doc.applyEdit(params.textDocument.version, newContent)
        })
    }

    didCloseTextDocument(params: DidCloseTextDocumentParams): void {
        const uri = uriToPath(params.textDocument.uri);
        if (!uri) return;
        this.logger.log(`[${this.connection.onDidCloseTextDocument.name}]: ${params.textDocument.uri}`);
        this.docs.close(uri);
        this.logger.log(`closed uri: ${uri}`);
    }

    didSaveTextDocument(params: DidSaveTextDocumentParams): void {
        this.logger.log(`[${this.connection.onDidSaveTextDocument.name}]: ${params.textDocument.uri}`);
    }

    private getRootNode(documentText: string): SyntaxNode {
        const tree = this.parser.parse(documentText);
        return tree.rootNode;
    }

    // @TODO: REFACTOR THIS OUT OF SERVER
    // what you've been looking for:
    //      fish_indent --dump-parse-tree test-fish-lsp.fish
    // https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202
    // https://github.com/microsoft/vscode-languageserver-node/pull/322
    // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextModehttps://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#insertTextMode
    // 
    // • clean up into completion.ts file & Decompose to state machine, with a function that gets the state machine in this class.
    //         DART is best example i've seen for this.
    //         ~ https://github.com/Dart-Code/Dart-Code/blob/7df6509870d51cc99a90cf220715f4f97c681bbf/src/providers/dart_completion_item_provider.ts#L197-202 ~
    // • Add markdown
    // • USE TRIGGERKIND as seen below in logger (4 lines down).
    // • Implement both escapedCompletion script and dump synatx tree script
    // • Add default CompletionLists to complete.ts
    // • Add local file items.
    // • Lastly add parameterInformation items.  [ 1477 : ParameterInformation ]
    async onCompletion(params: CompletionParams):  Promise<CompletionList | null>{
        const uri = uriToPath(params.textDocument.uri);
        this.logger.log('server.onComplete');
        const doc = this.docs.get(uri);
        if (!doc) {
            this.logger.log('onComplete got [NOT FOUND]: ' + uri)
            return null;
        }
        const line: string = doc.getLineBeforeCursor(params.position)
        this.logger.log(`onComplete: ${uri} : ${line}`)

        if (line.trimStart().startsWith("#")) {
            return null;
        }

        const root = this.getRootNode(doc.getText());
        this.logger.log(`root: ${root}`)

        const lineToParse = line.trimEnd();
        const currNode = root.descendantForPosition({row: 0, column: lineToParse.length - 1});

        const items: CompletionItem[] = [
            //...workspaceSymbolToCompletionItem(nearbySymbols(currNode, uri)), // collectDocumentSymbols(root, doc.uri, [])
            ...buildDefaultCompletions(),
        ];

        if (insideStringRegex(line)) {
            //logger.log(`insideStringRegex: ${true}`)
            items.push(...buildRegexCompletions())
            return CompletionList.create(items, true)
        }
        const shellItems: CompletionItem[] = await generateShellCompletionItems(line, currNode);
        if (shellItems.length > 0) {
            items.push(...shellItems)
            return CompletionList.create(items, true)
        }
        //items.push(...await generateShellCompletionItems(line, currNode));
        //items.push(...buildBuiltins())
        return CompletionList.create(items, true)
    }


    async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        const fishItem = item as FishCompletionItem
        let newDoc: string | MarkupContent;
        let typeCmdOutput = ''
        let typeofDoc = ''
        if (fishItem.data.localSymbol == true) {
            return item;
        }
        switch (fishItem.kind) {
            //item.documentation = enrichToCodeBlockMarkdown(fishItem.data?.originalCompletion, 'fish')
            case CompletionItemKind.Constant: 
            case CompletionItemKind.Variable: 
            case CompletionItemKind.Field: 
            case CompletionItemKind.Interface: 
                //const newDoc = enrichToCodeBlockMarkdown()
                return item;
            case CompletionItemKind.Function:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'fish')
                return item;
            case CompletionItemKind.Unit:
                typeCmdOutput = await execCommandType(fishItem.label)
                if (typeCmdOutput != '') {
                    newDoc = await execCommandDocs(fishItem.label)
                    item.documentation = typeCmdOutput === 'file' 
                        ? enrichToCodeBlockMarkdown(newDoc, 'fish') : enrichToCodeBlockMarkdown(newDoc, 'man')
                }
                return item;
            case CompletionItemKind.Class:
            case CompletionItemKind.Method:
            case CompletionItemKind.Keyword:
                newDoc = await execCommandDocs(fishItem.label)
                item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
                return item;
            default:
                return item;
        }
    }


    // @TODO: fix this to return a signle SignatureHelp object
    //public async onShowSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp> {
    //    const uri: string = params.textDocument.uri;
    //    //const position = params.position;
    //    const doc = await this.docs.openOrFind(uri);

    //    const documentLine: string = this.analyzer.currentLine(doc, params.position).getText().trimStart() || " "
    //    //const line = documentLine.getText().trimStart()
    //    //const root = this.parser.parse(line).rootNode;
    //    //const currNode = root.namedDescendantForPosition({row: 0, column: line.length - 1})
    //    //const commandNode = firstAncestorMatch(currNode, n => isCommand(n));
    //    const lastWord = documentLine.split(/\s+/).pop() || ""
    //    if (insideStringRegex(documentLine)) {
    //        if (lastWord.includes('[[') && !lastWord.includes(']]') ) {
    //            this.signature.activeSignature = signatureIndex["stringRegexCharacterSets"]
    //        } else {
    //            this.signature.activeSignature = signatureIndex["stringRegexPatterns"]
    //        }
    //    } else {
    //        this.signature.activeSignature = null;
    //    }
    //    this.signature.activeParameter = null;
    //    return this.signature;
    //}


    // • lsp-spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_symbol
    // • hierachy of symbols support on line 554: https://github.com/typescript-language-server/typescript-language-server/blob/114d4309cb1450585f991604118d3eff3690237c/src/lsp-server.ts#L554
    //
    async onDocumentSymbols(params: DocumentSymbolParams): Promise<DocumentSymbol[]> {
        this.logger.log("onDocumentSymbols");
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        if (!doc || !uri) {
            return [];
        }
        this.logger.log("length: "+ this.analyzer.getSymbols(doc.uri).length.toString())
        return this.analyzer.getSymbols(doc.uri).filter(
            (symbol) => {symbol.kind === SymbolKind.Function}
        ).map(symbol => {
            return DocumentSymbol.create(
                symbol.name,
                symbol.data.parent?.text || symbol.name,
                symbol.kind,
                symbol.location.range,
                symbol.location.range
            );
        }) as DocumentSymbol[];
    }

    protected get supportHierarchicalDocumentSymbol(): boolean {
        const textDocument = this.initializeParams?.capabilities.textDocument;
        const documentSymbol = textDocument && textDocument.documentSymbol;
        return !!documentSymbol && !!documentSymbol.hierarchicalDocumentSymbolSupport;
    }

    async onDefinition(params: DefinitionParams): Promise<Location[]> {
        this.logger.log("onDefinition");
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        if (!doc || !uri) {
            return [];
        }
        //const root = this.getRootNode(doc.getText());
        let node = this.analyzer.nodeAtPoint(doc.uri, params.position.line, params.position.character);
        this.logger.log(node?.text.toString() || "no node")
        if (!node) return [];
        //const depedencyUri = await execFindDependency(node.text)
        const localDefinitions = this.analyzer.getDefinition(doc.uri, node);
        return localDefinitions;
        //const newDoc = await this.docs.get(depedencyUri);
        //const newDocRoot = this.parser.parse(newDoc.getText()).rootNode;
        //const globalDefinitions = findGlobalDefinition(newDoc.uri, newDocRoot, node) || [];
        //return [...globalDefinitions, ...localDefinitions ]
    }


    public async onReferences(params: ReferenceParams): Promise<Location[]> {
        this.logger.log("onReference");
        const uri = uriToPath(params.textDocument.uri);
        const doc = this.docs.get(uri);
        if (!doc || !uri) {
            return [];
        }
        //const root = this.getRootNode(doc.getText());
        this.analyzer.analyze(doc);
        this.analyzer.getSymbols(doc.uri).forEach((s) => {
            this.logger.log(JSON.stringify({s}, null, 2))
        })
        const node = this.analyzer.nodeAtPoint(uri, params.position.line, params.position.character);
        this.logger.log(node?.toString() || "no NODE in onRefrence")
        if (!node) return [];
        return this.analyzer.getRefrences(uri, node) || [];
    }
}

