import * as LSP from 'vscode-languageserver';
export interface LspConnectionOptions {
    showMessageLevel: LSP.MessageType;
}
export declare function createLspConnection(options: LspConnectionOptions): LSP.Connection;
//# sourceMappingURL=connection.d.ts.map