import { Connection, RemoteConsole, TextDocumentPositionParams } from "vscode-languageserver";
import { SyntaxNode } from "web-tree-sitter";
export interface LogMessage {
    message?: string;
    action?: string;
    word?: string;
    path?: string;
    params?: null | TextDocumentPositionParams;
    node?: null | SyntaxNode;
}
export declare class Logger {
    connection: Connection;
    console: RemoteConsole;
    constructor(connection: Connection);
    log(msg: string): void;
    logmsg({ action, path, message, word, params, node, }: {
        action?: string;
        path?: string;
        message?: string;
        word?: string | null | undefined;
        params?: TextDocumentPositionParams | null;
        node?: SyntaxNode | null;
    }): void;
}
export declare function isSyntaxNode(obj: any): obj is SyntaxNode;
export declare function isLogMessage(obj: any): obj is LogMessage;
export declare class LogMessageBuilder {
    action?: string;
    message?: string;
    word?: string;
    path?: string;
    params?: TextDocumentPositionParams | null;
    node?: SyntaxNode | null;
    constructor(action?: string, path?: string, message?: string, word?: string, params?: TextDocumentPositionParams | null, node?: SyntaxNode | null);
    toString(): string;
}
//# sourceMappingURL=logger.d.ts.map