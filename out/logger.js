"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogMessageBuilder = exports.isLogMessage = exports.isSyntaxNode = exports.Logger = void 0;
class Logger {
    constructor(connection) {
        this.connection = connection;
        this.console = connection.console;
    }
    log(msg) {
        this.console.log(msg);
    }
    logmsg({ action = "", path = "", message = "", word = "", params = null, node = null, }) {
        const msg = new LogMessageBuilder(action, path, message, word || '', params, node);
        this.console.log(msg.toString());
    }
}
exports.Logger = Logger;
//export function isTextDoc(obj: any): obj is TextDocumentPositionParams {
//    return <TextDocumentPositionParams>obj.textDocument.uri !== undefined;
//}
function isSyntaxNode(obj) {
    return obj.text !== undefined;
}
exports.isSyntaxNode = isSyntaxNode;
function isLogMessage(obj) {
    return obj !== undefined;
}
exports.isLogMessage = isLogMessage;
class LogMessageBuilder {
    constructor(action = "", path = "", message = "", word = "", params = null, node = null) {
        var _a;
        this.action = action;
        this.message = message;
        let pstring = path;
        if (path != "" && params != null) {
            pstring = (_a = params.textDocument) === null || _a === void 0 ? void 0 : _a.uri;
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
exports.LogMessageBuilder = LogMessageBuilder;
function nodeToString(node) {
    return `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`;
}
//# sourceMappingURL=logger.js.map