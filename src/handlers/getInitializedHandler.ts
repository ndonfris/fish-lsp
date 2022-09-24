import { URL } from 'url'
import { WorkspaceFolder } from 'vscode-languageserver/node'
import { analyze } from '../analyzer'
//import { initFormatter } from '../format'
import { Context } from '../interfaces'
import { getFishFilesInDir, readDocumentFromUrl } from '../utils/io'

export function getInitializedHandler(context: Context) {
    const { asts, documents, roots, parser, docs } = context;

    async function index(workspaceFolders: WorkspaceFolder[]) {
        const urls: URL[] = workspaceFolders.flatMap((folder) =>
            getFishFilesInDir(folder.uri)
        );

        // Analyze every file in a workspace
        for (const url of urls) {
            const document = readDocumentFromUrl(context, url);

            if (!document) continue;

            const update: Context = await analyze(context, document);
            context.asts.set(url.href, update.asts.get(url.href));
            //context.symbols.set(url.href, update.symbols.get(url.href));
            context.roots.set(url.href, update.roots.get(url.href))
            context.docs.set(url.href, update.docs.get(url.href))

            //publish diagnostics right here ideally
            //context.asts.get(url.href).getNodes()
            //    .filter(node => node.firstChild?.text != null)
            //    .filter(node => !context.symbols
            //        .get(node.firstChild?.text.toString() || '') 
            //    ).map(node => 
            //        context.symbols[url.href]+=context.docs.get(node?.firstChild.text)
            //    )

            // context.asts.set(url.href) = tree
            // symbols[url.href] = s
            // namespaces[url.href] = ns
            context.dependencies.update(url.href, new Set(update.dependencies));
        }
    }

    return async function handleInitialized() {
        const progressReporter =
            await context.connection.window.createWorkDoneProgress();
        const workspaceFolders =
            (await context.connection.workspace.getWorkspaceFolders()) ?? [];

        if (context.cliOptions?.noIndex) {
            context.connection.console.log("Indexing skipped");
        } else {
            progressReporter.begin("Indexing");
            index(workspaceFolders);
            progressReporter.done();
        }

        progressReporter.begin("Initializing formatter");
        //initFormatter(workspaceFolders, context.connection)
        progressReporter.done();
    };
}
