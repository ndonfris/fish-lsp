/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as LSP from 'vscode-languageserver';
//import {FishServerLogLevel} from '../config';
//import * as lspcalls from './lsp-protocol.calls.proposed';
//import * as lspinlayHints from './lsp-protocol.inlayHints.proposed';
//import { LspClientLogger } from './utils/logger';
//import { LspServer } from './lsp-server';
//import { LspClientImpl } from './lsp-client';
//import type { FishServerLogLevel } from './utils/configuration';

export interface LspConnectionOptions {
    showMessageLevel: LSP.MessageType;
}

export function createLspConnection(options: LspConnectionOptions): LSP.Connection {
    const connection = LSP.createConnection(LSP.ProposedFeatures.all);
    //const lspClient = new LspClientImpl(connection);
    //const logger = new LspClientLogger(lspClient, options.showMessageLevel);
    //const server: LspServer = new LspServer({
    //    logger,
    //    lspClient,
    //    tsserverPath: options.tsserverPath,
    //    tsserverLogVerbosity: options.tsserverLogVerbosity,
    //});

    //connection.onInitialize(server.initialize.bind(server));
    //connection.onDidChangeConfiguration(server.didChangeConfiguration.bind(server));

    //connection.onDidOpenTextDocument(server.didOpenTextDocument.bind(server));
    //connection.onDidSaveTextDocument(server.didSaveTextDocument.bind(server));
    //connection.onDidCloseTextDocument(server.didCloseTextDocument.bind(server));
    //connection.onDidChangeTextDocument(server.didChangeTextDocument.bind(server));

    //connection.onCodeAction(server.codeAction.bind(server));
    //connection.onCompletion(server.completion.bind(server));
    //connection.onCompletionResolve(server.completionResolve.bind(server));
    //connection.onDefinition(server.definition.bind(server));
    //connection.onImplementation(server.implementation.bind(server));
    //connection.onTypeDefinition(server.typeDefinition.bind(server));
    //connection.onDocumentFormatting(server.documentFormatting.bind(server));
    //connection.onDocumentRangeFormatting(server.documentRangeFormatting.bind(server));
    //connection.onDocumentHighlight(server.documentHighlight.bind(server));
    //connection.onDocumentSymbol(server.documentSymbol.bind(server));
    //connection.onExecuteCommand(server.executeCommand.bind(server));
    //connection.onHover(server.hover.bind(server));
    //connection.onReferences(server.references.bind(server));
    //connection.onRenameRequest(server.rename.bind(server));
    //connection.onSignatureHelp(server.signatureHelp.bind(server));
    //connection.onWorkspaceSymbol(server.workspaceSymbol.bind(server));
    //connection.onFoldingRanges(server.foldingRanges.bind(server));
    //connection.languages.inlayHint.on(server.inlayHints.bind(server));

    //// proposed `textDocument/calls` request
    ////connection.onRequest(lspcalls.CallsRequest.type, server.calls.bind(server));

    ////connection.onRequest(lspinlayHints.type, server.inlayHintsLegacy.bind(server));

    //connection.onRequest(LSP.SemanticTokensRequest.type, server.semanticTokensFull.bind(server));
    //connection.onRequest(LSP.SemanticTokensRangeRequest.type, server.semanticTokensRange.bind(server));

    return connection;
}