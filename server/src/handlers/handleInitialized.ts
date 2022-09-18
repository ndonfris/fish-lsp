import { URL } from 'url'
import { WorkspaceFolder } from 'vscode-languageserver/node'
import { analyze } from '../analyze'
import { initFormatter } from '../format'
import { Context } from '../interfaces'
import { getAwkFilesInDir, readDocumentFromUrl } from '../io'

export function getInitializedHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies, docs } = context

  function index(workspaceFolders: WorkspaceFolder[]) {
    const urls: URL[] = workspaceFolders.flatMap((folder) => getAwkFilesInDir(folder.uri))

    // Analyze every file in a workspace
    for (const url of urls) {
      const document = readDocumentFromUrl(context, url)

      if (!document) continue

      const {
        tree,
        symbols: s,
        dependencyUris,
        namespaces: ns,
      } = analyze(context, document, docs)

      trees[url.href] = tree
      symbols[url.href] = s
      namespaces[url.href] = ns

      dependencies.update(url.href, new Set(dependencyUris))
    }
  }

  return async function handleInitialized() {
    const progressReporter = await context.connection.window.createWorkDoneProgress()
    const workspaceFolders =
      (await context.connection.workspace.getWorkspaceFolders()) ?? []

    if (context.cliOptions?.noIndex) {
      context.connection.console.log('Indexing skipped')
    } else {
      progressReporter.begin('Indexing')
      index(workspaceFolders)
      progressReporter.done()
    }

    progressReporter.begin('Initializing formatter')
    initFormatter(workspaceFolders, context.connection)
    progressReporter.done()
  }
}
