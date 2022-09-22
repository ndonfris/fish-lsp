





import * as LSP from 'vscode-languageserver';
import { Position } from '../utils/typeConverters.js';
import { toLocation, uriToPath } from '../protocol-translation';
import type { LspDocuments } from '../document';
import type { LspClient } from '../lsp-client';
import { CommandTypes } from '../command-types';

export class SourceDefinitionCommand {
    public static readonly id = '_typescript.goToSourceDefinition';

    public static async execute(
        uri: LSP.DocumentUri | undefined,
        position: LSP.Position | undefined,
        documents: LspDocuments,
        tspClient: TspClient,
        lspClient: LspClient,
        reporter: LSP.WorkDoneProgressReporter,
    ): Promise<LSP.Location[] | void> {

        if (!position || typeof position.character !== 'number' || typeof position.line !== 'number') {
            lspClient.showErrorMessage('Go to Source Definition failed. Invalid position.');
            return;
        }

        let file: string | undefined;

        if (!uri || typeof uri !== 'string' || !(file = uriToPath(uri))) {
            lspClient.showErrorMessage('Go to Source Definition failed. No resource provided.');
            return;
        }

        const document = documents.get(file);

        if (!document) {
            lspClient.showErrorMessage('Go to Source Definition failed. File not opened in the editor.');
            return;
        }

        const args = Position.toFileLocationRequestArgs(file, position);
        return await lspClient.withProgress<LSP.Location[] | void>({
            message: 'Finding source definitions…',
            reporter,
        }, async () => {
            const response = await tspClient.request(CommandTypes.FindSourceDefinition, args);
            if (response.type !== 'response' || !response.body) {
                lspClient.showErrorMessage('No source definitions found.');
                return;
            }
            return response.body.map(reference => toLocation(reference, documents));
        });
    }
}
