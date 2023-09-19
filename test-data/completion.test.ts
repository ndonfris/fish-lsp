import {CompletionItem,  CompletionContext, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier, CompletionTriggerKind, CompletionItemKind} from 'vscode-languageserver';
import { assert } from 'chai'
//import { generateCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {LspDocument} from '../src/document';
import { DocumentationCache, getVariableDocString, getAbbrDocString, getFunctionDocString, initializeDocumentationCache, getBuiltinDocString, getCommandDocString } from '../src/utils/documentationCache'
import { containsRange, findDefinitionSymbols, } from '../src/workspace-symbol';
import { Color } from 'colors';
import { Analyzer } from '../src/analyze';
import { setLogger } from './helpers'
import { execCmd, execCommandDocs, execCompleteGlobalDocs, execCompleteVariables, execCompletionHelper, execEscapedCommand } from '../src/utils/exec';
import { promisify } from 'util';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { initializeDefaultFishWorkspaces, Workspace } from '../src/utils/workspace';
import { toLspDocument } from '../src/utils/translation';
import { homedir } from 'os';
//import { FishCompletionItem, FishCompletionItemKind, toCompletionKindString } from '../src/utils/completion-strategy';
import { isBeforeCommand, isBlockBreak, isCommand, isCommandName, isPartialForLoop, isScope, isSemicolon } from '../src/utils/node-types';
import { Node } from './mock-datatypes';
//import { FishCompletionList } from '../src/completion/';
import { getChildNodes,  getLeafs } from '../src/utils/tree-sitter';
//import { AbbrList, EventNamesList, FunctionNamesList, GlobalVariableList, isBuiltin, isFunction } from '../src/utils/builtins';
//import { createShellItems, findShellPath, ShellItems, spawnSyncRawShellOutput } from '../src/utils/startup-shell-items';
//import * as SHELL from '../src/utils/shell-items';
//import { initializeShellCache } from '../src/utils/shell-cache';
import { InlineParser } from '../src/utils/completion/inline-parser';
import * as CACHE from '../src/utils/completion/startup-cache';
import { FishCompletionItem, FishCompletionItemKind } from '../src/utils/completion/types';
import { CompletionPager, initializeCompletionPager } from '../src/utils/completion/pager'
//import { FishCompletionItem, FishCompletionItemKind, getDocumentationResolver } from '../src/utils/completion-types';
//import { FishCompletionItemKind } from '../src/utils/completion-strategy';
//import * as ParserTypes from '../node_modules/tree-sitter-fish/src/node-types.json';

let parser: Parser;
//let workspaces: Workspace[] = []
//let analyzer: Analyzer;
let pager: CompletionPager
//let items: SHELL.ShellItems = new SHELL.ShellItems();
let items: CACHE.CompletionItemMap

setLogger(
    async () => {
        parser = await initializeParser();
        pager = await initializeCompletionPager();
        //completions = await InlineParser.create()
        //items = await CACHE.CompletionItemMap.initialize()
        //items = await CACHE.createSetupItemsFromCommands()
    },
    async () => {
    }
)

describe('complete simple tests', () => {
    //it('testing execCmd', async () => {
    //    const start = Date.now();
    //    let out = await execCmd(`builtin complete -C ''`)
    //    const end = Date.now();
    //    console.log(`execCmd took ${end - start} ms to initialize`);
    //
    //})

    it('get subshell completions from stdout', async () => {
        let inputText = 'function _foo -';
        const data = {uri: 'file:///test.fish', position: Position.create(0,0), context: {triggerKind: CompletionTriggerKind.Invoked}};
        const list = await pager.complete(inputText, data, [])
        for (const item of list) {
            console.log({label: item.label, detail: item.detail, kind: item.fishKind});
        }
        //const {label, value} = CACHE.splitLine('fzf_gt  alias fzf_gt=__fzf_open_mine')
        //console.log({label, value});

        //console.log(context.commandNode?.text, context.commandNode?.parent?.endIndex);
        //for (const [label, desc] of outputArray) {
        //    //const _item = items.findLabel(label, FishCompletionItemKind.FUNCTION, FishCompletionItemKind.BUILTIN, FishCompletionItemKind.ABBR, FishCompletionItemKind.ALIAS, FishCompletionItemKind.COMMAND)
        //    // call commandLine to get the documentation
        //    const smallerCheck = items.findLabel(label, 'command')
        //    if (label === 'fortune') {
        //        console.log(label, smallerCheck);
        //        const docs = await getDocumentationResolver(smallerCheck!)
        //        console.log(docs);
        //    }
        //    continue;
        //}
        //await cached.init()
        //console.log(cached._cached);
        //console.log();
        //console.log(cached.getCompletionType('ls'));
        //console.log(cached.hasLabel('ls'));
    })
})


//export async function createCompletionList(input: string) {
//    const result: FishCompletionItem[] = [];
//    const {word, command, wordNode, commandNode, index} = completions.getNodeContext(input);
//    if (!command) {
//        return items.allCompletionsWithoutCommand().filter((item) => item.label.startsWith(input))
//    }
//    switch (command) {
//        //case "functions":
//        //    return index === 1 ? items.allOfKinds("function", 'alias') : result;
//        //case "command":
//        //    return index === 1 ?items.allOfKinds("command") : result;
//        //case 'builtin':
//        //    return index === 1 ? items.allOfKinds("builtin") : result;
//        case "end":
//            return items.allOfKinds("pipe");
//        case "printf":
//            return index === 1 ? items.allOfKinds("format_str", "esc_chars") : items.allOfKinds("variable");
//        case "set":
//            return items.allOfKinds("variable");
//        //case 'function':
//        //    //if (isOption(lastNode) && ['-e', '--on-event'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.FUNCTIONS);
//        //    //if (isOption(lastNode) && ['-v', '--on-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
//        //    //if (isOption(lastNode) && ['-V', '--inherit-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
//        //    //result.push(CompletionItemsArrayTypes.AUTOLOAD_FILENAME);
//        //    break
//        case "return":
//            return items.allOfKinds("status", "variable");
//        default:
//            return items.allOfKinds("pipe");
//    }
//    return result
//
//}

export const completionStrings : string[] = [
    'echo ',
    'ls',
    'ls ',
    'ls -',
    'if',
    'if ',
    'if t',
    ';',
    'if [',
    'if [ ',
    'if test',
    'if (a',
    'printf "',
    '',
    'for',
    'for ',
    'for i',
    'for i ',
    'for i in',
    'while',
    'while (',
    'while ()',
    'echo "hi" > ',
    'function',
    'else if',
    'else',
    'case',
    'case ',
    "case '*",
    'end',
    'ls |',
    'not',
    'and',
    'and test',
    'and test ',
    'or ',
    'if test -f file.txt; and test -f file2.txt; or ',
    'ls | read',
    'ls | read ',
    'ls | read -',
    'ls | read -L',
    'ls | read -L ',
    'ls | read -L -l',
    'ls | read -L -l v',
    'continue',
    'continue ',
]