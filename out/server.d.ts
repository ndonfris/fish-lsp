import { TextDocumentPositionParams, CompletionItem, CompletionList } from "vscode-languageserver";
import * as LSP from "vscode-languageserver";
/**
 * The FishServer glues together the separate components to implement
 * the various parts of the Language Server Protocol.
 */
export default class FishServer {
    /**
     * Initialize the server based on a connection to the client and the protocols
     * initialization parameters.
     */
    static initialize(connection: LSP.Connection, { capabilities }: LSP.InitializeParams): Promise<FishServer>;
    private analyzer;
    private completion;
    private parser;
    private connection;
    private logger;
    private clientCapabilities;
    private constructor();
    register(connection: LSP.Connection): void;
    capabilities(): LSP.ServerCapabilities;
    private onHover;
    onCompletion(completionParams: TextDocumentPositionParams): Promise<CompletionList | null>;
    onCompleteResolve(item: CompletionItem): Promise<CompletionItem>;
}
//# sourceMappingURL=server.d.ts.map