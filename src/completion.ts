import { exec } from "child_process";
import FastGlob from "fast-glob";
import { promisify } from "util";
import {
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    DocumentSymbol,
    MarkupContent,
    Position,
    Range,
} from "vscode-languageserver";
import Parser, { SyntaxNode } from "web-tree-sitter";
import { TextDocument, DocumentUri } from "vscode-languageserver-textdocument";
import {
    enrichToCodeBlockMarkdown,
    enrichToMarkdown,
    enrichWildcard,
} from "./documentation";
//import {logger} from './logger';
//import { FishSymbol } from "./symbols";
import {
    BuiltInList,
    escapeChars,
    FishCompletionItemKind,
    pipes,
    statusNumbers,
    stringRegexExpressions,
    WildcardItems,
} from "./utils/completion-types";
import {
    CompletionItemBuilder,
    parseLineForType,
} from "./utils/completionBuilder";
import { isCommand } from "./utils/node-types";
import { firstAncestorMatch, getNodeAtRange, getRange } from "./utils/tree-sitter";
import { getNodeFromSymbol } from './workspace-symbol';
import { execCompletions } from './utils/exec';

// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}

// PREVIOUS: https://github.com/ndonfris/fishls/blob/master/server/src/complete.ts

const execAsync = promisify(exec);

function splitArray(
    label: string,
    description?: string
): [string, string, string] {
    let keyword = "";
    let otherInfo = "";
    if (description != undefined) {
        const [first, rest] = description.split(/:+\s+(.*)/);
        keyword = first.toLowerCase();
        otherInfo = rest || "";
    }
    //logger.log(`label: ${label} keyword: ${keyword} otherInfo: ${otherInfo}`)
    return [label, keyword, otherInfo];
}

// regex to remove all : and spaces
//function buildRegexExpressions(line: string): CompletionItem[] {
//    const items: CompletionItem[] = []
//    // regex to remove all : and spaces
//    const regex = /(\w+):?\s?/g

export async function getShellCompletions(
    cmd: string
): Promise<[string, string, string][]> {
    //const entireCommand = `fish --command 'complete --do-complete="${cmd}" | uniq'`;
    //const terminalOut = await execAsync(entireCommand);
    const terminalOut = await execCompletions(cmd);
    //if (terminalOut.stderr || !terminalOut.stdout) {
        //return [];
    //}
    return terminalOut
        .map((line) => {
            const [label, desc] = line.split("\t");
            return splitArray(label, desc);
        });
}

export function insideStringRegex(line: string): boolean {
    const arr: string[] = line.trim().split(/\s+/);
    const currentNode = arr[arr.length - 1];
    if (!currentNode.startsWith('"') && !currentNode.startsWith("'")) {
        return false;
    }
    if (
        currentNode.length > 1 &&
        currentNode.charAt(0) === currentNode.charAt(currentNode.length - 1)
    ) {
        return false;
    }
    if (
        arr.includes("string") &&
        (arr.includes("--regex") || arr.includes("-r"))
    ) {
        return !arr.includes("--");
    }
    return false;
}

export async function generateShellCompletionItems(
    line: string,
    currentNode: SyntaxNode
): Promise<CompletionItem[]> {
    const cmp = new CompletionItemBuilder();
    const items: CompletionItem[] = [];
    let output: [string, string, string][] = [];
    try {
        output = await getShellCompletions(line);
    } catch (error) {
        //logger.log("ERROR:" + error + '[inside generateShellCompletionItems()]')
        return items;
    }
    const commandNode = firstAncestorMatch(currentNode, (n) => isCommand(n));
    const cmdText = commandNode?.text.replace(/\s+(\w+)\s+.*/, "") || "";
    for (const [label, desc, other] of output) {
        const otherText = other.length > 0 ? other : cmdText;
        let fishKind = parseLineForType(label, desc, otherText);
        fishKind = fixFishKindForCommandFlags(fishKind, commandNode);
        const item = cmp
            .create(label)
            .documentation([desc, other].join(" "))
            .kind(fishKind)
            .originalCompletion([label, desc].join("\t") + " " + other)
            .insertText(other)
            .addSignautreHelp(cmdText)
            .build();

        items.push(item);
        cmp.reset();
    }
    return items;
}

export function workspaceSymbolToCompletionItem(
    root: SyntaxNode,
    symbols: DocumentSymbol[]
): CompletionItem[] {
    const cmp = new CompletionItemBuilder();
    const items: CompletionItem[] = [];
    for (const symbol of symbols) {
        const docText = getNodeAtRange(root, symbol.range)?.text || symbol.name;
        const item = cmp
            .create(symbol.name)
            .symbolInfoKind(symbol.kind)
            .localSymbol()
            .documentation(enrichToCodeBlockMarkdown(docText, "fish"))
            .build();
        items.push(item);
        cmp.reset();
    }
    return items;
}

function fixFishKindForCommandFlags(
    fishKind: FishCompletionItemKind,
    commandNode?: SyntaxNode | null
) {
    if (
        commandNode &&
        fishKind != FishCompletionItemKind.LOCAL_VAR &&
        fishKind != FishCompletionItemKind.GLOBAL_VAR
    ) {
        fishKind = FishCompletionItemKind.FLAG;
    }
    return fishKind;
}

// create (atleast) two methods for generating completions,
//      1.) with a syntaxnode -> allows for thorough testing
//      2.) with a params -> allows for fast implementation to server
//                        -> this also needs to work for server.onHover()
//      3.) with just text -> allows for extra simple tests
//
//
function getFunctionsFromFilepaths(...paths: string[]) {
    const found: string[] = [];
    paths.forEach((path: string) => {
        const files = FastGlob.sync("functions/**.fish", {
            absolute: false,
            dot: true,
            globstar: true,
            cwd: path,
        });
        files.forEach((file) => {
            const funcName = convertPathToFunctionName(file);
            if (funcName) {
                found.push(funcName);
            }
        });
    });
    return found;
}

function convertPathToFunctionName(pathString: string): undefined | string {
    const filepathArray = pathString.split("/");
    if (!filepathArray.includes("functions")) {
        return undefined;
    }
    const fishFuncFile = filepathArray.at(-1)?.replace(".fish", "");
    return fishFuncFile;
}

//////////////////////////////////////////////////////////////////////////////////////////
// @TODO: MOVE TO COMPLETION-TYPES ?
//////////////////////////////////////////////////////////////////////////////////////////

function buildEscapeChars(): CompletionItem[] {
    const chars = escapeChars;
    const cmpChars: CompletionItem[] = [];
    for (const k in chars) {
        const label = "\\" + k;
        const desc = chars[k];
        const item = CompletionItem.create(label);
        item.kind = CompletionItemKind.Text;
        item.documentation = desc;
        cmpChars.push(item);
    }
    return cmpChars;
}

function buildStatusNumbers(): CompletionItem[] {
    const numbs = statusNumbers;
    const statNumbers: CompletionItem[] = [];
    for (const label in numbs) {
        const item = CompletionItem.create(label);
        (item.kind = CompletionItemKind.Value),
            (item.documentation = numbs[label]);
        statNumbers.push(item);
    }
    return statNumbers;
}

function buildPipes(): CompletionItem[] {
    const cmpItems: CompletionItem[] = [];
    for (const pipe in pipes) {
        const item = CompletionItem.create(pipe);
        const altItem = CompletionItem.create(pipes[pipe].altLabel);
        item.kind = CompletionItemKind.Text;
        altItem.kind = CompletionItemKind.Text;
        item.documentation = pipes[pipe].documentation;
        altItem.documentation = pipes[pipe].documentation;
        altItem.insertText = pipes[pipe].insertText;
        cmpItems.push(item);
        cmpItems.push(altItem);
    }
    return cmpItems;
}

function buildWildcards(): CompletionItem[] {
    const cmpItems: CompletionItem[] = [];
    for (const char in WildcardItems) {
        const item = CompletionItem.create(char);
        item.documentation = enrichWildcard(
            char,
            WildcardItems[char].documentation,
            WildcardItems[char].examples
        );
        item.kind = WildcardItems[char].kind;
        cmpItems.push(item);
    }
    return cmpItems;
}

export function buildRegexCompletions(): CompletionItem[] {
    const cmpItems: CompletionItem[] = [];
    const cmpItem = new CompletionItemBuilder();
    for (const regexItem of stringRegexExpressions) {
        const item = cmpItem
            .create(regexItem.label)
            .documentation(regexItem.description)
            .addSignautreHelp("regexItem")
            .kind(CompletionItemKind.Text);
        cmpItems.push(item.build());
        cmpItem.reset();
    }
    return cmpItems;
}

export function buildDefaultCompletions() {
    const escChars = buildEscapeChars();
    const statusNumbers = buildStatusNumbers();
    const pipeObjs = buildPipes();
    const wildcards = buildWildcards();
    const builtIns = buildBuiltins();
    const cmpChars: CompletionItem[] = [
        ...builtIns,
        ...escChars,
        ...statusNumbers,
        ...pipeObjs,
        ...wildcards,
    ];
    return cmpChars;
}

export function buildBuiltins() {
    const cmpItems: CompletionItem[] = [];
    for (const builtin of BuiltInList) {
        const item = CompletionItem.create(builtin);
        item.kind = CompletionItemKind.Keyword;
        cmpItems.push(item);
    }
    return cmpItems;
}

export function buildDefaultCompletionItems() {
    const cmpItem = new CompletionItemBuilder();
    const cmpItems: CompletionItem[] = [];
    for (const builtin of BuiltInList) {
        const item = cmpItem
            .create(builtin)
            .kind(FishCompletionItemKind.BUILTIN)
            .build();
        cmpItems.push(item);
        cmpItem.reset();
    }
    return cmpItems;
}

export const BUILT_INS: CompletionItem[] = buildDefaultCompletionItems();

export function createCompletionList(
    newItems: CompletionItem[],
    position: Position,
    wordLen: number,
    hasCommandNode: boolean = false
): CompletionList {
    const cmpDefaults = !hasCommandNode ? BUILT_INS : [];
    let cmpList = [...cmpDefaults, ...newItems].filter(
        (item: CompletionItem, index: number, self: CompletionItem[]) =>
            self.findIndex((cmp) => cmp.label === item.label) === index
    );
    return {
        items: cmpList,
        isIncomplete: false,
        itemDefaults: {
            editRange: {
                insert: {
                    start: {
                        line: position.line,
                        character: position.character - wordLen,
                    },
                    end: { line: position.line, character: position.character },
                },
                replace: {
                    start: {
                        line: position.line,
                        character: position.character - wordLen,
                    },
                    end: { line: position.line, character: position.character },
                },
            },
        },
    };
}
