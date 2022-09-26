/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    ServerCapabilities,
} from "vscode-languageserver/node";
import * as LSP from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser from "web-tree-sitter";
import { DependencyMap } from "./dependencies";
import { getInitializedHandler } from "./handlers/getInitializedHandler";
import { handleInitialized } from "./handlers/handleInitialized";
import { getHandleHover } from "./handlers/handleHover";
import { AstsMap, CliOptions, Context, DocsMap, RootsMap } from "./interfaces";
import { LspDocument, LspDocuments } from "./document";
import { initializeParser } from "./parser";
import { MyAnalyzer } from "./analyse";
import { getAllFishLocations } from "./utils/locations";

/**
 * The BashServer glues together the separate components to implement
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
        for (const file of files) {
            await documents.newDocument(file);
        }
        return new FishServer(
            connection,
            parser,
            documents,
            analyzer,
            capabilities
        );
    }

    private documents: LspDocuments;
    private analyzer: MyAnalyzer;
    private parser: Parser;
    //private logger: Logger;
    private connection: LSP.Connection;
    private clientCapabilities: LSP.ClientCapabilities;

    private constructor(
        connection: LSP.Connection,
        parser: Parser,
        documents: LspDocuments,
        analyzer: MyAnalyzer,
        capabilities: LSP.ClientCapabilities
    ) {
        this.connection = connection;
        this.documents = documents;
        this.parser = parser;
        this.analyzer = analyzer;
        this.clientCapabilities = capabilities;
    }

    public register(connection: LSP.Connection): void {
        const opened = this.documents.getOpenDocuments();
        this.documents.listener.listen(connection);
        this.documents.listener.onDidChangeContent(async (change) => {
            const { document } = change;
            const uri = document.uri;
            const isOpen = await this.documents.open(uri);
            if (isOpen) {
                const doc = this.documents.get(uri)!;
                this.analyzer.analyze(doc);
                // add dependencies
                // push diagnostics
            } else {
                // already open (republish diagnostics)
                // check if new command added
                this.analyzer.analyze(uri);
            }
        });

        this.documents.listener.onDidClose(async (change) => {
            const { document } = change;
            const uri = document.uri;
            const doc = this.documents.close(uri);
            return doc;
        });
        // if formatting is enabled in settings. add onContentDidSave

        // Register all the handlers for the LSP events.
        // connection.onHover(this.onHover.bind(this))
        // connection.onDefinition(this.onDefinition.bind(this))
        // connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))
        // connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this))
        // connection.onDocumentHighlight(this.onDocumentHighlight.bind(this))
        // connection.onReferences(this.onReferences.bind(this))
        // connection.onCompletion(this.onCompletion.bind(this))
        // connection.onCompletionResolve(this.onCompletionResolve.bind(this))s))

    }

    public capabilities(): LSP.ServerCapabilities {
        return {
            // For now we're using full-sync even though tree-sitter has great support
            // for partial updates.
            textDocumentSync: LSP.TextDocumentSyncKind.Full,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ["$", "{"],
            },
            hoverProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            referencesProvider: true,
        };
    }



}
