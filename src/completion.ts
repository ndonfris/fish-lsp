import {exec} from 'child_process';
import FastGlob from 'fast-glob';
import {homedir} from 'os';
import { parse, quote, ParseOptions } from 'shell-quote';
import { promisify } from 'util';
import {
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    MarkupContent,
} from "vscode-languageserver-protocol/node";
import { SyntaxNode } from "web-tree-sitter";
import {enrichToMarkdown} from './documentation';
import {logger} from './logger';
import {CompletionItemBuilder, parseLineForType} from './utils/completionBuilder';
import {
    execComplete,
    execCompleteAbbrs,
    execCompleteGlobalDocs,
    execCompleteVariables,
    execFindSubcommand,
} from "./utils/exec";
import {FilepathResolver} from './utils/filepathResolver';
import { findParentCommand, isVariable } from "./utils/node-types";
import {getNodeText} from './utils/tree-sitter';

// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}

// PREVIOUS: https://github.com/ndonfris/fishls/blob/master/server/src/complete.ts

const execAsync = promisify(exec)

function splitArray(label: string, description?: string): [string, string, string] {
    let keyword = "";
    let otherInfo = "";
    if (description != undefined) {
        const [first, rest] = description.split(/:|\s+(.*)/);
        keyword = first.toLowerCase();
        otherInfo = rest || "";
    }
    //console.log(`label: ${label} keyword: ${keyword} otherInfo: ${otherInfo}`)
    return [label, keyword, otherInfo]
}


export async function getShellCompletions(cmd: string): Promise<[string, string, string][]> {
    const entireCommand = `fish --command 'complete --do-complete="${cmd}" | uniq'`
    const terminalOut = await execAsync(entireCommand)
    if (terminalOut.stderr || !terminalOut.stdout) {
        return [];
    }
    return terminalOut.stdout.trim()
        .split('\n').map(line => {
        const [label, desc] = line.split('\t')
        return splitArray(label, desc);
    })
}

// • include pipe completions
// • include escape character completions
// • be able to tell the difference between:
//              1.) cm|                        --->  not completed first command                                      no space
//              2.) cmd |                      --->  completed first command and now looking for next tokens          space
//              3.) cmd subcm|                 --->  completed first command but needs subcommand                     no space
//              4.) cmd -flag |                --->  completed first command and last command is flag                 space
//              5.) |                          --->  no commands have been inserted yet                               space/nothing
//              6.) cmd -flag "|               --->  completed first command and last command is quotation            space
//              7.) cmd \|                     --->  escape character                                                 \
//              8.) # |                        --->  comment                                                          # at begining of line
//              9.) cmd -flag |                --->  pipe completions                                                 end of line
//             10.)                            --->
//
// [^] solution ideas:
//     • keep track of text via current line in readFileSync/document.getText().split('\n')[document.position.line]
//     • use state machine for each of the above states?
//         • always get the last SyntaxNode character
//
export class Completion {

    public userFunctions: string[] = []
    public globalFunctions: string[]  = [];

    private isInsideCompletionsFile: boolean = false;

    private completions: CompletionItem[] = [];
    private isIncomplete: boolean = false;


    // call in server.initialize()
    // also you could add the syntaxTree on
    // this.documents.listener.onDocumentChange(() => {})
    public static async initialDefaults() {
        const globs = new this();
        globs.globalFunctions = getFunctionsFromFilepaths('/usr/share/fish')
        globs.userFunctions = getFunctionsFromFilepaths(`${homedir()}/.config/fish`)
        return globs;
    }

    public constructor() {
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
    }

    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    public async generateLineCmpNew(line: string): Promise<CompletionItem[] | null> {
        let cmd = line.replace(/(['$`\\])/g, '\\$1');
        const shellOutcompletions: [string, string, string][] = await getShellCompletions(cmd)
        if (shellOutcompletions.length == 0) {
            return null;
        }

        const itemBuilder = new CompletionItemBuilder();
        const items: CompletionItem[] = []

        for (const [label, desc, moreInfo] of shellOutcompletions) {
            const itemKind = parseLineForType(label, desc, moreInfo)
            const item = itemBuilder.create(label)
                .documentation([desc, moreInfo].join(' '))
                .kind(itemKind)
                .build()
            items.push(item)
            itemBuilder.reset()
        }
        this.completions.push(...items);
        return items;
    }
            


    // probably need some of SyntaxTree class in this file
    public async generate(node: SyntaxNode) {
        //this.completions = [
        //    //...this.lineCmps,
        //]
        return CompletionList.create(this.completions, this.isIncomplete);
    }

    public reset() {
        this.completions = [];
    }

    public fallbackComplete() {
        return CompletionList.create(this.completions, this.isIncomplete);
    }
}

    // create (atleast) two methods for generating completions,
    //      1.) with a syntaxnode -> allows for thorough testing
    //      2.) with a params -> allows for fast implementation to server
    //                        -> this also needs to work for server.onHover()
    //      3.) with just text -> allows for extra simple tests
    //
    //
function getFunctionsFromFilepaths(...paths: string[]) {
    const found : string[] = [];
    paths.forEach((path: string) => {
        const files = FastGlob.sync("functions/**.fish", {
            absolute: false,
            dot: true,
            globstar: true,
            cwd: path,
        });
        files.forEach(file => {
            const funcName = convertPathToFunctionName(file)
            if (funcName) {
                found.push(funcName)
            }
        })
    })
    return found;
}


function convertPathToFunctionName(pathString: string) : undefined | string {
    const filepathArray = pathString.split('/')
    if (!filepathArray.includes('functions')) {
        return undefined;
    }
    const fishFuncFile = filepathArray.at(-1)?.replace('.fish', '')
    return fishFuncFile;
}
