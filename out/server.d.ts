import { InitializeParams, ServerCapabilities, TextDocumentPositionParams, Connection, CompletionList } from "vscode-languageserver/node";
import { Context } from './interfaces';
export default class FishServer {
    static initialize(connection: Connection, { capabilities }: InitializeParams): Promise<FishServer>;
    private context;
    private console;
    constructor(context: Context);
    capabilities(): ServerCapabilities;
    register(connection: Connection): void;
    onCompletion(completionParams: TextDocumentPositionParams): Promise<CompletionList | null>;
}
//# sourceMappingURL=server.d.ts.map