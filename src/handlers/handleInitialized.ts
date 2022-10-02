import { URL } from "url";
import { WorkspaceFolder } from "vscode-languageserver/node";
import { Analyzer } from "../analyze";
//import { initFormatter } from '../format'
import { Context } from "../interfaces";
import { createTextDocumentFromFilePath, getFishFilesInDir } from "../utils/io";

export function getInitializedHandler(context: Context) {
    const { trees, analyzer, documents } = context;

    async function index(workspaceFolders: WorkspaceFolder[]) {
        const urls: URL[] = workspaceFolders.flatMap((folder) =>
            getFishFilesInDir(folder.uri)
        );

        // Analyze every file in a workspace
        for (const url of urls) {
            const document = await createTextDocumentFromFilePath(context, url);

            if (!document) continue;

            context.trees[url.href] = await analyzer.initialize(context, document);
            //dependencies.update(url.href, new Set(dependencyUris));
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
        //initFormatter(workspaceFolders, context.connection);
        progressReporter.done();
    };
}
