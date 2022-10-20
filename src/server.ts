import Parser from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
import { initializeParser } from "./parser";
//import { MyAnalyzer } from "./analyse";
import { Analyzer } from "./analyze";
import { getAllFishLocations } from "./utils/locations";
import { logger } from "./logger";
import { Completion } from "./completion";
import { createTextDocumentFromFilePath } from "./utils/io";
import {
    ClientCapabilities,
    createConnection,
    InitializeParams,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    ServerCapabilities,
    TextDocumentPositionParams,
    CompletionParams,
    TextDocumentChangeEvent,
    Connection,
    InitializedParams,
    RemoteConsole,
    CompletionList,
    CompletionItem,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {CliOptions, Context, TreeByUri} from './interfaces';
import {SyntaxNode} from 'web-tree-sitter';
import {URI} from 'vscode-uri';
import {DocumentManager, getRangeFromPosition} from './document';
import {getChildNodes, getNodeText} from './utils/tree-sitter';
import {isLocalVariable, isVariable} from './utils/node-types';
import {FishCompletionItem, handleCompletionResolver} from './utils/completion-types';




export default class FishServer {


    public static async initialize(
        connection: Connection,
        { capabilities }: InitializeParams
    ): Promise<FishServer> {
        logger.setConsole(connection.console)
        const parser = await initializeParser();
        return Promise.all([
            new Analyzer(parser),
            DocumentManager.indexUserConfig(connection.console),
            Completion.initialDefaults(),
        ]).then(
            ([analyzer, docs, completion]) =>
            new FishServer(connection, parser, analyzer, docs, completion)
        );
    }

    // the connection of the FishServer
    private connection: Connection;

    // for logging output (from connection)
    private console: RemoteConsole;
    // convert this to a singleton object and globally access it 

    // the parser (using tree-sitter-web)
    private parser : Parser;

    // using the parser & DocumentManager
    // current implementation ideally works in this order:
    // 1.) a document is retrieved from the DocumentManager 
    // 2.) the document is Parsed by the Parser
    // 3.) the analyzer stores the document???
    // 4.) 
    private analyzer: Analyzer; 

    // documentManager 
    private docs: DocumentManager;

    // completionHandler
    private completion: Completion;

    constructor(connection: Connection, parser : Parser, analyzer: Analyzer, docs: DocumentManager , completion: Completion) {
        this.connection = connection;
        this.console = this.connection.console;
        this.parser = parser;
        this.analyzer = analyzer;
        this.docs = docs;
        this.completion = completion;
    }



    public capabilities(): ServerCapabilities {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ["$", "-"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            //documentSymbolProvider: true,
            //workspaceSymbolProvider: true,
            //referencesProvider: true,
        };
    }

    public register(): void {
        this.connection.onDidOpenTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = await this.docs.openOrFind(uri)
            this.analyzer.analyze(doc);
            logger.log(this.connection.onDidOpenTextDocument.name, {document:doc})
        })

        this.connection.onDidChangeTextDocument(async change => {
            const uri = change.textDocument.uri;
            let doc = await this.docs.openOrFind(uri);
            logger.log(this.connection.onDidChangeTextDocument.name, {extraInfo: [doc.uri, '\nchanges:', ...change.contentChanges.map(c => c.text)]})
            doc = TextDocument.update(doc, change.contentChanges, change.textDocument.version);
            this.analyzer.analyze(doc);
            const root = this.analyzer.getRoot(doc)
            // do More stuff
        });


        this.connection.onDidCloseTextDocument(async change => { 
            const uri = change.textDocument.uri;
            this.docs.close(uri);
        });

        // if formatting is enabled in settings. add onContentDidSave
        // Register all the handlers for the LSP events.
        //connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        this.connection.onCompletion(this.onCompletion.bind(this))
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
        this.docs.documents.onDidChangeContent(async change => {
            const document = change.document;
            const uri = document.uri;
            let doc = await this.docs.openOrFind(uri);
            logger.log('documents.onDidChangeContent: ' + doc.uri)
            this.analyzer.analyze(doc);
        })
        this.docs.documents.listen(this.connection)

    }

    public async onCompletion(completionParams: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;

        logger.log('server.onComplete' + uri, {caller: this.onCompletion.name, position: completionParams.position})

        const doc = await this.docs.openOrFind(uri);
        const node: SyntaxNode | null = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);

        const r = getRangeFromPosition(completionParams.position);
        logger.log('on complete node', {caller:this.onCompletion.name, rootNode: node || undefined, position: completionParams.position})

        const line: string = this.analyzer.currentLine(doc, completionParams.position) || ""
        if (line.startsWith("#")) {
            return null;
        }

        if (line !== "") {
            return CompletionList.create(await this.completion.generateLineCmpNew(line))
        }
        return null
    }


    public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        let newItem = item;
        const fishItem = item as FishCompletionItem;
        try {
            logger.log('server onCompletionResolve:', {extraInfo: ['beforeResolve:' ], completion: item})
            newItem = await handleCompletionResolver(item as FishCompletionItem, this.console)
            logger.log('server onCompletionResolve:', {extraInfo: ['AfterResolve:' ], completion: item})
        } catch (err) {
            logger.log("ERRRRRRRRRRRRROOOOORRRR " + err)
            return item;
        }
        return newItem;
    }
}


