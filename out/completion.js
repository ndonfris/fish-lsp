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
exports.Completion = exports.toCompletionItemKind = exports.FishCompletionItemType = void 0;
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
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
})(FishCompletionItemType = exports.FishCompletionItemType || (exports.FishCompletionItemType = {}));
function toCompletionItemKind(type) {
    switch (type) {
        case FishCompletionItemType.function:
            return vscode_languageserver_protocol_1.CompletionItemKind.Function;
        case FishCompletionItemType.builtin:
            return vscode_languageserver_protocol_1.CompletionItemKind.Function;
        case FishCompletionItemType.abbr:
            return vscode_languageserver_protocol_1.CompletionItemKind.Snippet;
        case FishCompletionItemType.flag:
            return vscode_languageserver_protocol_1.CompletionItemKind.Field;
        case FishCompletionItemType.variable:
            return vscode_languageserver_protocol_1.CompletionItemKind.Variable;
        default:
            return vscode_languageserver_protocol_1.CompletionItemKind.Unit;
    }
}
exports.toCompletionItemKind = toCompletionItemKind;
function buildCompletionItem(name, docs, type, filterText) {
    const itemKind = toCompletionItemKind(type);
    return Object.assign(Object.assign({}, vscode_languageserver_protocol_1.CompletionItem.create(name)), { documentation: docs, kind: itemKind, filterText: filterText || "", data: {
            name: name,
            documentation: docs,
            kind: itemKind,
            fishKind: type,
        } });
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
class Completion {
    constructor() {
        this.globalVariableList = [];
        this.abbrList = [];
        this.localVariablesList = [];
        this.localFunctions = [];
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
    initialDefaults() {
        return __awaiter(this, void 0, void 0, function* () {
            this.globalVariableList = yield buildGlobalVars();
            this.abbrList = yield buildGlobalAbbr();
        });
    }
    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    enrichCompletions() { }
    // probably need some of SyntaxTree class in this file
    generate(node) {
        return __awaiter(this, void 0, void 0, function* () {
            this.completions = [
                ...this.abbrList,
                ...this.globalVariableList,
            ];
            return vscode_languageserver_protocol_1.CompletionList.create(this.completions, this.isIncomplete);
        });
    }
}
exports.Completion = Completion;
function buildGlobalAbbr() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteAbbrs)();
        return globalVars
            .map((abbr) => abbr.split("--", 1)[1].trim())
            .map((abbr) => {
            const arr = abbr.split(" ", 1);
            const name = arr[0];
            const abbrReplaceText = arr[1];
            return buildCompletionItem(name, (0, documentation_1.enrichToMarkdown)("__abbreviation__: " + abbrReplaceText), FishCompletionItemType.abbr, abbrReplaceText);
        });
    });
}
function buildGlobalVars() {
    return __awaiter(this, void 0, void 0, function* () {
        const globalVars = yield (0, exec_1.execCompleteVariables)();
        return globalVars
            .map((gvar) => gvar.split("\t", 1))
            .map((arr) => {
            const name = arr[0];
            const descArr = arr[1].split(" ", 1);
            const docs = (0, documentation_1.enrichToMarkdown)(["__" + descArr[0] + "__ ", descArr[1]].join(" "));
            return buildCompletionItem(name, docs, FishCompletionItemType.variable);
        });
    });
}
function buildGlobalFunctions() {
    return __awaiter(this, void 0, void 0, function* () {
    });
}
//# sourceMappingURL=completion.js.map