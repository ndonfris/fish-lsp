import { FileOperationFilter } from 'vscode-languageserver-protocol/lib/common/protocol.fileOperations'
import { WorkDoneProgressReporter } from 'vscode-languageserver/lib/common/progress'
import {
  CancellationToken,
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node'
import { Completion } from '../completion'
import { Context } from '../interfaces'
import { initializeParser } from '../parser'

// Cannot use matches with file types until new release
// https://github.com/microsoft/vscode-languageserver-node/issues/734
const fileOperationFilter: FileOperationFilter = {
  pattern: {
    glob: '**/*.fish',
    options: { ignoreCase: true },
  },
}

const folderOperationFilter: FileOperationFilter = {
  pattern: {
    glob: '**/*',
  },
}

export function getInitializeHandler(context: Context) {
  return async function handleInitialize(
    params: InitializeParams,
    _cancel: CancellationToken,
    progressReporter: WorkDoneProgressReporter,
  ): Promise<InitializeResult> {

    progressReporter.begin('Initializing')

    context.capabilities = context.capabilities
    context.parser = await initializeParser()
    context.completion = await context.completion.initialDefaults() 

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          resolveProvider: true,
        },
        definitionProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        renameProvider: { prepareProvider: true },
        documentFormattingProvider: false,
        workspace: {
          fileOperations: {
            willDelete: {
              filters: [fileOperationFilter, folderOperationFilter],
            },
            didDelete: {
              filters: [fileOperationFilter, folderOperationFilter],
            },
            didCreate: {
              filters: [fileOperationFilter],
            },
            didRename: {
              filters: [fileOperationFilter, folderOperationFilter],
            },
          },
        },
      },
    }

    //context.connection.console.log('handleInitialized()')
    progressReporter.done()

    return result
  }
}
