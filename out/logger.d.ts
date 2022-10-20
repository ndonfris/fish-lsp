import { Hover } from 'coc.nvim';
import { CompletionItem, Position, RemoteConsole } from "vscode-languageserver";
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { SyntaxNode } from "web-tree-sitter";
export interface LogOptions {
    caller?: string;
    message?: string;
    extraInfo?: string | string[];
    verticalPad?: boolean;
    error?: boolean;
    executableFile?: string;
    path?: string;
    uri?: URI;
    rootNode?: SyntaxNode;
    nodes?: SyntaxNode[];
    position?: Position;
    hover?: Hover;
    completion?: CompletionItem;
    document?: TextDocument;
    debugLogger?: boolean;
}
declare class Logger {
    private static instance;
    enabled: boolean;
    hasRemote: boolean;
    private _console;
    private timer;
    static getInstance(): Logger;
    private constructor();
    setConsole(console: RemoteConsole): void;
    get console(): RemoteConsole | Console;
    logOpts(opts: LogOptions): void;
    log(msg: string, opts?: LogOptions): void;
    startTimer(msg?: string): void;
    endTimer(msg?: string): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map