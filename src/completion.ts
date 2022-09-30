import { MarkupKind } from "coc.nvim";
import {
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    MarkupContent,
} from "vscode-languageserver-protocol";
import { SyntaxNode } from "web-tree-sitter";
import { enrichToMarkdown } from "./documentation";
import { execCompleteAbbrs, execCompleteVariables } from "./utils/exec";

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
    docs: string | MarkupContent,
    type: FishCompletionItemType,
    filterText?: string
): CompletionItem {
    const itemKind = toCompletionItemKind(type);
    return {
        ...CompletionItem.create(name),
        documentation: docs,
        kind: itemKind,
        filterText: filterText || "",
        data: {
            name: name,
            documentation: docs,
            kind: itemKind,
            fishKind: type,
        },
    };
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
    private currentNode: SyntaxNode | undefined;
    private commandNode: SyntaxNode | undefined;

    private globalVariableList: CompletionItem[] = [];
    private abbrList: CompletionItem[] = [];
    private localVariablesList: CompletionItem[] = [];
    private localFunctions: CompletionItem[] = [];

    private isInsideCompletionsFile: boolean = false;

    private completions: CompletionItem[] = [];
    private isIncomplete: boolean = false;

    constructor() {
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
    }

    // call in server.initialize()
    // also you could add the syntaxTree on
    // this.documents.listener.onDocumentChange(() => {})
    public async initialDefaults() {
        this.globalVariableList = await buildGlobalVars();
        this.abbrList = await buildGlobalAbbr();
    }

    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    private enrichCompletions() {}

    // probably need some of SyntaxTree class in this file
    public async generate(node: SyntaxNode) {
        this.completions = [
            ...this.abbrList,
            ...this.globalVariableList,
        ]
        return CompletionList.create(this.completions, this.isIncomplete);
    }

    // create (atleast) two methods for generating completions,
    //      1.) with a syntaxnode -> allows for thorough testing
    //      2.) with a params -> allows for fast implementation to server
    //                        -> this also needs to work for server.onHover()
    //      3.) with just text -> allows for extra simple tests
    //
    //
}

async function buildGlobalAbbr() {
    const globalVars = await execCompleteAbbrs();
    return globalVars
        .map((abbr) => abbr.split("--", 1)[1].trim())
        .map((abbr) => {
            const arr = abbr.split(" ", 1);
            const name = arr[0];
            const abbrReplaceText = arr[1];
            return buildCompletionItem(
                name,
                enrichToMarkdown("__abbreviation__: " + abbrReplaceText),
                FishCompletionItemType.abbr,
                abbrReplaceText
            );
        });
}

async function buildGlobalVars() {
    const globalVars = await execCompleteVariables();
    return globalVars
        .map((gvar) => gvar.split("\t", 1))
        .map((arr) => {
            const name = arr[0];
            const descArr = arr[1].split(" ", 1);
            const docs = enrichToMarkdown(["__" + descArr[0] + "__ ", descArr[1]].join(" "));
            return buildCompletionItem(name, docs, FishCompletionItemType.variable);
    });
}

async function buildGlobalFunctions() {

}

