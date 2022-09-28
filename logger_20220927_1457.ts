


import {Connection, RemoteConsole, TextDocumentPositionParams} from 'vscode-languageserver'
import {SyntaxNode} from 'web-tree-sitter';

export interface LogMessage {
    message?: string;
    action?: string;
    word?: string;
    path?: string;
    params?: TextDocumentPositionParams;
    node?: SyntaxNode;
}

export class Logger {

    connection: Connection;
    console: RemoteConsole;

    constructor(connection: Connection) {
        this.connection = connection;
        this.console = connection.console;
    }

    log(msg: string, action='', word='') {
        const newMsgArr = msg.split('/')
        const newMsg = newMsgArr.length > 1 
            ? newMsgArr[newMsgArr.length-1]
            : msg
        
        if (action !== '' && word !== '') {
            this.console.log(`[${action}]: '${newMsg}' - word: ${word}`)
        } else if (action !== '' &&  word === ''){
            this.console.log(`[${action}]: '${newMsg}'`)
        } else {
            this.console.log(msg);
        }
    }
}


export function isTextDoc(obj: any): obj is TextDocumentPositionParams{
    return <TextDocumentPositionParams>obj.TextDocument.uri !== undefined;
}

export function isSyntaxNode(obj: any): obj is SyntaxNode{
    return <SyntaxNode>obj.text !== undefined;
}


export class LogMessageBuilder {
    message?: string;
    action?: string;
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
    ){
        this.action = '';
        this.message = message;
        let pstring = path
        if (path != '' && isTextDoc(params)) {
            pstring = params.textDocument?.uri
        }
        const parr = pstring.split('/')
        this.path = pstring[pstring.length-1]
        this.word = word
        this.node = node
    }

    toString() {
        let resultString = '';
        if (this.action != "") {
            resultString += `[${this.action}]`
        }
        if (this.message != "") {
            resultString += `\tpath/uri: '${this.message}'`
        }
        if (this.node != null) {
            resultString += `\tnode:\n`
            resultString += `\t\t${nodeToString(node)}`

        }

    }
}
function nodeToString(node: SyntaxNode) : string {
    return `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`
}
