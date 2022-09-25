import { URL } from 'url'
import { InitializeResult, ServerCapabilities, WorkspaceFolder } from 'vscode-languageserver/node'
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
        // https://github.com/Beaglefoot/awk-language-server/blob/master/server/src/handlers/handleInitialize.ts
        // youre mising some clear stuff like: parser, context, ...

        // Analyze every file in a workspace
        for (const url of urls) {
            const document = readDocumentFromUrl(context, url);

            if (!document) continue;
        }
    }

    return async function handleInitialized(){
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

        const result: InitializeResult = {
            capabilities: {
                completionProvider: {
                    resolveProvider : true,
                    completionItem: {
                        labelDetailsSupport: true
                    },
                    workDoneProgress: true,
                },
                definitionProvider: true,
                hoverProvider: true,
                //inlayHintProvider: true,
                //executeCommandProvider: {
                //commands: [
                //"show.command_history"
                //]
                //}
            }
        }

        progressReporter.done();
        return result

    };

}
