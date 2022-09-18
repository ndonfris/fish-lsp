import { TextDocument } from 'vscode-languageserver-textdocument'
import { TextDocumentChangeEvent } from 'vscode-languageserver/node'
import { analyze } from '../analyze'
import { Context } from '../interfaces'
import { validate } from '../validation/validate'

export function getDidChangeContentHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies, docs } = context

  return function handleDidChangeContent(
    change: TextDocumentChangeEvent<TextDocument>,
  ): void {
    const results = analyze(context, change.document, docs)

    trees[change.document.uri] = results.tree
    symbols[change.document.uri] = results.symbols
    namespaces[change.document.uri] = results.namespaces

    dependencies.update(change.document.uri, new Set(results.dependencyUris))

    const diagnostics = validate(
      results.tree,
      symbols,
      namespaces,
      dependencies,
      change.document.uri,
      docs,
    )

    context.connection.sendDiagnostics({ uri: change.document.uri, diagnostics })
  }
}
