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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGlobalAlaises = exports.buildGlobalCommands = exports.buildGlobalBuiltins = exports.buildGlobalVars = exports.buildGlobalAbbrs = exports.Completion = exports.toCompletionItemKind = exports.FishCompletionItemType = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const node_1 = require("vscode-languageserver-protocol/node");
const documentation_1 = require("./documentation");
const exec_1 = require("./utils/exec");
// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}
// PREVIOUS: https://github.com/ndonfris/fishls/blob/master/server/src/complete.ts
var FishCompletionItemType;
(function (FishCompletionItemType) {
    FishCompletionItemType[FishCompletionItemType["function"] = 0] = "function";
    FishCompletionItemType[FishCompletionItemType["builtin"] = 1] = "builtin";
    FishCompletionItemType[FishCompletionItemType["abbr"] = 2] = "abbr";
    FishCompletionItemType[FishCompletionItemType["flag"] = 3] = "flag";
    FishCompletionItemType[FishCompletionItemType["variable"] = 4] = "variable";
    FishCompletionItemType[FishCompletionItemType["line"] = 5] = "line";
})(FishCompletionItemType = exports.FishCompletionItemType || (exports.FishCompletionItemType = {}));
function toCompletionItemKind(type) {
    switch (type) {
        case FishCompletionItemType.function:
            return node_1.CompletionItemKind.Function;
        case FishCompletionItemType.builtin:
            return node_1.CompletionItemKind.Function;
        case FishCompletionItemType.abbr:
            return node_1.CompletionItemKind.Snippet;
        case FishCompletionItemType.flag:
            return node_1.CompletionItemKind.Field;
        case FishCompletionItemType.variable:
            return node_1.CompletionItemKind.Variable;
        default:
            return node_1.CompletionItemKind.Unit;
    }
}
exports.toCompletionItemKind = toCompletionItemKind;
function buildCompletionItem(name, detail, docs, type, insertText) {
    const itemKind = toCompletionItemKind(type);
    return Object.assign(Object.assign({}, node_1.CompletionItem.create(name)), { detail: detail, documentation: docs, kind: itemKind, insertText: insertText, filterText: itemKind === node_1.CompletionItemKind.Variable ? "$" : undefined, data: {
            name: name,
            documentation: docs,
            kind: itemKind,
            fishKind: type,
        } });
}
const execAsync = (0, util_1.promisify)(child_process_1.exec);
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
    constructor(filepathResolver) {
        this.lineCmps = [];
        this.globalAbbrs = [];
        this.globalVars = [];
        this.globalAlaises = [];
        this.globalCmds = [];
        this.globalBuiltins = [];
        this.localVariables = new Map();
        this.localFunctions = new Map();
        this.isInsideCompletionsFile = false;
        this.completions = [];
        this.isIncomplete = false;
        this.isIncomplete = false;
        this.completions = [];
        this.isInsideCompletionsFile = false;
        this.filepathResolver = filepathResolver;
    }
    // call in server.initialize()
    // also you could add the syntaxTree on
    // this.documents.listener.onDocumentChange(() => {})
    static initialDefaults(filepathResolver) {
        return __awaiter(this, void 0, void 0, function* () {
            const globs = new this(filepathResolver);
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
        });
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
    generateLineCmpNew(line) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = line.replace(/(['$`\\])/g, '\\$1');
            const res = yield execAsync(`fish --command "complete --do-complete='${cmd}' | uniq"`);
            const lines = res.stdout
                .split('\n')
                .filter(line => line.trim() !== "")
                .map(line => line.split('\t').map(l => l.trim()).join('\t'))
                .map(line => {
                const newLine = line.split('\t');
                if (newLine.length === 0) {
                    return ["", ""];
                }
                if (newLine.length === 1) {
                    return [newLine[0], ""];
                }
                return newLine;
            }).filter(line => (line !== undefined && line[0] !== undefined));
            this.lineCmps = yield Promise.all(lines.map((line) => __awaiter(this, void 0, void 0, function* () {
                return node_1.CompletionItem.create(line[0]);
            })));
            //this.lineCmps = await Promise.all(
            //    lines.map(async (arr: string[]) => {
            //        const [label, _desc] = [arr[0], ...arr[1]];
            //        const fishCmpType = parseLineForType(label, _desc)
            //        const item = 
            //            new CompletionItemBuilder()
            //            .create(label)
            //            .kind(fishCmpType)
            //        return item.build();
            //    }
            //))
            return this.lineCmps;
        });
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
    generate(node) {
        return __awaiter(this, void 0, void 0, function* () {
            this.completions = [
                ...this.lineCmps,
            ];
            return node_1.CompletionList.create(this.completions, this.isIncomplete);
        });
    }
    fallbackComplete() {
        this.completions = this.lineCmps;
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
function buildGlobalAbbrs() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalAbbrs = yield (0, exec_1.execCompleteGlobalDocs)('abbrs');
        const ret = globalAbbrs.split('\n')
            .map(abbr => abbr.split('\t'))
            .map((abbr) => buildCompletionItem(abbr[0].trim(), 'abbr', (0, documentation_1.enrichToMarkdown)("__Abbreviation__: " + abbr.at(-1)), FishCompletionItemType.abbr, abbr.at(-1)));
        return ret;
    });
}
exports.buildGlobalAbbrs = buildGlobalAbbrs;
function buildGlobalVars() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteGlobalDocs)('vars');
        const ret = globalVars.split('\n')
            .map(gvar => gvar.split("\t"))
            .map((arr) => buildCompletionItem("$" + arr[0], arr[1], (0, documentation_1.enrichToMarkdown)(arr.slice(1).join(': ') + '  '), FishCompletionItemType.variable, "$" + arr[0]));
        return ret;
    });
}
exports.buildGlobalVars = buildGlobalVars;
function buildGlobalBuiltins() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteGlobalDocs)('builtins');
        const ret = globalVars.split('\n')
            .map(gvar => gvar.split("\t"))
            .map((arr) => buildCompletionItem(arr[0], arr[1], arr[0], FishCompletionItemType.builtin));
        return ret;
    });
}
exports.buildGlobalBuiltins = buildGlobalBuiltins;
function buildGlobalCommands() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteGlobalDocs)('commands');
        const ret = globalVars.split('\n')
            .map(gvar => gvar.split("\t"))
            .map((arr) => buildCompletionItem(arr[0], arr[1], (0, documentation_1.enrichToMarkdown)("__command__: " + arr.at(0)), FishCompletionItemType.function));
        return ret;
    });
}
exports.buildGlobalCommands = buildGlobalCommands;
function buildGlobalAlaises() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteGlobalDocs)('aliases');
        const ret = globalVars.split('\n')
            .map(gvar => gvar.split("\t"))
            .map((arr) => buildCompletionItem(arr[0], arr[1], (0, documentation_1.enrichToMarkdown)(arr[1]), FishCompletionItemType.function));
        return ret;
    });
}
exports.buildGlobalAlaises = buildGlobalAlaises;
function findEachSubcommand(node) {
    return __awaiter(this, void 0, void 0, function* () {
        if (node.children.length == 1) {
            return [];
        }
        const children = node.children.slice(1);
        let text = [node.child(0).text];
        for (const child of children) {
            const childText = child.text;
            if (childText.startsWith("-")) {
                return text;
            }
            const subcmds = yield (0, exec_1.execFindSubcommand)(text);
            if (subcmds.length > 0) {
                const found = subcmds.filter(subcmd => subcmd == childText)[0];
                if (found) {
                    text.push(found);
                }
            }
        }
        return text;
    });
}
//# sourceMappingURL=completion.js.map