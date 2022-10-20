import {exec} from 'child_process';
import { promisify } from 'util';
import {
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    MarkupContent,
} from "vscode-languageserver-protocol/node";
import { SyntaxNode } from "web-tree-sitter";
import {Analyzer} from './analyze';
import { enrichToMarkdown } from "./documentation";
import {buildCompletionItemPromise} from './utils/completion-types';
import {
    execComplete,
    execCompleteAbbrs,
    execCompleteGlobalDocs,
    execCompleteVariables,
    execFindSubcommand,
} from "./utils/exec";
import { findParentCommand, isVariable } from "./utils/node-types";
import {getNodeText} from './utils/tree-sitter';

// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}

// PREVIOUS: https://github.com/ndonfris/fishls/blob/master/server/src/complete.ts

export enum FishCompletionItemType {
    function,
    builtin,
    abbr,
    flag,
    variable,
    line,
}

export function toCompletionItemKind(
    type: FishCompletionItemType
): CompletionItemKind {
    switch (type) {
        case FishCompletionItemType.function:
            return CompletionItemKind.Function;
        case FishCompletionItemType.builtin:
            return CompletionItemKind.Function;
        case FishCompletionItemType.abbr:
            return CompletionItemKind.Snippet;
        case FishCompletionItemType.flag:
            return CompletionItemKind.Field;
        case FishCompletionItemType.variable:
            return CompletionItemKind.Variable;
        default:
            return CompletionItemKind.Unit;
    }
}

function buildCompletionItem(
    name: string,
    detail: string,
    docs: string | MarkupContent,
    type: FishCompletionItemType,
    insertText?: string
): CompletionItem {
    const itemKind = toCompletionItemKind(type);
    return {
        ...CompletionItem.create(name),
        detail: detail,
        documentation: docs,
        kind: itemKind,
        insertText: insertText,
        filterText: itemKind === CompletionItemKind.Variable ? "$" : undefined,
        data: {
            name: name,
            documentation: docs,
            kind: itemKind,
            fishKind: type,
        },
    };
}
const execAsync = promisify(exec)

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
    private currentNode: SyntaxNode | undefined;
    private commandNode: SyntaxNode | undefined;

    public lineCmps: CompletionItem[] = [];
    public globalAbbrs: CompletionItem[] = [];
    private globalVars: CompletionItem[] = [];
    public globalAlaises: CompletionItem[] = [];
    public globalCmds: CompletionItem[] = [];
    public globalBuiltins: CompletionItem[] = [];
    private localVariables: Map<string, CompletionItem> =  new Map<string, CompletionItem>();
    private localFunctions: Map<string, CompletionItem> =  new Map<string, CompletionItem>();

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

        return Promise.all([
            //buildGlobalVars(),
            buildGlobalAbbrs(),
            //buildGlobalCommands(),
            buildGlobalAlaises(),
            //buildGlobalBuiltins(),
        ]).then(([_gAbbrs, _gAliases]) => {
            //globs.globalVars = _gVars;
            globs.globalAbbrs = _gAbbrs;
            //globs.globalCmds = _gCmds;
            globs.globalAlaises = _gAliases;
            //globs.globalBuiltins = _gBuiltins;
            return globs;
        });
    }

    public constructor() {
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
    }

    public addLocalMembers(vars: SyntaxNode[], funcs: SyntaxNode[]) {
        const oldVars = [...this.localVariables.keys()];
        const oldFuncs = [...this.localFunctions.keys()];
        const newVars = vars.filter(currVar => !oldVars.includes(getNodeText(currVar)))
        const newFuncs = funcs.filter(currVar => !oldFuncs.includes(getNodeText(currVar)))
        for (const fishVar of newVars) {
            const text = getNodeText(fishVar)
            const newItem = buildCompletionItem(
                text,
                'local vaiable',
                enrichToMarkdown('local variable' + ":  " + text),
                FishCompletionItemType.variable,
            )
            this.localVariables.set(text, newItem)
        }
        for (const fishFunc of newFuncs) {
            const text = getNodeText(fishFunc)
            const newItem = buildCompletionItem(
                text,
                'local function',
                enrichToMarkdown('local function' + ":  " + text),
                FishCompletionItemType.function,
            )
            this.localVariables.set(text, newItem)
        }
        return newVars.length + newFuncs.length
    }

    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched

    public async generateLineCmpNew(line: string): Promise<CompletionItem[]> {
        const cmd = line.replace(/(['$`\\])/g, '\\$1')
        const res = await execAsync(`fish --command "complete --do-complete='${cmd}' | uniq"`)
        const lines = res.stdout.split('\n').map(line => line.split('\t', 1)) 
            
        const lineCmps = await Promise.all(lines.map(async (arr: string[]) => {
            return await buildCompletionItemPromise(arr);
        }))
        this.lineCmps = lineCmps;
        return lineCmps
    }

    public async generateLineCompletion(line: string){
        const cmd = line.replace(/(['$`\\])/g, '\\$1')
        const res = await execAsync(`fish --command "complete --do-complete='${cmd}' | uniq"`)
        if (res.stdout) {
            this.lineCmps = res.stdout
                .split('\n')
                .map(line => line.split('\t'))
                .map((arr: string[]) => buildCompletionItem(
                    arr[0],
                    arr[1],
                    arr.reverse().join(':\t'),
                    FishCompletionItemType.line,
                ))
        }
    }

    public async generateCurrent(node: SyntaxNode) {
        this.currentNode = node;
        this.commandNode = findParentCommand(node) || this.currentNode;
        const fishCompletes: CompletionItem[] = [];
        //if (this.currentNode != this.commandNode) {
        //    const cmpString = await findEachSubcommand(this.commandNode);
        //    const cmps = await execComplete(cmpString);
        //    if (!cmps) return
        //    for (const cmp of cmps) {
        //        const cmpArr = cmp.split("\t", 1);
        //        fishCompletes.push(
        //            buildCompletionItem(
        //                cmpArr[0],
        //                cmpArr[1] || "",
        //                cmpArr[0].startsWith("$")
        //                    ? FishCompletionItemType.variable
        //                    : FishCompletionItemType.flag
        //            )
        //        );
        //    }
        //} else {
        //    const cmpString = await findEachSubcommand(this.commandNode);
        //    const cmps = await execComplete(cmpString);
        //    if (!cmps) return
        //    for (const cmp of cmps) {
        //        const cmpArr = cmp.split("\t", 1);
        //        fishCompletes.push(
        //            buildCompletionItem(
        //                cmpArr[0],
        //                cmpArr[1] || "",
        //                cmpArr[0].startsWith("$")
        //                    ? FishCompletionItemType.variable
        //                    : FishCompletionItemType.function
        //            )
        //        );
        //    }
        //}
        //return fishCompletes;
    }

    // probably need some of SyntaxTree class in this file
    public async generate(node: SyntaxNode) {
        //const fishCompletions = await this.generateCurrent(node) || []
        //await this.initialDefaults();
            //...this.localFunctions.values(),
            //...this.localVariables.values(),
            //...fishCompletions
        this.completions = [
            ...this.lineCmps,
            ...this.globalVars,
            //...this.globalCmds,
            ...this.globalBuiltins,
            ...this.globalAlaises,
            ...this.globalAbbrs,
        ]
        return CompletionList.create(this.completions, this.isIncomplete);
    }

    public fallbackComplete() {
        //const fishCompletions = await this.generateCurrent(node) || []
        //await this.initialDefaults();
        this.completions = [
            ...this.lineCmps,
            ...this.globalVars,
            //...this.globalCmds,
            ...this.globalBuiltins,
            ...this.globalAlaises,
            ...this.globalAbbrs
        ]
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

export async function buildGlobalAbbrs() {
    const globalAbbrs = await execCompleteGlobalDocs('abbrs');
    const ret = globalAbbrs.split('\n')
        .map(abbr => abbr.split('\t'))
        .map((abbr: string[]) => 
             buildCompletionItem(
                abbr[0].trim(),
                'abbr',
                enrichToMarkdown("__Abbreviation__: " + abbr.at(-1)),
                FishCompletionItemType.abbr,
                abbr.at(-1)
            )
        );
    return ret;
}

export async function buildGlobalVars(): Promise<CompletionItem[]>{
    const globalVars = await execCompleteGlobalDocs('vars');
    const ret = globalVars.split('\n')
        .map(gvar => gvar.split("\t"))
        .map((arr: string[]) => 
            buildCompletionItem(
                    "$"+arr[0],
                    arr[1],
                    enrichToMarkdown(arr.slice(1).join(': ') + '  '),
                    FishCompletionItemType.variable,
                    "$"+arr[0]
                ),
        )
    return ret;
}

export async function buildGlobalBuiltins(): Promise<CompletionItem[]>{
    const globalVars = await execCompleteGlobalDocs('builtins');
    const ret = globalVars.split('\n')
        .map(gvar => gvar.split("\t"))
        .map((arr: string[]) => 
            buildCompletionItem(
                arr[0],
                arr[1],
                arr[0],
                FishCompletionItemType.builtin,
            )
        )
    return ret;
}

export async function buildGlobalCommands(): Promise<CompletionItem[]>{
    const globalVars = await execCompleteGlobalDocs('commands');
    const ret = globalVars.split('\n')
        .map(gvar => gvar.split("\t"))
        .map((arr: string[]) => 
            buildCompletionItem(
                arr[0],
                arr[1],
                enrichToMarkdown("__command__: " + arr.at(0)),
                FishCompletionItemType.function,
            )
        )
    return ret;
}

export async function buildGlobalAlaises(): Promise<CompletionItem[]>{
    const globalVars = await execCompleteGlobalDocs('aliases');
    const ret = globalVars.split('\n')
        .map(gvar => gvar.split("\t"))
        .map((arr: string[]) => 
            buildCompletionItem(
                arr[0],
                arr[1],
                enrichToMarkdown(arr[1]),
                FishCompletionItemType.function,
            )
        )
    return ret;
}

async function findEachSubcommand(node: SyntaxNode) {
    if (node.children.length == 1) {
        return []
    }
    const children = node.children!.slice(1);
    let text = [node.child(0)!.text];
    for (const child of children) {
        const childText = child.text;
        if (childText.startsWith("-")) {
            return text;
        }
        const subcmds = await execFindSubcommand(text);
        if (subcmds.length > 0) {
            const found = subcmds.filter(subcmd => subcmd == childText)[0];
            if (found) {
                text.push(found);
            }
        }
    }
    return text;
}
