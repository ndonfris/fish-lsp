
import { URL } from 'url'
import { WorkspaceFolder } from 'vscode-languageserver/node'
import { analyze } from '../analyzer'
//import { initFormatter } from '../format'
import { Context } from '../interfaces'
import { getFishFilesInDir, readDocumentFromUrl } from '../utils/io'

export function handleInitialized(context: Context) {
  const { asts, symbols, roots, documents,dependencies, docs } = context

  async function index(workspaceFolders: WorkspaceFolder[]) {
    const urls: URL[] = workspaceFolders.flatMap((folder) => getFishFilesInDir(folder.uri))

    // Analyze every file in a workspace
    for (const url of urls) {
      const document = readDocumentFromUrl(context, url)

      if (!document) continue

      const {
        connection,
        documents,
        dependencies,
        capabilities,
        parser,
        asts,
        roots,
        symbols,
        docs,
        cliOptions
      } : Context = await analyze(context, document)

      //trees[url.href] = tree
      //symbols[url.href] = s
      //namespaces[url.href] = ns

      //dependencies.update(url.href, new Set(dependencyUris))
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

    //progressReporter.begin('Initializing formatter')
    //await initFormatter(workspaceFolders, context.connection)
    progressReporter.done()
  }
}
