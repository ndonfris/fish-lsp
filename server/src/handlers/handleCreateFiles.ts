import { URL } from 'url'
import { CreateFilesParams } from 'vscode-languageserver/node'
import { analyze } from '../analyze'
import { Context } from '../interfaces'
import { readDocumentFromUrl } from '../io'
import { validate } from '../validation/validate'

/**
 * This handles the case when deleted file is restored with Ctrl+z
 */
export function getCreateFilesHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies, docs } = context

  return function handleCreateFiles(params: CreateFilesParams): void {
    for (const file of params.files) {
      const textDocument = readDocumentFromUrl(context, new URL(file.uri))

      if (!textDocument) {
        context.connection.window.showWarningMessage(
          `Could not read ${file.uri}. Analyzing is skipped.`,
        )

        return
      }

      const results = analyze(context, textDocument, docs)

      trees[file.uri] = results.tree
      symbols[file.uri] = results.symbols
      namespaces[file.uri] = results.namespaces

      dependencies.update(file.uri, new Set(results.dependencyUris))

      const dependents = dependencies.get(file.uri).parentUris

      for (const depUri of dependents) {
        context.connection.sendDiagnostics({
          uri: depUri,
          diagnostics: validate(
            trees[depUri],
            symbols,
            namespaces,
            dependencies,
            depUri,
            docs,
          ),
        })
      }
    }
  }
}
