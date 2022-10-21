import { TextDocument } from 'vscode-languageserver-textdocument'
import { TextDocumentChangeEvent } from 'vscode-languageserver/node'
import { analyze } from '../analyzer'
import { Context } from '../interfaces'
//import { validate } from '../validation/validate'

export function getDidChangeContentHandler(context: Context) {
  const { roots, symbols, documents } = context

  return async function handleDidChangeContent(
    change: TextDocumentChangeEvent<TextDocument>,
  ): Promise<void> {

    const results = await context.analyzer.analyze(context, change.document)

    const uri = change.document.uri

    //trees[uri] = results.tree
    
    //if (symbols.has(uri)) {
        //symbols.set(
                //uri,
                //symbols.get(uri)?.push(results.symbols)
                    //|| [...results.symbols]
        //)
    //}
    ////namespaces[uri] = results.namespaces
    //dependencies.update(uri, new Set(results.dependencyUris))

    //const diagnostics = validate(
    //  results.roots.get(uri),
    //  symbols.get(uri),
    //  dependencies.get(uri),
    //  change.document.uri,
    //  docs,
    //)
    //context.connection.sendDiagnostics({ uri: change.document.uri, diagnostics })
  }
}
