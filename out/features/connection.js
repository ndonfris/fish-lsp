"use strict";
/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLspConnection = void 0;
const LSP = __importStar(require("vscode-languageserver/node"));
function createLspConnection(options) {
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
exports.createLspConnection = createLspConnection;
//# sourceMappingURL=connection.js.map