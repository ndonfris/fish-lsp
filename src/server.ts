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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {CliOptions, Context, TreeByUri} from './interfaces';
import {SyntaxNode} from 'web-tree-sitter';
import {URI} from 'vscode-uri';

export default class FishServer {


    public static async initialize(
        connection: Connection,
        { capabilities }: InitializeParams
    ): Promise<FishServer> {
        //const connection = connection;
        const parser = await initializeParser();
        const analyzer = new Analyzer(parser);
        const documents = new TextDocuments(TextDocument);
        const completion = new Completion();
        const files = await getAllFishLocations();
        for (const fsPath of files) {
            const fileURI = URI.file(fsPath)
            connection.console.log(`uri: ${fileURI}`)
        }
        try {
            await completion.initialDefaults()
        } catch (err) {
            console.log('error!!!!!!!!!!!!!!!')
        }
        //for (const uri of files) {
            //const file = await createTextDocumentFromFilePath(new URL(uri))
            //connection.console.log(`uri: ${uri}, file: ${file?.uri}`)
            ////if (file) await analyzer.initialize(context, file)
        //}
        return new FishServer(
            connection,
            parser,
            analyzer,
            documents,
            completion
        );
    }

    private connection: Connection;

    private console: RemoteConsole;

    constructor(connection: Connection, parser : Parser, analyzer: Analyzer, documents: TextDocuments<TextDocument>, completion: Completion) {
        this.connection = connection;
        this.console = this.connection.console;
    }



    public capabilities(): ServerCapabilities {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ["$", "-"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            //documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            referencesProvider: true,
        };
    }

    public register(connection: Connection): void {
        //const opened = this.documents.getOpenDocuments();
        //connection.listen(connection);
        //connection.dispose()

        //let languageModes: any;

        //connection.onInitialize((_params: InitializeParams) => {
        //    languageModes = languageModes();

        //    documents.onDidClose(e => {
        //        languageModes.onDocumentRemoved(e.document);
        //    });
        //    connection.onShutdown(() => {
        //        languageModes.dispose();
        //    });

        //    return {
        //        capabilities: this.capabilities()
        //    };
        //});

        connection.onDidOpenTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            let doc = this.context.documents.get(uri);
            if (doc) {
                await this.context.analyzer.initialize(this.context, doc);
            }
            //this.logger.logmsg({action:'onOpen', path: uri})
        })

        connection.onDidChangeTextDocument(async change => {
            this.console.log('onDidChangeText')
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            let doc = this.context.documents.get(uri)
            if ( document && this.context.documents.get(uri) !== undefined && doc) {
                await this.context.analyzer.initialize(this.context, doc);
                await this.context.analyzer.analyze(this.context, doc);
            }
        });

        connection.onDidCloseTextDocument(async change => { 
            const uri = change.textDocument.uri;
        });
        // if formatting is enabled in settings. add onContentDidSave

        // Register all the handlers for the LSP events.
        //connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        connection.onCompletion(this.onCompletion.bind(this))
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
        this.context.documents.listen(connection)
        this.context.connection.listen()
    }

    public async onCompletion(completionParams: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;
        //if (currDoc) {
            //const currPos = currDoc.offsetAt(position)
            //const range: Range = Range.create({line: position.line, character: 0}, {line: position.line, character: position.character})
            //const documentText = this.analyzer.uriToTextDocument[uri].toString()
            //this.logger.log(`cmpDocText: ${documentText}`)
        //}

        //const pos: Position = {
        //    line: position.line,
        //    character: Math.max(0, position.character-1)
        //}
        //if (documentText.endsWith('-')) {
        //    return null;
        //}
        let doc = this.context.documents.get(uri);
        if (doc) {
            await this.context.analyzer.initialize(this.context, doc)
            await this.context.analyzer.analyze(this.context, doc)
        }
        const node: SyntaxNode | null = this.context.analyzer.nodeAtPoint(this.context.trees[uri], position.line, position.character);

        //this.logger.logmsg({ path: uri, action:'onComplete', node: node})

        if (!node) return null


        try {
            const completionList = await this.context.completion.generate(node)
            if (completionList) return completionList
        } catch (error) {
            this.console.log(`ERROR: ${error}`)
        }
        this.console.log(`ERROR: onCompletion !Error`)

        return null

        //const commandNode: SyntaxNode | null = findParentCommand(node);
        //if (!commandNode) {
        //    //use node
        //}

        //this.analyzer.getHoverFallback(uri, node)

        //// build Completions
        //const completions: CompletionItem[] = []


        //return completions
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
