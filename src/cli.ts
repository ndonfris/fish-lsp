#!/usr/bin/env node
//'use strict'
import {TextDocument} from 'vscode-languageserver-textdocument';
import { createConnection, InitializeParams, InitializeResult, ProposedFeatures, StreamMessageReader, StreamMessageWriter, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import {URI} from 'vscode-uri';
import Parser from 'web-tree-sitter';
import {initializeParser} from './parser';
import FishServer from './server';
//import {getAllFishLocations} from './utils/locations';




export function startServer() {
    // Create a connection for the server.
    // The connection uses stdin/stdout for communication.
    //const connection = createConnection(
    //    new StreamMessageReader(process.stdin),
    //    new StreamMessageWriter(process.stdout)
    //);
    const connection = createConnection(
        new StreamMessageReader(process.stdin),
        new StreamMessageWriter(process.stdout)
    )
    //const token = connection.window.attachWorkDoneProgress('Initializing Fish Language Server');
    //token.begin('Fish Language Server', 0, 'Initializing', true);
    //token.report(0);
    //token.begin('Initializing Fish Language Server');
    connection.onInitialize(
        async (params: InitializeParams): Promise<InitializeResult> => {
            connection.console.log(`Initialized server FISH-LSP with ${JSON.stringify(params)}`);
            const server = await FishServer.create(connection, params);
            server.register();
            return server.initialize(params);
        }
    )
    connection.listen()
    //token.done();
}


startServer()
