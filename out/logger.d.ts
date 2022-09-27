import { Connection, RemoteConsole } from 'vscode-languageserver';
export declare class Logger {
    connection: Connection;
    console: RemoteConsole;
    constructor(connection: Connection);
    log(msg: string, action?: string, word?: string): void;
}
//# sourceMappingURL=logger.d.ts.map