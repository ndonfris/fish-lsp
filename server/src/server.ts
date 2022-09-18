import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'
import { getDocumentation } from './documentation'
import { DependencyMap } from './dependencies'
import { getDocumentSymbolHandler } from './handlers/handleDocumentSymbol'
import { CliOptions, Context } from './interfaces'
import { getInitializeHandler } from './handlers/handleInitialize'
import { getDidChangeContentHandler } from './handlers/handleDidChangeContent'
import { getCompletionHandler } from './handlers/handleCompletion'
import { getCompletionResolveHandler } from './handlers/handleCompletionResolve'
import { getDefinitionHandler } from './handlers/handleDefinition'
import { getDocumentHighlightHandler } from './handlers/handleDocumentHighlight'
import { getWorkspaceSymbolHandler } from './handlers/handleWorkspaceSymbol'
import { getReferencesHandler } from './handlers/handleReferences'
import { getHoverHandler } from './handlers/handleHover'
import { getSemanticTokensHandler } from './handlers/handleSemanticTokens'
import { getRenameRequestHandler } from './handlers/handleRenameRequest'
import { getPrepareRenameHandler } from './handlers/handlePrepareRename'
import { getInitializedHandler } from './handlers/handleInitialized'
import { getDocumentFormattingHandler } from './handlers/handleDocumentFormatting'
import {
  getDidDeleteFilesHandler,
  handleWillDeleteFiles,
} from './handlers/handleDeleteFiles'
import { getCreateFilesHandler } from './handlers/handleCreateFiles'
import { getRenameFilesHandler } from './handlers/handleRenameFiles'

// Enriched later
const context = {
  connection:
    require.main === module
      ? createConnection(ProposedFeatures.all)
      : createConnection(process.stdin, process.stdout),
  documents: new TextDocuments(TextDocument),
  capabilities: {},
  parser: {},
  trees: {},
  symbols: {},
  namespaces: {},
  dependencies: new DependencyMap(),
  docs: getDocumentation(),
} as Context

function registerHandlers() {
  const { connection, documents } = context

  const handleInitialize = getInitializeHandler(context)
  const handleInitialized = getInitializedHandler(context)
  const handleDidChangeContent = getDidChangeContentHandler(context)
  const handleCompletion = getCompletionHandler(context)
  const handleCompletionResolve = getCompletionResolveHandler(context)
  const handleDefinition = getDefinitionHandler(context)
  const handleDocumentHighlight = getDocumentHighlightHandler(context)
  const handleDocumentSymbol = getDocumentSymbolHandler(context)
  const handleWorkspaceSymbol = getWorkspaceSymbolHandler(context)
  const handleReferences = getReferencesHandler(context)
  const handleHover = getHoverHandler(context)
  const handleSemanticTokens = getSemanticTokensHandler(context)
  const handlePrepareRename = getPrepareRenameHandler(context)
  const handleRenameRequest = getRenameRequestHandler(context)
  const handleDocumentFormatting = getDocumentFormattingHandler(context)
  const handleDidDeleteFiles = getDidDeleteFilesHandler(context)
  const handleCreateFiles = getCreateFilesHandler(context)
  const handleRenameFiles = getRenameFilesHandler(context)

  connection.onInitialize(handleInitialize)
  connection.onInitialized(handleInitialized)
  documents.onDidChangeContent(handleDidChangeContent)
  connection.onCompletion(handleCompletion)
  connection.onCompletionResolve(handleCompletionResolve)
  connection.onDefinition(handleDefinition)
  connection.onDocumentHighlight(handleDocumentHighlight)
  connection.onDocumentSymbol(handleDocumentSymbol)
  connection.onWorkspaceSymbol(handleWorkspaceSymbol)
  connection.onReferences(handleReferences)
  connection.onHover(handleHover)
  connection.onRequest('getSemanticTokens', handleSemanticTokens)
  connection.onPrepareRename(handlePrepareRename)
  connection.onRenameRequest(handleRenameRequest)
  connection.onDocumentFormatting(handleDocumentFormatting)
  connection.workspace.onWillDeleteFiles(handleWillDeleteFiles)
  connection.workspace.onDidDeleteFiles(handleDidDeleteFiles)
  connection.workspace.onDidCreateFiles(handleCreateFiles)
  connection.workspace.onDidRenameFiles(handleRenameFiles)
}

export function main(cliOptions?: CliOptions) {
  const { documents, connection } = context

  if (cliOptions) context.cliOptions = cliOptions

  registerHandlers()

  documents.listen(connection)
  connection.listen()
}

if (require.main === module) main()
