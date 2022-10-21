"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFishBuiltinComplete = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const completion_types_1 = require("./completion-types");
function parseDescriptionKeywords(cliText) {
    const secondItem = cliText.description.replace(':', '');
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
class CompletionItemCreator {
    serializeShellOutput(shellLines) {
        const cmp = {
            text: "",
            description: ""
        };
        cmp.text = shellLines[0];
        if (shellLines.length === 2) {
            cmp.description = shellLines[1];
        }
        return cmp;
    }
}
function createFishBuiltinComplete(arr) {
    const cmp = {
        text: "",
        description: ""
    };
    cmp.text = arr[0];
    if (arr.length === 2) {
        cmp.description = arr[1];
    }
    return cmp;
}
exports.createFishBuiltinComplete = createFishBuiltinComplete;
// CompletionItem is product
class CompletionItemBuilder {
    //private item: FishCompletionItem | undefined private cli: CmdLineCmp
    constructor(cli) {
        //this.item = FishCompletionItem.create()
        //this.
    }
}
class BaseCompletionItem {
    constructor(cli) {
        this.cli = cli;
        this.item = this.create(cli);
    }
    create(cli) {
        this.cli = cli;
        this.item = vscode_languageserver_1.CompletionItem.create(cli.text);
        this.item.label = cli.text;
        this.item.data.fishKind = completion_types_1.FishCompletionItemKind.RESOLVE;
        this.item.data.originalCompletion = [cli.text, cli.description].join('\t');
        return this.item;
    }
}
class LabelItems extends BaseCompletionItem {
    constructor(cli) {
        super(cli);
        // items that we determine their types from their label:
        // --long                                    --> flag 
        // $var                                      --> variables
        // usr_function_without_description          --> functions with no descriptions
        // while                                     --> builtins
        this.isSet = false;
    }
    parseLabel() {
        const toParse = this.cli.text;
        if (toParse.startsWith('$')) {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.GLOBAL_VAR;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Variable;
            this.isSet = true;
            return;
        }
        if (toParse.startsWith("-")) {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.FLAG;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Field;
            this.isSet = true;
            return;
        }
        if ((0, completion_types_1.isBuiltIn)(toParse)) {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.BUILTIN;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Keyword;
            this.isSet = true;
            return;
        }
    }
    parseDescription() {
        const desc = parseDescriptionKeywords(this.cli);
        if (this.cli.description === "") {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.GLOBAL_FUNC;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.File;
            this.isSet = true;
            return;
        }
        if (desc[0] === "command") {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.CMD;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Module;
            this.isSet = true;
            return;
        }
        if (desc[0] === "variable") {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.GLOBAL_VAR;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Variable;
            this.isSet = true;
            return;
        }
        if (desc[0] === "alias") {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.ALIAS;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Struct;
            this.isSet = true;
            return;
        }
        if (desc[0] === "abbreviation") {
            this.item.data.fishKind = completion_types_1.FishCompletionItemKind.ABBR;
            this.item.kind = vscode_languageserver_1.CompletionItemKind.Interface;
            this.isSet = true;
            return;
        }
    }
}
//# sourceMappingURL=completionItemFactory.js.map