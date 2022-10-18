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
import { Logger } from "./logger";
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
        this.docs.documents.listen(this.connection)

        this.connection.onDidOpenTextDocument(async change => {
            const document = change.textDocument;
            this.console.log('[connection.onDidOpenTextDocument] '+ document.uri)
            const uri = document.uri;
            let doc = await this.docs.openOrFind(uri)
            this.analyzer.analyze(doc);
            //this.logger.logmsg({action:'onOpen', path: uri})
        })

        this.connection.onDidChangeTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            //this.console.log('[connection.onDidChangeTextDocument] '+ uri)
            let doc = await this.docs.openOrFind(uri);
            //this.console.log(doc.getText())
            this.console.log('[connection.onDidChangeTextDocument] '+ doc.uri)
            doc = TextDocument.update(doc, change.contentChanges, document.version+1)
            //this.console.log(doc.getText())
            this.analyzer.analyze(doc);
            const root = this.analyzer.getRoot(doc)
            //for (const n of getChildNodes(root)) {
            //    try {
            //        isLocalVariable(n, this.console)
            //        this.console.log(`localNode: ${getNodeText(n) || ""}`);
            //    } catch (err) {
            //        this.console.log("ERROR: " + n.text)
            //    }
            //}
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
            //this.documents.newDocument(uri);
            let doc = await this.docs.openOrFind(uri);
            this.console.log('documents.onDidChangeContent: ' + doc.uri)
            //this.console.log(doc.getText())
            //doc = TextDocument.update(change.document, change.document., document.version+1)
            //console.log(doc.getText())
            this.analyzer.analyze(doc);
        })
    }

    public async onCompletion(completionParams: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;

        this.console.log('onComplete' + uri)

        //if (documentText.endsWith('-')) {
        //    return null;
        //}
        const doc = await this.docs.openOrFind(uri);
        //this.console.log('onComplete() doc.uri = ' + doc.uri)
        this.analyzer.analyze(doc)
        const node: SyntaxNode | null = this.analyzer.nodeAtPoint(doc.uri, position.line, position.character);
        //this.console.log('[connection.onCompletion()] -> analyzer.nodeAtPoint' + getNodeText(node))

        const line: string = this.analyzer.currentLine(doc, completionParams.position) || ""
        const r = getRangeFromPosition(completionParams.position);
        //this.console.log(`[onComplete(${position.line}, ${position.character})] LINE -> ${line}; RANGE -> {\n\tstart: (${r.start.line}, ${r.start.character}),\n\t end: (${r.end.line}, ${r.end.character})\n}`)

        if (line !== "") {
            return await this.completion.generateLineCmpNew(line)
            //await this.completion.generateLineCompletion(line)
        }

        if (!node) return this.completion.fallbackComplete()


        const completionList = await this.completion.generate(node)
        if (completionList) {
            return completionList
        }

        return this.completion.fallbackComplete();
    }


    public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
        //import
        let newItem = item;
        const fishItem = item as FishCompletionItem;
        try {
            newItem = await handleCompletionResolver(item as FishCompletionItem, this.console)
            this.console.log(`
                { ${fishItem.label}, 
                    ${fishItem.documentation}, 
                    ${fishItem.data?.originalCompletion}
                  ${fishItem.kind}, 
                }
            `);
            
        } catch (err) {
            this.console.log("ERRRRRRRRRRRRROOOOORRRR" +err)
            return item;
        }
        return newItem;
    }
}


//function register(cliOptions?: CliOptions) {
//    const { connection, documents } = context;
//    
//
//    // store handlers to refrences 
//    const handleInitialize = getInitializeHandler(context);
//    const handleInitialized = getInitializedHandler(context);
//
//    const handleDidChangeContent = getDidChangeContentHandler(context);
//    const handleCompletionResolver = getCompletionResolveHandler(context);
//                                                       
//
//    // attach handlers by refrence
//    connection.onInitialize(handleInitialize);
//    context.connection.onInitialized(handleInitialized);
//
//    //context.connection.window.showWarningMessage("hello world")
//}
//
//
//
//
///**
// * run the server 
// *
// * @param {CliOptions} [cliOptions] - --noIndex, --stdout, --node-rpc
// */
//export function main(cliOptions?: CliOptions) { 
//    const { connection, documents } = context;
//
//    if (cliOptions) context.cliOptions
//
//    register(cliOptions)
//
//    context.documents.onDidChangeContent( async change => {
//        context.connection.console.error('handleDidChangeContent()')
//        const uri = change.document.uri; 
//        context.connection.console.error(`handleDidChangeContent(): ${uri}`)
//        const doc = context.documents.get(uri);
//        if (doc) {
//            context.analyzer.analyze(context, doc);
//        } else {
//            const newDoc = await createTextDocumentFromFilePath(context, new URL(change.document.uri))
//            if (newDoc) await context.analyzer.initialize(context, newDoc);
//            return null
//        }
//    })
//    context.connection.languages.connection.onCompletion((params: CompletionParams) => {
//        context.connection.console.log(`completion: ${params}`)
//        return null
//    });
//
//    context.documents.listen(connection)
//    context.connection.listen()
//}
//
//if (require.main === module) main()


//context.connection.onInitialize((_params: InitializeParams) => {
//    
//    return {
//        capabilities: {
//            textDocumentSync: TextDocumentSyncKind.Full,
//            // Tell the client that the server supports code completion
//            completionProvider: {
//                resolveProvider: false,
//            },
//        },
//    };
//});
//
//
//
//
//
//connection.onCompletion(async (textDocumentPosition, token) => {
//    const document = documents.get(textDocumentPosition.textDocument.uri);
//    if (!document) {
//        return null;
//    }
//});
//
//documents.listen(connection);
//connection.listen();
