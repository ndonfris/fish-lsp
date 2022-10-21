import {Hover} from 'coc.nvim';
import {
    CompletionItem,
    Connection,
    Position,
    RemoteConsole,
    TextDocumentPositionParams,
} from "vscode-languageserver";
import {TextDocument} from 'vscode-languageserver-textdocument';
import {URI, Utils} from 'vscode-uri';
import { SyntaxNode } from "web-tree-sitter";
import {FishCompletionItem, FishCompletionItemKind} from './utils/completion-types';


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


class Logger {
    private static instance : Logger;

    public enabled = true;     // logger.enabled would disable all log messages
    public hasRemote = false; // so that checking which console is possible
    private _console: RemoteConsole | Console;
    private timer: LogTimer ;

    public static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private constructor() {
        this.hasRemote = false;
        this._console = console;
        this.timer = new LogTimer()
    }

    public setConsole(console: RemoteConsole) {
        this.hasRemote = true;
        this._console = console;
    }

    get console() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance._console;
    }

    public logOpts(opts: LogOptions) {
        if (opts?.error) {
                this.console.log('\t!!!ERROR!!!\t')
        }
        if (opts?.caller !== undefined) {
            this.console.log("[" + opts.caller + "]");
        }
        if (opts?.message) {
            this.console.log(opts.message)

        }
        if (opts?.extraInfo) {
            this.console.log([...opts.extraInfo].join("\n"));
        }
        if (opts?.position) {
            this.console.log(`position (character: ${opts.position.character}, line: ${opts.position.character})`);
        }
        if (opts?.document) {
            this.console.log(opts.document.getText());
        }
        if (opts?.completion) {
            this.console.log(completionToString(opts.completion))
        }
        if (opts?.hover) {
            this.console.log("hover \n\t{range:" + opts.hover.range + "}");
            this.console.log("\t{contents: "+opts.hover.contents);
        }
    }

    public log(msg: string, opts?: LogOptions) {
        if (this.enabled) {
            if (opts !== undefined) this.logOpts(opts)

            this.console.log(msg);
        }
    }

    public startTimer(msg?: string) {
        if (msg) {
            this.console.log(msg)
        }
        this.timer.start()
    }

    public endTimer(msg?: string) {
        this.timer.stop()
        let output = msg || "";
        output += this.timer.stop()
        this.console.log(output)
    }
}


class LogTimer {

    private startTime: number;
    private endTime: number;
    private running: boolean;

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
        } else {
            this.running = false;
        }
    }

    completed() {
        if (!this.running) {
            return `[total time: ${this.endTime - this.startTime} ms]`
        } else {
            return `[timer incomplete]`
        }
    }
}

class LogOptionsHandler implements LogOptions {
    caller: string | undefined;
    message: string | undefined;
    extraInfo: string | string[] | undefined;
    verticalPad: boolean | undefined;
    error: boolean | undefined;
    executableFile: string | undefined;
    path: string | undefined;
    uri: URI | undefined;
    rootNode: SyntaxNode | undefined;
    nodes: SyntaxNode[] | undefined;
    position: Position | undefined;
    hover: Hover | undefined;
    completion: CompletionItem | undefined;
    document: TextDocument | undefined;
    debugLogger: boolean | undefined;

    types: string[] = [
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

    buildString(newOpts :LogOptions) {

    }


}



// handle logging options differently
function getLogOptionsString(opts: LogOptions) {
    const strs : string[] = [getLogTitle(opts)];
    let verticalChar: string = '\n';
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
    return strs.join(verticalChar)
}

function nodeToString(node: SyntaxNode): string {
    return `node: ${node.text}, type: ${node.type}, (${node.startPosition.row}, ${node.startPosition.column}) (${node.endPosition.row}, ${node.endPosition.column})`;
}

function completionToString(completion: CompletionItem) {
    const fishCmp = completion as FishCompletionItem;
    let str : string[] = [];
    const fishType = fishCmp.data?.fishKind;
    const cmpType = fishCmp.kind;
    switch (fishType) {
        case FishCompletionItemKind.ABBR:
            str.push('')
            str.push("type: [ABBREVIATION]: " + fishCmp.label);
            str.push("doc:" + fishCmp.documentation);
            str.push("originalComp:" + fishCmp.data?.originalCompletion);
            str.push("insertText: " + fishCmp.insertText);
            str.push('')
            break;
        case FishCompletionItemKind.CMD: 
            str.push("type: [CMD] ")
            str.push("doc:" + fishCmp.documentation)
            break;
    }
    return `completionItem '${completion.label}'` + str.join('\n')
}

function getSeperator() {
    let char = '-'
    let str = "";
    for (let index = 0; index < 80; index++) {
        str += char
    }
    return str;
}

function getUriInfo(uri: URI) {
    return [
        'uri.toString:' + uri.toString(),
        'uri.fsPath:' + uri.fsPath,
        'parse(uri.fsPath): ' + URI.parse(uri.fsPath),
        'uri.path:' + uri.path,
        '...'
    ].join('\n') + 'uri.json: ' +JSON.stringify(uri.toJSON())

}

// logger printing helpers
function getLogTitle(opts: LogOptions) {
    let str = "";
    if (opts.error) {
        str += '\t!!!ERROR!!!\t'
    }
    if (opts.caller !== undefined) {
        str += '[' + opts.caller + '] '
    }
    if (opts.message !== undefined) {
        str += opts.message.toString() + '\n';
    }
    return str;
}


export const logger = Logger.getInstance();



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
