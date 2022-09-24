/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {config} from 'node:process';
import {createConnection, ProposedFeatures, TextDocumentPositionParams, TextDocuments} from 'vscode-languageserver';
import {TextDocument} from 'vscode-languageserver-textdocument';
import * as LSP from 'vscode-languageserver/node';
import Parser from 'web-tree-sitter';
import {DependencyMap} from './dependencies';
import {getInitializedHandler} from './handlers/getInitializedHandler';
import {handleHover} from './handlers/handleHover';
import {AstsMap, CliOptions, Context, DocsMap, RootsMap} from './interfaces';
import {initializeParser} from './parser';
import { LspClientLogger } from './utils/logger';

export interface IServerOptions {
    serverPath: string;
    serverLogFile?: string;
    serverLogVerbosity?: string;
    showMessageLevel: LSP.MessageType;
}

const context: Context = {
  connection:
    require.main === module
            ? createConnection(ProposedFeatures.all)
            : createConnection(process.stdin, process.stdout),
    documents: new TextDocuments(TextDocument),
    capabilities: capabilities(),
    parser: {} as Parser,
    asts: new Map() as AstsMap,
    roots: new Map() as RootsMap,
    position: {} as TextDocumentPositionParams, 
    docs: new Map() as DocsMap,
    dependencies: new DependencyMap(),
    symbols: {},
    cliOptions: {}
}

function capabilities(): LSP.ServerCapabilities {
    return {
        // For now we're using full-sync even though tree-sitter has great support
        // for partial updates.
        textDocumentSync: LSP.TextDocumentSyncKind.Full,
        completionProvider: {
            resolveProvider: true,
            triggerCharacters: ['$'],
        },
        hoverProvider: true,
        documentHighlightProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        referencesProvider: true,
    }
}


/// https://github.com/Beaglefoot/awk-language-server/blob/371492f657ebf6b9aa7a323059fc4c95a34febec/server/src/handlers/handleInitialized.ts#L8
// $HOME/repos/awk-language-server/server/src/handlers/handleInitialized.ts
function registerHandlers() {
  const { connection, documents } = context

  const handleInitialize = getInitializedHandler(context)
  //const handleInitialized = getInitializedHandler(context)
  //const handleDidChangeContent = getDidChangeContentHandler(context)
  //const handleCompletion = getCompletionHandler(context)
  //const handleCompletionResolve = getCompletionResolveHandler(context)
  //const handleDefinition = getDefinitionHandler(context)
  //const handleDocumentHighlight = getDocumentHighlightHandler(context)
  //const handleDocumentSymbol = getDocumentSymbolHandler(context)
  //const handleWorkspaceSymbol = getWorkspaceSymbolHandler(context)
  //const handleReferences = getReferencesHandler(context)
  //const handleHover = getHoverHandler(context)
  //const handleSemanticTokens = getSemanticTokensHandler(context)
  //const handlePrepareRename = getPrepareRenameHandler(context)
  //const handleRenameRequest = getRenameRequestHandler(context)
  //const handleDocumentFormatting = getDocumentFormattingHandler(context)
  //const handleDidDeleteFiles = getDidDeleteFilesHandler(context)
  //const handleCreateFiles = getCreateFilesHandler(context)
  //const handleRenameFiles = getRenameFilesHandler(context)

  connection.onInitialize(handleInitialize)
  connection.onHover(handleHover)
  //connection.onInitialized(handleInitialized)
  //documents.onDidChangeContent(handleDidChangeContent)
  //connection.onCompletion(handleCompletion)
  //connection.onCompletionResolve(handleCompletionResolve)
  //connection.onDefinition(handleDefinition)
  //connection.onDocumentHighlight(handleDocumentHighlight)
  //connection.onDocumentSymbol(handleDocumentSymbol)
  //connection.onWorkspaceSymbol(handleWorkspaceSymbol)
  //connection.onReferences(handleReferences)
  //connection.onRequest('getSemanticTokens', handleSemanticTokens)
  //connection.onPrepareRename(handlePrepareRename)
  //connection.onRenameRequest(handleRenameRequest)
  //connection.onDocumentFormatting(handleDocumentFormatting)
  ////connection.workspace.onWillDeleteFiles(handleWillDeleteFiles)
  //connection.workspace.onDidDeleteFiles(handleDidDeleteFiles)
  //connection.workspace.onDidCreateFiles(handleCreateFiles)
  //connection.workspace.onDidRenameFiles(handleRenameFiles)
}

export function main(cliOptions?: CliOptions) {
  const { documents, connection } = context

  if (cliOptions) context.cliOptions = cliOptions

  registerHandlers()

  documents.listen(connection)
  connection.listen()
}

if (require.main === module) main()
