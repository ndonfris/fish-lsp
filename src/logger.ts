import {
    Connection,
    RemoteConsole,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import { SyntaxNode } from "web-tree-sitter";

export interface LogMessage {
    message?: string;
    action?: string;
    word?: string;
    path?: string;
    params?: null | TextDocumentPositionParams;
    node?: null | SyntaxNode;
}

export class Logger {
    connection: Connection;
    console: RemoteConsole;

    constructor(connection: Connection) {
        this.connection = connection;
        this.console = connection.console;
    }

    log(msg: string) {
        this.console.log(msg);
    }

    logmsg({
        action = "",
        path = "",
        message = "",
        word = "",
        params = null,
        node = null,
    }: {
        action?: string;
        path?: string;
        message?: string;
        word?: string | null | undefined;
        params?: TextDocumentPositionParams | null;
        node?: SyntaxNode | null;
    }) {
        const msg = new LogMessageBuilder(
            action,
            path,
            message,
            word || '',
            params,
            node
        );
        this.console.log(msg.toString());
    }
}

//export function isTextDoc(obj: any): obj is TextDocumentPositionParams {
//    return <TextDocumentPositionParams>obj.textDocument.uri !== undefined;
//}

export function isSyntaxNode(obj: any): obj is SyntaxNode {
    return <SyntaxNode>obj.text !== undefined;
}

export function isLogMessage(obj: any): obj is LogMessage {
    return <LogMessage>obj !== undefined;
}

export class LogMessageBuilder {
    action?: string;
    message?: string;
    word?: string;
    path?: string;
    params?: TextDocumentPositionParams | null;
    node?: SyntaxNode | null;

    constructor(
        action = "",
        path = "",
        message = "",
        word = "",
        params: TextDocumentPositionParams | null = null,
        node: SyntaxNode | null = null
    ) {
        this.action = action;
        this.message = message;
        let pstring = path;
        if (path != "" && params != null) {
            pstring = params.textDocument?.uri;
        }
        const parr = pstring.split("/");
        this.path = parr[parr.length - 1] || "";
        this.word = word;
        this.node = node;
    }

    toString() {
        let resultString = "---------------------------------------------\n";
        if (this.action != "") {
            resultString += `[${this.action}]\n`;
        }
        if (this.message != "") {
            resultString += `\tmessage: '${this.message}'\n`;
        }
        if (this.word != "") {
            resultString += `\tword: '${this.word}'\n`;
        }
        if (this.path != "") {
            resultString += `\tpath/uri: '${this.path}'\n`;
        }
        if (this.params != null) {
            resultString += `\t params.position: {line:${this.params.position.line}, character: ${this.params.position.character}}\n`;
        }
        if (this.node != null) {
            resultString += `\tnode:\n`;
            resultString += `\t\t${nodeToString(this.node)}\n`;
        }
        resultString += "---------------------------------------------\n";
        return resultString;
    }
}
function nodeToString(node: SyntaxNode): string {
    return `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`;
}
