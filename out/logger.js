"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor(connection) {
        this.connection = connection;
        this.console = connection.console;
    }
    log(msg, action = '', word = '') {
        const newMsgArr = msg.split('/');
        const newMsg = newMsgArr.length > 1
            ? newMsgArr[newMsgArr.length - 1]
            : msg;
        if (action !== '' && word !== '') {
            this.console.log(`[${action}]: '${newMsg}' - word: ${word}`);
        }
        else if (action !== '' && word === '') {
            this.console.log(`[${action}]: '${newMsg}'`);
        }
        else {
            this.console.log(msg);
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map