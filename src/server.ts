/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {
    TextDocuments,
    TextDocumentPositionParams,
    Hover,
    CompletionItem,
    CompletionList,
    Position,
    Range,
    CompletionParams,
    Connection,
    InitializedParams,
    InitializeParams,

} from "vscode-languageserver/node";
import * as LSP from "vscode-languageserver/node";
import { DocumentUri, TextDocument } from "vscode-languageserver-textdocument";
import Parser, {SyntaxNode} from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
//import { LspDocuments } from "./document";
import { initializeParser } from "./parser";
//import { MyAnalyzer } from "./analyse";
import { MyAnalyzer } from "./analyze";
import { getAllFishLocations } from "./utils/locations";
import {Logger} from './logger';
import {Completion} from './completion';
import {createTextDocumentFromFilePath} from './utils/io';

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/**
 * The FishServer glues together the separate components to implement
 * the various parts of the Language Server Protocol.
 */
export default class FishServer {
    /**
     * Initialize the server based on a connection to the client and the protocols
     * initialization parameters.
     */
    public static async initialize(
        connection: LSP.Connection,
        { capabilities }: LSP.InitializeParams
    ): Promise<FishServer> {
        const parser = await initializeParser();
        const analyzer = new MyAnalyzer(parser);
        //const documents = new LspDocuments(new TextDocuments(TextDocument));
        //const files = await getAllFishLocations();
        //for (const uri of files) {
        //    const file = await createTextDocumentFromFilePath(uri)
        //    if (file) await analyzer.initialize(uri, file)
        //}
        const completion = new Completion();
        try {
            await completion.initialDefaults()
        } catch (err) {
            console.log('error!!!!!!!!!!!!!!!')
        }
        // for (const file of files) {
        //     //const doc =  await createTextDocumentFromFilePath(file)
        //     //await analyzer.initialize(file)
        //     //if (!doc) continue;
        //     //await analyzer.analyze(file, doc)
        //     //const newRefrences = analyzer.uriToSyntaxTree[uri]?.getUniqueCommands()!
        //     //newRefrences.forEach(refrence => {


        //     //})
        // }
        return new FishServer(
            connection,
            parser,
            //documents,
            analyzer,
            //dependencies,
            completion,
            capabilities
        );
    }

    //private documents: LspDocuments;
    private analyzer: MyAnalyzer;
    private completion: Completion;
    private parser: Parser;
    //private logger: Logger;
    //private dependencies: Dependencies;
    private connection: LSP.Connection;
    private logger: Logger;
    private clientCapabilities: LSP.ClientCapabilities;

    private constructor(
        connection: LSP.Connection,
        parser: Parser,
        //documents: LspDocuments,
        analyzer: MyAnalyzer,
        completion: Completion,
        capabilities: LSP.ClientCapabilities
    ) {
        this.connection = connection;
        this.logger = new Logger(this.connection)
        //this.documents = documents;
        this.parser = parser;
        this.analyzer = analyzer;
        this.completion = completion;
        this.clientCapabilities = capabilities;
    }

    public register(connection: LSP.Connection): void {
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
        //connection.onInitialize(async )

        connection.onDidOpenTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            await this.analyzer.initialize(uri);
            this.logger.logmsg({action:'onOpen', path: uri})
        })

        connection.onDidChangeTextDocument(async change => {
            const document = change.textDocument;
            const uri = document.uri;
            //this.documents.newDocument(uri);
            this.logger.logmsg({path:uri, action:'onDidChangeContent'})
            let doc = documents.get(uri)
            if ( document && documents.get(uri) !== undefined ) {
                doc = await this.analyzer.initialize(uri);
            }
            await this.analyzer.analyze(uri, doc);
        });

        connection.onDidCloseTextDocument(async change => { 
            const uri = change.textDocument.uri;
            this.logger.logmsg({path:uri, action:'onDidClose'})
        });
        // if formatting is enabled in settings. add onContentDidSave

        // Register all the handlers for the LSP events.
        connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        connection.onCompletion(this.onCompletion.bind(this))
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))
        documents.listen(connection)
        //connection.listen()
    }

    public capabilities(): LSP.ServerCapabilities {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: LSP.TextDocumentSyncKind.Full,
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

    private async onHover(params: TextDocumentPositionParams): Promise<Hover | null> {
        const uri = params.textDocument.uri;
        const node = this.analyzer.nodeAtPoint(params.textDocument.uri, params.position.line, params.position.character)
        //const doc = this.documents.get(uri)
        //if (doc) {
        //    this.analyzer.analyze(uri, doc)
        //}
        this.logger.logmsg({ path: uri, action:'onHover', params: params, node: node})
        if (!node) return null

        let hoverDoc = this.analyzer.nodeIsLocal(uri, node)  || await this.analyzer.getHover(params)
        // TODO: heres where you should use fallback completion, and argument .

        if (hoverDoc) {
            return hoverDoc
        }

        this.logger.logmsg({action:'onHover', message:'ERROR', params: params, node: node})

        return null

        //if (!node) return null
        //const cmd = findParentCommand(node)
        //const cmdText = cmd?.firstChild?.text.toString() || ""
        //if (cmdText == "") return null
        //const text = await execCommandDocs(cmdText)
        //return hoverDoc
        //const hover = this.analyzer.getHover(params)
        //if (!hover) return null
        //return hover
    }
    



    public async onCompletion(completionParams: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = completionParams.textDocument.uri;
        const position = completionParams.position;
        const currText = resolveCurrentDocumentLine(uri, position, this.logger)
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
        let document = documents.get(uri);
        if (!document) {
            document = await this.analyzer.initialize(uri)
            await this.analyzer.analyze(uri, document)
        }
        const node: SyntaxNode | null = this.analyzer.nodeAtPoint(uri, position.line, position.character);

        this.logger.logmsg({ path: uri, action:'onComplete', node: node})

        if (!node) return null


        try {
            const completionList = await this.completion.generate(node)
            if (completionList) return completionList
        } catch (error) {
            this.logger.log(`ERROR: ${error}`)
        }
        this.logger.log(`ERROR: onCompletion !Error`)

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

    public async onCompleteResolve(item: CompletionItem): Promise<CompletionItem> {

        return item;
    }

}

function resolveCurrentDocumentLine(uri: DocumentUri, currPos: Position, logger: Logger) {
    const currDoc = documents.get(uri)
    if (currDoc === undefined) return ""
    const currText = currDoc.getText().split('\n').at(currPos.line)
    logger.log('currText: ' + currText)
    return currText || "";
}

