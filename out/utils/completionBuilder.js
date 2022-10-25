"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLineForType = exports.CompletionItemBuilder = exports.toCompletionKind = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const completion_types_1 = require("./completion-types");
exports.toCompletionKind = {
    [completion_types_1.FishCompletionItemKind.ABBR]: vscode_languageserver_1.CompletionItemKind.Interface,
    [completion_types_1.FishCompletionItemKind.ALIAS]: vscode_languageserver_1.CompletionItemKind.Struct,
    [completion_types_1.FishCompletionItemKind.BUILTIN]: vscode_languageserver_1.CompletionItemKind.Keyword,
    [completion_types_1.FishCompletionItemKind.GLOBAL_VAR]: vscode_languageserver_1.CompletionItemKind.Constant,
    [completion_types_1.FishCompletionItemKind.LOCAL_VAR]: vscode_languageserver_1.CompletionItemKind.Variable,
    [completion_types_1.FishCompletionItemKind.USER_FUNC]: vscode_languageserver_1.CompletionItemKind.Function,
    [completion_types_1.FishCompletionItemKind.GLOBAL_FUNC]: vscode_languageserver_1.CompletionItemKind.Method,
    [completion_types_1.FishCompletionItemKind.LOCAL_FUNC]: vscode_languageserver_1.CompletionItemKind.Constructor,
    [completion_types_1.FishCompletionItemKind.FLAG]: vscode_languageserver_1.CompletionItemKind.Field,
    [completion_types_1.FishCompletionItemKind.CMD]: vscode_languageserver_1.CompletionItemKind.Class,
    [completion_types_1.FishCompletionItemKind.CMD_NO_DOC]: vscode_languageserver_1.CompletionItemKind.Unit,
    [completion_types_1.FishCompletionItemKind.RESOLVE]: vscode_languageserver_1.CompletionItemKind.Unit // unit
};
class CompletionItemBuilder {
    constructor() {
        this._item = {};
        this._item.label = "";
        this._item.kind = 1;
        this._item.documentation = "";
        this._item.data = {
            localSymbol: false,
            originalCompletion: "",
            fishKind: completion_types_1.FishCompletionItemKind.RESOLVE,
        };
    }
    reset() {
        this._item = {};
        this._item.label = "";
        this._item.kind = 1;
        this._item.documentation = "";
        this._item.data = {
            localSymbol: false,
            originalCompletion: "",
            fishKind: completion_types_1.FishCompletionItemKind.RESOLVE,
        };
    }
    set item(arg) {
        this._item = arg;
    }
    get item() {
        return this._item;
    }
    create(label) {
        this._item = vscode_languageserver_1.CompletionItem.create(label);
        this._item.data = {
            originalCompletion: "",
            fishKind: completion_types_1.FishCompletionItemKind.RESOLVE,
            localSymbol: false
        };
        return this;
    }
    kind(fishKind) {
        this._item.kind = exports.toCompletionKind[fishKind];
        this._item.data.fishKind = fishKind;
        return this;
    }
    documentation(docs) {
        this._item.documentation = docs;
        return this;
    }
    originalCompletion(shellText) {
        this._item.data.originalCompletion = shellText;
        return this;
    }
    commitCharacters(chars) {
        this._item.commitCharacters = chars;
        return this;
    }
    insertText(textToInsert) {
        this._item.insertText = textToInsert;
        return this;
    }
    localSymbol() {
        this._item.data.localSymbol = true;
        return this;
    }
    build() {
        return this._item;
    }
}
exports.CompletionItemBuilder = CompletionItemBuilder;
// fish --command 'complete --do-complete="somecmd"'
// yeilds completions of result: 
//     cmp1\tdescription
//     cmp2
//     cmp3\tdescription
// where completions are split by tab characters, and descriptions are optional.
/**
 * Retrieves a FishCompletionItemKind for a line of shell output.
 * Input params can be typed by the exported type TerminalCompletionOutput
 * @see TerminalTCompletionOutput
 *
 * @param {string} label - the label we should use for a completion
 * @param {string[]} documentation - the documentation for a completion which might not
 *                                   have been written.
 * @returns {FishCompletionItemKind} - enum used to determine what type of completion to
 *                                     build.
 */
function parseLineForType(label, keyword, otherInfo) {
    let labelType = getTypeFromLabel(label);
    let docType = getTypeFromDocumentation(keyword, otherInfo);
    return labelType !== null ? labelType : docType;
}
exports.parseLineForType = parseLineForType;
function getTypeFromLabel(label) {
    const firstChar = label.charAt(0);
    switch (firstChar) {
        case '-':
            return completion_types_1.FishCompletionItemKind.FLAG;
        case '$':
            return completion_types_1.FishCompletionItemKind.GLOBAL_VAR;
        default:
            return (0, completion_types_1.isBuiltIn)(label) ? completion_types_1.FishCompletionItemKind.BUILTIN : null;
    }
}
function getTypeFromDocumentation(keyword, otherInfo) {
    //console.log(otherInfo)
    switch (keyword) {
        case 'command':
            return otherInfo.length >= 1 ? completion_types_1.FishCompletionItemKind.CMD_NO_DOC : completion_types_1.FishCompletionItemKind.CMD;
        case 'variable':
            //return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.USER_FUNC
            return completion_types_1.FishCompletionItemKind.GLOBAL_VAR;
        case 'alias':
            return completion_types_1.FishCompletionItemKind.ALIAS;
        case 'abbreviation':
            return completion_types_1.FishCompletionItemKind.ABBR;
        default:
            //return isGlobalFunction() ?  FishCompletionItemKind.GLOBAL_FUNC : FishCompletionItemKind.RESOLVE
            return completion_types_1.FishCompletionItemKind.GLOBAL_FUNC;
    }
}
//# sourceMappingURL=completionBuilder.js.map