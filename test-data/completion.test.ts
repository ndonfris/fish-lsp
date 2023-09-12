import {CompletionItem,  CompletionContext, CompletionParams, DocumentSymbol, Position, Range, SymbolKind, TextDocumentIdentifier, CompletionTriggerKind, CompletionItemKind} from 'vscode-languageserver';
import { assert } from 'chai'
//import { generateCompletionList } from '../src/completion';
import Parser, {SyntaxNode} from 'web-tree-sitter';
import {initializeParser} from '../src/parser';
import {LspDocument} from '../src/document';
import { DocumentationCache, getVariableDocString, getAbbrDocString, getFunctionDocString, initializeDocumentationCache } from '../src/utils/documentationCache'
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
import { FishCompletionList } from '../src/completion-list';
import { getChildNodes,  getLeafs } from '../src/utils/tree-sitter';
import { AbbrList, EventNamesList, FunctionNamesList, GlobalVariableList, isBuiltin, isFunction } from '../src/utils/builtins';
//import { createShellItems, findShellPath, ShellItems, spawnSyncRawShellOutput } from '../src/utils/startup-shell-items';
import * as SHELL from '../src/utils/shell-items';
//import { initializeShellCache } from '../src/utils/shell-cache';
import * as CACHE from '../src/utils/shell-cache';
import { FishSimpleCompletionItem } from '../src/utils/completion-types';
//import * as ParserTypes from '../node_modules/tree-sitter-fish/src/node-types.json';

let parser: Parser;
//let workspaces: Workspace[] = []
//let analyzer: Analyzer;
let completions: FishCompletionList;
let items: SHELL.ShellItems = new SHELL.ShellItems();

setLogger(
    async () => {
        parser = await initializeParser();
        completions = await FishCompletionList.create()
    },
    async () => {
    }
)

describe('complete simple tests', () => {

    it('testing edits to completionLine, to find commands";`', async () => {
        const inputs: string[] = [
            'echo',
            'ls -',
            'if',
            'if t',
            'if [',
            'if test',
            'if (a',
            'printf "',
            'for _',
            'for i in',
        ];
        type tblItem = {input: string, addChar: string, hasCmd: boolean, cmd: string, lineNodes: string} 
        const buildTable = (addChar: string) => {
            console.log("LOGGING WHAT HAPPENS WHEN CHAR ADDED TO LINE IS : ", `'${addChar}'`);
            const tbl: tblItem[] = []
            inputs.forEach( (input: string) => {
                const {rootNode} = parser.parse(input + addChar)
                let cmd = rootNode.descendantsOfType('command')
                let firstCmd = cmd.at(0)?.text || 'NULL'
                let hasCmd = cmd.length > 0
                tbl.push({input, addChar, hasCmd: hasCmd, cmd: firstCmd, lineNodes: rootNode.toString()})
            })
            console.table(tbl);
        }
        //buildTable('-')
        buildTable(';')
        buildTable(';end;')
    }, 1000)

    it('testing contextual analysis ("word" && "command") for completion-list";`', async () => {
        type tblItem = {input: string, cmd: string, word: string} 
        const tbl: tblItem[] = [];
        [
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
        ].forEach((input: string) => {
            const {word, command} = completions.getNodeContext(input)
            tbl.push({input: input, cmd: command || '', word: word || ''})
        })
        console.table(tbl);
    }, 1000)

    //it('get subshell completions from stdout', async () => {
    //    let inputText = 'g';
    //    const {word,command} = completions.getNodeContext(inputText);
    //    console.log({word,command});
    //    const outputArray = await completions.getSubshellStdoutCompletions(inputText);
    //    for (const [label, desc] of outputArray) {
    //        if (items.hasItem(label, ['function'])) console.log('FUNCTION', {label, desc});
    //        if (items.hasItem(label, ['builtin'])) console.log('BUILTIN', {label, desc});
    //        if (items.hasItem(label, ['abbr'])) console.log('ABBR', {label, desc});
    //        //if (desc.startsWith('command')) continue
    //        //if (label === 'ls') console.log('LSLSLSLS', {label, desc});
    //        //console.log({label, desc});
    //    }
    //    //const outputArray = await completions.getSubshellStdoutCompletions('ls -');
    //    //console.log(outputArray.length, outputArray);
    //    console.log("");
    //    console.log("");
    //    console.log("");
    //    //await cached.init()
    //    console.log(cached._cached);
    //    console.log();
    //    console.log(cached.getCompletionType('ls'));
    //    console.log(cached.hasLabel('ls'));
    //})

    /*it('timing ShellItems', async () => {*/
    /*    const start = Date.now();*/
    /*    await items.init()*/
    /*    const end = Date.now();*/
    /*    console.log(`ShellItems took ${end - start} ms to initialize`);*/
    /*})*/

    it('timing SHELL.initFishCompletionItemKinds()', async () => {
        const start = Date.now();
        const cachedAll = await CACHE.initFishCompletionItemKinds()
        const allEntries = Object.entries(cachedAll)
        for (const [k,v] of allEntries) {
            console.log(k.toString(), v.labels);
            //console.log(`${k}: ${v.labels.size}`);
        }
        const end = Date.now();
        console.log(`SHELL.initFishCompletionItemKinds() took ${end - start} ms to initialize`);
    })


    it('docs testing', async () => {
        const start = Date.now();
        const items = new SHELL.ShellItems();
        await items.initialize()
        const end = Date.now();
        console.log(`SHELL.ShellItems().initialize() took ${end - start} ms to initialize`);
        for (const [k, v] of items.entries()) {
            console.log(`key: '${k}'`, `values: [${Array.from(v.labels.values()).slice(0, 5).map((v) => `'${v}'`).join(', ')}]`);
        }
        //const txt: string[] = []
        //for (const i of SHELL.FishCompletionItemKind.enums()) {
        //    txt.push(`'${i}'`)
        //}
        //console.log(txt.join('|'))
        //FishCompletionItemKind.en
        //items.initForCommands()
        //console.log((await execCmd('functions -D -v lso')));
        //console.log((await execCommandDocs('lso')));
        //console.log((await getFunctionDocString('lso')));
        //console.log((await getAbbrDocString('gw')));
        //console.log((await  getVariableDocString('PATH')));
    })

    it('testing execCmd', async () => {
        const start = Date.now();
        let out = await execCmd(`builtin complete -C ''`)
        out = out.slice(0,5)
        for (const o of out) {
            let [start, ...end] = o.split(/\s/g,2)
            let endStr = end.join(' ')
            console.log({start, endStr});
        }
        
        //console.log(out.slice(0, i));
        //console.log(out.slice(0, 5));
        const end = Date.now();
        console.log(`execCmd took ${end - start} ms to initialize`);
    })
})

//    id: number,
//        {
//            "type": "file_redirect",
//            "named": true,
//            "fields": {
//                "destination": {
//                    "multiple": false,
//                    "required": true,
//                    "types": [
//                        {
//                            "type": "brace_expansion",
//                            "named": true
//                        },
//                        {
//                            "type": "command_substitution",
//                            "named": true
//                        },
//                        {
//                            "type": "concatenation",
//                            "named": true
//                        },
//                        {
//                            "type": "double_quote_string",
//                            "named": true
//                        },
//                        {
//                            "type": "escape_sequence",
//                            "named": true
//                        },
//                        {
//                            "type": "float",
//                            "named": true
//                        },
//                        {
//                            "type": "glob",
//                            "named": true
//                        },
//                        {
//                            "type": "home_dir_expansion",
//                            "named": true
//                        },
//                        {
//                            "type": "integer",
//                            "named": true
//                        },
//                        {
//                            "type": "single_quote_string",
//                            "named": true
//                        },
//                        {
//                            "type": "variable_expansion",
//                            "named": true
//                        },
//                        {
//                            "type": "word",
//                            "named": true
//                        }
//                    ]
//                },
//                "operator": {
//                    "multiple": false,
//                    "required": true,
//                    "types": [
//                        {
//                            "type": "direction",
//                            "named": true
//                        }
//                    ]
//                }
//            }
//        }
//]

export const testCompletionCaptures = () => {
    const definitions = readFileSync(resolve(__dirname, '..', 'node_modules/tree-sitter-fish/src/node-types.json'), 'utf8')
    const jsonData = JSON.parse(definitions)
    const entries = Object.entries(jsonData)
    for (const [k, v] of entries) {
        console.log(k, JSON.stringify(v, null, 4));
    }
}