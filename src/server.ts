/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {
    TextDocuments,
    ProposedFeatures,
    ServerCapabilities,
    TextDocumentPositionParams,
    Hover,
    CompletionItem,
    CompletionList,
    Position,
} from "vscode-languageserver/node";
import * as LSP from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, {SyntaxNode} from "web-tree-sitter";
//import { getInitializedHandler } from "./handlers/getInitializedHandler";
//import { handleInitialized } from "./handlers/handleInitialized";
//import { getHandleHover } from "./handlers/handleHover";
//import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
import { LspDocument, LspDocuments } from "./document";
import { initializeParser } from "./parser";
import { MyAnalyzer } from "./analyse";
import { getAllFishLocations } from "./utils/locations";
import {findParentCommand} from './utils/node-types';
import {execCommandDocs} from './utils/exec';
import {documentationHoverProvider, enrichToMarkdown} from './documentation';
import {Logger} from './logger';
import {createTextDocumentFromFilePath} from './utils/io';
import {Completion} from './completion';

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
        const documents = new LspDocuments(new TextDocuments(TextDocument));
        const files = await getAllFishLocations();
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
            documents,
            analyzer,
            //dependencies,
            completion,
            capabilities
        );
    }

    private documents: LspDocuments;
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
        documents: LspDocuments,
        analyzer: MyAnalyzer,
        completion: Completion,
        capabilities: LSP.ClientCapabilities
    ) {
        this.connection = connection;
        this.logger = new Logger(this.connection)
        this.documents = documents;
        this.parser = parser;
        this.analyzer = analyzer;
        this.completion = completion;
        this.clientCapabilities = capabilities;
    }

    public register(connection: LSP.Connection): void {
        //const opened = this.documents.getOpenDocuments();
        this.documents.listener.listen(connection);
        this.documents.listener.onDidOpen(async open => {
            const { document } = open;
            const uri = document.uri;
            this.documents.newDocument(uri);
            this.documents.open(uri)
            this.logger.logmsg({action:'onOpen', path: uri})
            this.analyzer.analyze(uri, document)
        })

        this.documents.listener.onDidChangeContent(async change => {
            const { document } = change;
            const uri = document.uri;
            this.documents.newDocument(uri);
            this.logger.logmsg({path:uri, action:'onDidChangeContent'})
            const isOpen = await this.documents.open(uri);
            if (isOpen) {
                this.documents.newDocument(uri)
                // dependencies are handled in analyze()
                // push diagnostics
            }
            const doc = this.documents.get(uri)!;
            this.analyzer.analyze(uri, document);

        });

        this.documents.listener.onDidClose(async (change) => {
            const { document } = change;
            const uri = document.uri;
            const doc = this.documents.close(uri);
            this.logger.logmsg({path:uri, action:'onDidClose'})
            return doc;
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
        if (!node) return null
        this.logger.logmsg({ path: uri, action:'onHover', params: params, node: node})

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
    

    public async onCompletion(params: TextDocumentPositionParams):  Promise<CompletionList | null>{
        const uri: string = params.textDocument.uri;

        const pos: Position = {
            line: params.position.line,
            character: Math.max(0, params.position.character-1)
        }
        const node: SyntaxNode | null = this.analyzer.nodeAtPoint(uri, pos.line, pos.character);

        if (!node) return  null

        this.logger.logmsg({ path: uri, action:'onComplete', params: params, node: node})

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
