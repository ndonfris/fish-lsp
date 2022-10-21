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
    [completion_types_1.FishCompletionItemKind.CMD_NO_DOC]: vscode_languageserver_1.CompletionItemKind.Class,
    [completion_types_1.FishCompletionItemKind.RESOLVE]: vscode_languageserver_1.CompletionItemKind.Unit // unit
};
class CompletionItemBuilder {
    constructor() {
        this._item = null;
    }
    get item() {
        if (!this._item) {
            this._item = {
                label: "",
                description: "",
                data: {
                    localSymbol: false,
                    originalCompletion: "",
                    fishKind: completion_types_1.FishCompletionItemKind.RESOLVE,
                }
            };
            return this._item;
        }
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
        this.item.kind = exports.toCompletionKind[fishKind];
        this.item.data.fishKind = fishKind;
        return this;
    }
    documentation(docs) {
        this.item.documentation = docs;
    }
    originalCompletion(shellText) {
        this.item.data.originalCompletion = shellText;
    }
    commitCharacters(chars) {
        this.item.commitCharacters = chars;
    }
    insertText(textToInsert) {
        this.item.insertText = textToInsert;
    }
    localSymbol() {
        this.item.data.localSymbol = true;
    }
    build() {
        return this.item;
    }
}
exports.CompletionItemBuilder = CompletionItemBuilder;
function parseDescriptionKeywords(...description) {
    const secondItem = description[0].replace(':', '');
    let results = [];
    if (secondItem === "") {
        return [""];
    }
    else {
        if (secondItem.includes(' ')) {
            results = secondItem.split(' ', 2);
            return [results[0].toLowerCase(), ...results.slice(1)];
        }
        else {
            return [secondItem];
        }
    }
}
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
function parseLineForType(label, ...documentation) {
    let tokenType = getTypeFromLabel(label);
    if (tokenType == null) {
        const keywordsArray = parseDescriptionKeywords(...documentation);
        tokenType = getTypeFromDocumentation(...keywordsArray);
    }
    return tokenType;
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
function getTypeFromDocumentation(keyword, ...otherInfo) {
    switch (keyword) {
        case 'command':
            return otherInfo.length >= 1 ? completion_types_1.FishCompletionItemKind.CMD_NO_DOC : completion_types_1.FishCompletionItemKind.CMD;
        case 'alias':
            return completion_types_1.FishCompletionItemKind.ALIAS;
        case 'abbreviation':
            return completion_types_1.FishCompletionItemKind.ABBR;
        default:
            return (0, completion_types_1.isGlobalFunction)() ? completion_types_1.FishCompletionItemKind.GLOBAL_FUNC : completion_types_1.FishCompletionItemKind.USER_FUNC;
    }
}
//# sourceMappingURL=completionBuilder.js.map