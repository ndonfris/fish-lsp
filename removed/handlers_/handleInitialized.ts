import { URL } from "url";
import { WorkspaceFolder } from "vscode-languageserver/node";
import { Analyzer } from "../analyze";
//import { initFormatter } from '../format'
import { Context } from "../interfaces";
import {initializeParser} from '../parser';
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

            if (document) {
                context.connection.console.log(`document: ${document.uri}`)
                try {
                    await context.analyzer.initialize(context, document)
                } catch (error) {
                   context.connection.console.log(`ERROR: ${error}`) 
                   context.connection.console.log(`ERROR: ${typeof analyzer.initialize}`) 
                }
            }

            //dependencies.update(url.href, new Set(dependencyUris));
        }
    }

    async function initializeContext() {
        context.parser = await initializeParser();
        context.analyzer = new Analyzer(context.parser)
        context.connection.console.log('initializing completionDefaults()')
        await context.completion.initialDefaults()
        context.connection.console.log('finished completionDefaults()')
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
            await initializeContext();
            await index(workspaceFolders);
            progressReporter.done();
        }

        progressReporter.begin("Initializing formatter");
        //initFormatter(workspaceFolders, context.connection);
        progressReporter.done();
    };
}
