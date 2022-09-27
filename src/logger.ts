


import {Connection, RemoteConsole} from 'vscode-languageserver'

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
