"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDefaultCompletions = exports.buildRegexCompletions = exports.Completion = exports.getShellCompletions = void 0;
const child_process_1 = require("child_process");
const fast_glob_1 = __importDefault(require("fast-glob"));
const os_1 = require("os");
const util_1 = require("util");
const node_1 = require("vscode-languageserver-protocol/node");
const documentation_1 = require("./documentation");
const completion_types_1 = require("./utils/completion-types");
const completionBuilder_1 = require("./utils/completionBuilder");
// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}
// PREVIOUS: https://github.com/ndonfris/fishls/blob/master/server/src/complete.ts
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function splitArray(label, description) {
    let keyword = "";
    let otherInfo = "";
    if (description != undefined) {
        const [first, rest] = description.split(/:|\s+(.*)/);
        keyword = first.toLowerCase();
        otherInfo = rest || "";
    }
    //console.log(`label: ${label} keyword: ${keyword} otherInfo: ${otherInfo}`)
    return [label, keyword, otherInfo];
}
function getShellCompletions(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const entireCommand = `fish --command 'complete --do-complete="${cmd}" | uniq'`;
        const terminalOut = yield execAsync(entireCommand);
        if (terminalOut.stderr || !terminalOut.stdout) {
            return [];
        }
        return terminalOut.stdout.trim()
            .split('\n').map(line => {
            const [label, desc] = line.split('\t');
            return splitArray(label, desc);
        });
    });
}
exports.getShellCompletions = getShellCompletions;
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
class Completion {
    constructor() {
        this.userFunctions = [];
        this.globalFunctions = [];
        this.isInsideCompletionsFile = false;
        this.completions = [];
        this.isIncomplete = false;
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
    }
    // call in server.initialize()
    // also you could add the syntaxTree on
    // this.documents.listener.onDocumentChange(() => {})
    static initialDefaults() {
        return __awaiter(this, void 0, void 0, function* () {
            const globs = new this();
            globs.globalFunctions = getFunctionsFromFilepaths('/usr/share/fish');
            globs.userFunctions = getFunctionsFromFilepaths(`${(0, os_1.homedir)()}/.config/fish`);
            return globs;
        });
    }
    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    generateLineCmpNew(line) {
        return __awaiter(this, void 0, void 0, function* () {
            let cmd = line.replace(/(['$`\\])/g, '\\$1');
            const shellOutcompletions = yield getShellCompletions(cmd);
            if (shellOutcompletions.length == 0) {
                return null;
            }
            const itemBuilder = new completionBuilder_1.CompletionItemBuilder();
            const items = [];
            for (const [label, desc, moreInfo] of shellOutcompletions) {
                const itemKind = (0, completionBuilder_1.parseLineForType)(label, desc, moreInfo);
                const item = itemBuilder.create(label)
                    .documentation([desc, moreInfo].join(' '))
                    .kind(itemKind)
                    .build();
                items.push(item);
                itemBuilder.reset();
            }
            this.completions.push(...items);
            return items;
        });
    }
    // probably need some of SyntaxTree class in this file
    generate(node) {
        return __awaiter(this, void 0, void 0, function* () {
            //this.completions = [
            //    //...this.lineCmps,
            //]
            return node_1.CompletionList.create(this.completions, this.isIncomplete);
        });
    }
    reset() {
        this.completions = [];
    }
    fallbackComplete() {
        return node_1.CompletionList.create(this.completions, this.isIncomplete);
    }
}
exports.Completion = Completion;
// create (atleast) two methods for generating completions,
//      1.) with a syntaxnode -> allows for thorough testing
//      2.) with a params -> allows for fast implementation to server
//                        -> this also needs to work for server.onHover()
//      3.) with just text -> allows for extra simple tests
//
//
function getFunctionsFromFilepaths(...paths) {
    const found = [];
    paths.forEach((path) => {
        const files = fast_glob_1.default.sync("functions/**.fish", {
            absolute: false,
            dot: true,
            globstar: true,
            cwd: path,
        });
        files.forEach(file => {
            const funcName = convertPathToFunctionName(file);
            if (funcName) {
                found.push(funcName);
            }
        });
    });
    return found;
}
function convertPathToFunctionName(pathString) {
    var _a;
    const filepathArray = pathString.split('/');
    if (!filepathArray.includes('functions')) {
        return undefined;
    }
    const fishFuncFile = (_a = filepathArray.at(-1)) === null || _a === void 0 ? void 0 : _a.replace('.fish', '');
    return fishFuncFile;
}
function buildEscapeChars() {
    const chars = completion_types_1.escapeChars;
    const cmpChars = [];
    for (const k in chars) {
        const label = '\\' + k;
        const desc = chars[k];
        const item = node_1.CompletionItem.create(label);
        item.kind = node_1.CompletionItemKind.Text;
        item.documentation = desc;
        cmpChars.push(item);
    }
    return cmpChars;
}
function buildStatusNumbers() {
    const numbs = completion_types_1.statusNumbers;
    const statNumbers = [];
    for (const label in numbs) {
        const item = node_1.CompletionItem.create(label);
        item.documentation = numbs[label];
        statNumbers.push(item);
    }
    return statNumbers;
}
function buildPipes() {
    const cmpItems = [];
    for (const pipe in completion_types_1.pipes) {
        const item = node_1.CompletionItem.create(pipe);
        const altItem = node_1.CompletionItem.create(completion_types_1.pipes[pipe].altLabel);
        item.kind = node_1.CompletionItemKind.Text;
        altItem.kind = node_1.CompletionItemKind.Text;
        item.documentation = completion_types_1.pipes[pipe].documentation;
        altItem.documentation = completion_types_1.pipes[pipe].documentation;
        altItem.insertText = completion_types_1.pipes[pipe].insertText;
        cmpItems.push(item);
        cmpItems.push(altItem);
    }
    return cmpItems;
}
function buildWildcards() {
    const cmpItems = [];
    for (const char in completion_types_1.WildcardItems) {
        const item = node_1.CompletionItem.create(char);
        item.documentation = (0, documentation_1.enrichWildcard)(char, completion_types_1.WildcardItems[char].documentation, completion_types_1.WildcardItems[char].examples);
        item.kind = completion_types_1.WildcardItems[char].kind;
        cmpItems.push(item);
    }
    return cmpItems;
}
function buildRegexCompletions() {
    const cmpItems = [];
    for (const regexItem of completion_types_1.stringRegexExpressions) {
        const item = node_1.CompletionItem.create(regexItem.label);
        item.documentation = regexItem.description;
        //item.insertTextFormat = InsertTextFormat.PlainText;
        item.insertText = regexItem.insertText;
        item.kind = node_1.CompletionItemKind.Text;
        cmpItems.push(item);
    }
    return cmpItems;
}
exports.buildRegexCompletions = buildRegexCompletions;
function buildDefaultCompletions() {
    const escChars = buildEscapeChars();
    const statusNumbers = buildStatusNumbers();
    const pipeObjs = buildPipes();
    const wildcards = buildWildcards();
    const cmpChars = [
        ...escChars,
        ...statusNumbers,
        ...pipeObjs,
        ...wildcards,
    ];
    return cmpChars;
}
exports.buildDefaultCompletions = buildDefaultCompletions;
//# sourceMappingURL=completion.js.map