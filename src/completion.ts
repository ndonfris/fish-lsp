import {exec} from 'child_process';
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
import {CompletionItemBuilder, parseLineForType, TerminalCompletionOutput} from './utils/completionBuilder';
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
    public fishFunctions: string[]  = [];

    private isInsideCompletionsFile: boolean = false;

    private completions: CompletionItem[] = [];
    private isIncomplete: boolean = false;


    // call in server.initialize()
    // also you could add the syntaxTree on
    // this.documents.listener.onDocumentChange(() => {})
    public static async initialDefaults() {
        const globs = new this();

        //globs.globalVars = await buildGlobalVars();
        //globs.globalAbbrs = await buildGlobalAbbrs();
        //globs.globalCmds = await buildGlobalCommands();
        //globs.globalAlaises = await buildGlobalAlaises();
        //globs.globalBuiltins = await buildGlobalBuiltins();
        //return globs;

        //return Promise.all([
        //    //buildGlobalVars(),
        //    buildGlobalAbbrs(),
        //    //buildGlobalCommands(),
        //    buildGlobalAlaises(),
        //    //buildGlobalBuiltins(),
        //]).then(([_gAbbrs, _gAliases]) => {
        //    //globs.globalVars = _gVars;
        //    globs.globalAbbrs = _gAbbrs;
        //    //globs.globalCmds = _gCmds;
        //    globs.globalAlaises = _gAliases;
        //    //globs.globalBuiltins = _gBuiltins;
        //    return globs;
        //});
    }

    public constructor() {
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
    }

    //public addLocalMembers(vars: SyntaxNode[], funcs: SyntaxNode[]) {
    //    const oldVars = [...this.localVariables.keys()];
    //    const oldFuncs = [...this.localFunctions.keys()];
    //    const newVars = vars.filter(currVar => !oldVars.includes(getNodeText(currVar)))
    //    const newFuncs = funcs.filter(currVar => !oldFuncs.includes(getNodeText(currVar)))
    //    for (const fishVar of newVars) {
    //        const text = getNodeText(fishVar)
    //        const newItem = buildCompletionItem(
    //            text,
    //            'local vaiable',
    //            enrichToMarkdown('local variable' + ":  " + text),
    //            FishCompletionItemType.variable,
    //        )
    //        this.localVariables.set(text, newItem)
    //    }
    //    for (const fishFunc of newFuncs) {
    //        const text = getNodeText(fishFunc)
    //        const newItem = buildCompletionItem(
    //            text,
    //            'local function',
    //            enrichToMarkdown('local function' + ":  " + text),
    //            FishCompletionItemType.function,
    //        )
    //        this.localVariables.set(text, newItem)
    //    }
    //    return newVars.length + newFuncs.length
    //}

    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched

    public async generateLineCmpNew(line: string): Promise<CompletionItem[] | null> {
        //const newLine = entireline.map(item => item.trim())
        let cmd = line.replace(/(['$`\\])/g, '\\$1');
        //const cmd = `complete --do-complete="${escapedCmd}" | uniq'`
        //const escapedCmd = quote(cmd)
        //logger.log('cmd:' + cmd)
        //logger.log('cmdText: ' + `fish --command 'complete --do-complete=\'${escapedCmd}\' | uniq'`)
        //const entireCommand = `fish --command 'complete --do-complete="${cmd}" | uniq'`
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
        //this.lineCmps = lines.map((line) => CompletionItem.create(line[0]));
        //this.lineCmps = await Promise.all(
        //        const item = itemBuilder
        //            .create(arr[])
        //            .kind(fishCmpType)
        //            .documentation(arr[1])
        //            .originalCompletion(arr.join('\t'))
        //        return item.build();

        //    }
        //))

        //this.lineCmps = items;
        return items;
    }
            

    //public async generateLineCompletion(line: string){
    //    const cmd = line.replace(/(['$`\\])/g, '\\$1')
    //    const res = await execAsync(`fish --command "complete --do-complete='${cmd}' | uniq"`)
    //    if (res.stdout) {
    //        this.lineCmps = res.stdout
    //            .split('\n')
    //            .map(line => line.split('\t'))
    //            .map((arr: string[]) => buildCompletionItem(
    //                arr[0],
    //                arr[1],
    //                arr.reverse().join(':\t'),
    //                FishCompletionItemType.line,
    //            ))
    //    }
    //}

    //public async generateCurrent(node: SyntaxNode) {
    //    this.currentNode = node;
    //    this.commandNode = findParentCommand(node) || this.currentNode;
    //    const fishCompletes: CompletionItem[] = [];
    //    //if (this.currentNode != this.commandNode) {
    //    //    const cmpString = await findEachSubcommand(this.commandNode);
    //    //    const cmps = await execComplete(cmpString);
    //    //    if (!cmps) return
    //    //    for (const cmp of cmps) {
    //    //        const cmpArr = cmp.split("\t", 1);
    //    //        fishCompletes.push(
    //    //            buildCompletionItem(
    //    //                cmpArr[0],
    //    //                cmpArr[1] || "",
    //    //                cmpArr[0].startsWith("$")
    //    //                    ? FishCompletionItemType.variable
    //    //                    : FishCompletionItemType.flag
    //    //            )
    //    //        );
    //    //    }
    //    //} else {
    //    //    const cmpString = await findEachSubcommand(this.commandNode);
    //    //    const cmps = await execComplete(cmpString);
    //    //    if (!cmps) return
    //    //    for (const cmp of cmps) {
    //    //        const cmpArr = cmp.split("\t", 1);
    //    //        fishCompletes.push(
    //    //            buildCompletionItem(
    //    //                cmpArr[0],
    //    //                cmpArr[1] || "",
    //    //                cmpArr[0].startsWith("$")
    //    //                    ? FishCompletionItemType.variable
    //    //                    : FishCompletionItemType.function
    //    //            )
    //    //        );
    //    //    }
    //    //}
    //    //return fishCompletes;
    //}

    // probably need some of SyntaxTree class in this file
    public async generate(node: SyntaxNode) {
        this.completions = [
            ...this.lineCmps,
        ]
        return CompletionList.create(this.completions, this.isIncomplete);
    }

    public fallbackComplete() {
        this.completions = [
            ...this.lineCmps,
        ]
        return CompletionList.create(this.completions, this.isIncomplete);
    }
}

