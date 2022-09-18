import { DeleteFilesParams, FileDelete, URI } from 'vscode-languageserver/node'
import { Context } from '../interfaces'
import { getAwkFilesInDir, isDir } from '../io'
import { isAwkExtension } from '../utils'
import { validate } from '../validation/validate'

// Folder can have multiple file deletes associated with it
const fileDeletesMap: Map<URI, Set<FileDelete>> = new Map()

// There is no guarantee of ordering of events
// Can we see multiple willDelete before single DidDelete?
export function handleWillDeleteFiles(params: DeleteFilesParams): null {
  for (const { uri } of params.files) {
    if (!fileDeletesMap.has(uri)) fileDeletesMap.set(uri, new Set())

    if (isDir(uri)) {
      for (const url of getAwkFilesInDir(uri)) {
        fileDeletesMap.get(uri)!.add({ uri: url.toString() })
      }

      continue
    }

    if (!isAwkExtension(uri)) continue

    fileDeletesMap.get(uri)!.add({ uri })
  }

  return null
}

export function getDidDeleteFilesHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies, docs } = context

  return function handleDidDeleteFiles(params: DeleteFilesParams): void {
    for (const { uri } of params.files) {
      if (!fileDeletesMap.has(uri)) continue

      for (const fileDelete of fileDeletesMap.get(uri)!) {
        const dependents = dependencies.get(fileDelete.uri).parentUris

        delete trees[fileDelete.uri]
        delete symbols[fileDelete.uri]
        delete namespaces[fileDelete.uri]

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

      fileDeletesMap.delete(uri)
    }
  }
}
