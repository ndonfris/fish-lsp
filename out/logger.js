"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const vscode_uri_1 = require("vscode-uri");
const completion_types_1 = require("./utils/completion-types");
class Logger {
    constructor() {
        this.enabled = true; // logger.enabled would disable all log messages
        this.hasRemote = false; // so that checking which console is possible
        this.hasRemote = false;
        this._console = console;
        this.timer = new LogTimer();
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    setConsole(console) {
        this.hasRemote = true;
        this._console = console;
    }
    get console() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance._console;
    }
    logOpts(opts) {
        if (opts === null || opts === void 0 ? void 0 : opts.error) {
            this.console.log('\t!!!ERROR!!!\t');
        }
        if ((opts === null || opts === void 0 ? void 0 : opts.caller) !== undefined) {
            this.console.log("[" + opts.caller + "]");
        }
        if (opts === null || opts === void 0 ? void 0 : opts.message) {
            this.console.log(opts.message);
        }
        if (opts === null || opts === void 0 ? void 0 : opts.extraInfo) {
            this.console.log([...opts.extraInfo].join("\n"));
        }
        if (opts === null || opts === void 0 ? void 0 : opts.position) {
            this.console.log(`position (character: ${opts.position.character}, line: ${opts.position.character})`);
        }
        if (opts === null || opts === void 0 ? void 0 : opts.document) {
            this.console.log(opts.document.getText());
        }
        if (opts === null || opts === void 0 ? void 0 : opts.completion) {
            this.console.log(completionToString(opts.completion));
        }
        if (opts === null || opts === void 0 ? void 0 : opts.hover) {
            this.console.log("hover \n\t{range:" + opts.hover.range + "}");
            this.console.log("\t{contents: " + opts.hover.contents);
        }
    }
    log(msg, opts) {
        if (this.enabled) {
            if (opts !== undefined)
                this.logOpts(opts);
            this.console.log(msg);
        }
    }
    startTimer(msg) {
        if (msg) {
            this.console.log(msg);
        }
        this.timer.start();
    }
    endTimer(msg) {
        this.timer.stop();
        let output = msg || "";
        output += this.timer.stop();
        this.console.log(output);
    }
}
class LogTimer {
    constructor() {
        this.startTime = 0;
        this.endTime = 0;
        this.running = false;
    }
    start() {
        this.startTime = performance.now();
        this.running = true;
    }
    stop() {
        this.endTime = performance.now();
        if (!this.running) {
            this.endTime = 0;
        }
        else {
            this.running = false;
        }
    }
    completed() {
        if (!this.running) {
            return `[total time: ${this.endTime - this.startTime} ms]`;
        }
        else {
            return `[timer incomplete]`;
        }
    }
}
class LogOptionsHandler {
    constructor() {
        this.types = [
            'caller',
            'message',
            'verticalPad',
            'error',
            'executableFile',
            'uri',
            'path',
            'rootNode',
            'nodes',
            'hover',
            'position',
            'completion',
            'document',
            'debugLogger',
        ];
    }
    buildString(newOpts) {
    }
}
// handle logging options differently
function getLogOptionsString(opts) {
    const strs = [getLogTitle(opts)];
    let verticalChar = '\n';
    for (const [key, value] of Object.entries(opts)) {
        //switch (key) {
        //    case 'completion':
        //        strs.push(completionToString(value))
        //    case 'document':
        //        //opts[key].getText()
        //        strs.push(value.getText())
        //    case 'rootNode':
        //        //strs.push("ROOT " + nodeToString(value))
        //    case 'nodes':
        //        const currStr:string[] = []
        //        //value.forEach((n: SyntaxNode) => {
        //        //    //currStr.push("\t" + nodeToString(n));
        //        //});
        //        //strs.push(currStr.join('\n'))
        //    case 'executableFile':
        //        strs.push(value + ' (fish executable file)' )
        //    case 'position':
        //        strs.push(`position (character: ${value.character}, line: ${value.character})`)
        //    case 'path':
        //        strs.push(`file path: ${opts.path})`)
        //    case 'uri':
        //        strs.push(getUriInfo(value))
        //    case 'extraInfo':
        //        strs.push('Extra Info:\n' + [...value].join('\n'))
        //    case 'debugLogger':
        //        strs.push(`LOGGER OPTIONS: ${Object.getOwnPropertySymbols(opts).join(',\n')}`)
        //    case 'verticalPad':
        //        verticalChar += getSeperator() + '\n'
        //    default:
        //        strs.push(`Key not known in LogOptions ${key}`)
        //}
    }
    return strs.join(verticalChar);
}
function nodeToString(node) {
    return `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`;
}
function completionToString(completion) {
    var _a, _b;
    const fishCmp = completion;
    let str = [];
    const fishType = (_a = fishCmp.data) === null || _a === void 0 ? void 0 : _a.fishKind;
    const cmpType = fishCmp.kind;
    switch (fishType) {
        case completion_types_1.FishCompletionItemKind.ABBR:
            str.push('');
            str.push("type: [ABBREVIATION]: " + fishCmp.label);
            str.push("doc:" + fishCmp.documentation);
            str.push("originalComp:" + ((_b = fishCmp.data) === null || _b === void 0 ? void 0 : _b.originalCompletion));
            str.push("insertText: " + fishCmp.insertText);
            str.push('');
        case completion_types_1.FishCompletionItemKind.CMD:
            str.push("type: [CMD] ");
            str.push("doc:" + fishCmp.documentation);
    }
    return `completionItem '${completion.label}'` + str.join('\n');
}
function getSeperator() {
    let char = '-';
    let str = "";
    for (let index = 0; index < 80; index++) {
        str += char;
    }
    return str;
}
function getUriInfo(uri) {
    return [
        'uri.toString:' + uri.toString(),
        'uri.fsPath:' + uri.fsPath,
        'parse(uri.fsPath): ' + vscode_uri_1.URI.parse(uri.fsPath),
        'uri.path:' + uri.path,
        '...'
    ].join('\n') + 'uri.json: ' + JSON.stringify(uri.toJSON());
}
// logger printing helpers
function getLogTitle(opts) {
    let str = "";
    if (opts.error) {
        str += '\t!!!ERROR!!!\t';
    }
    if (opts.caller !== undefined) {
        str += '[' + opts.caller + '] ';
    }
    if (opts.message !== undefined) {
        str += opts.message.toString() + '\n';
    }
    return str;
}
exports.logger = Logger.getInstance();
//if (opts.completion) {
//}
//if (opts.document) {
//}
//if (opts.rootNode) {
//    strs.push("ROOT " + nodeToString(opts.rootNode))
//}
//if (opts.nodes) {
//    for (const n of opts.nodes) {
//        strs.push('\t' + nodeToString(n))
//    }
//}
//if (opts.executableFile) {
//    strs.push(opts.executableFile + ' (fish executable file)' )
//}
//if (opts.position) {
//    strs.push(`position (character: ${opts.position.character}, line: ${opts.position.character})`)
//}
//if (opts.path) {
//    strs.push(`file path: ${opts.path})`)
//}
//if (opts.uri) {
//    strs.push(getUriInfo(opts.uri))
//}    
//if (opts.extraInfo) {
//    strs.push('Extra Info:\n' + [...opts.extraInfo].join('\n'))
//}
//if (opts.debugLogger) {
//    strs.push(`LOGGER OPTIONS: ${Object.getOwnPropertySymbols(opts).join(',\n')}`)
//}
//if (opts.verticalPad) {
//    verticalChar += getSeperator() + '\n'
//}
//# sourceMappingURL=logger.js.map