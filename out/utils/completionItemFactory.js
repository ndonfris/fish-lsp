"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completion_types_1 = require("./completion-types");
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
class CompletionItemFactory {
    constructor(local = false) {
        this.isLocal = local;
    }
    parseLine(label, ...documentation) {
        // parse the first 
        if (label.startsWith('-')) {
            return completion_types_1.FishCompletionItemKind.LOCAL_VAR;
        }
        if (label.startsWith('$')) {
            return completion_types_1.FishCompletionItemKind.GLOBAL_VAR;
        }
        if ((0, completion_types_1.isBuiltIn)(label)) {
            return completion_types_1.FishCompletionItemKind.BUILTIN;
        }
        if (documentation.length === 0) {
            return completion_types_1.FishCompletionItemKind.GLOBAL_FUNC;
        }
        const keywordsArray = parseDescriptionKeywords(...documentation);
        //parseKeywordsArray
    }
}
///class LabelItems extends BaseCompletionItem {
//    // items that we determine their types from their label:
//    // --long                                    --> flag 
//    // $var                                      --> variables
//    // usr_function_without_description          --> functions with no descriptions
//    // while                                     --> builtins
//
//    private isSet: boolean = false;
//
//    constructor(cli: CmdLineCmp) {
//        super(cli)
//
//    }
//
//    parseLabel() {
//        const toParse = this.cli.text;
//        
//        if (toParse.startsWith('$')) {
//            this.item.data.fishKind = FishCompletionItemKind.GLOBAL_VAR
//            this.item.kind = CompletionItemKind.Variable
//            this.isSet = true;
//            return;
//        }
//        if (toParse.startsWith("-")) {
//            this.item.data.fishKind = FishCompletionItemKind.FLAG
//            this.item.kind = CompletionItemKind.Field
//            this.isSet = true;
//            return;
//        }
//        if (isBuiltIn(toParse)) {
//            this.item.data.fishKind = FishCompletionItemKind.BUILTIN
//            this.item.kind = CompletionItemKind.Keyword
//            this.isSet = true;
//            return;
//        }
//
//
//    }
//
//
//    parseDescription() {
//        const desc = parseDescriptionKeywords(this.cli); 
//        if (this.cli.description === "") {
//            this.item.data.fishKind = FishCompletionItemKind.GLOBAL_FUNC
//            this.item.kind = CompletionItemKind.File
//            this.isSet = true;
//            return;
//        }
//        if (desc[0] === "command") {
//            this.item.data.fishKind = FishCompletionItemKind.CMD;
//            this.item.kind = CompletionItemKind.Module
//            this.isSet = true;
//            return
//        }
//        if (desc[0] === "variable") {
//            this.item.data.fishKind = FishCompletionItemKind.GLOBAL_VAR
//            this.item.kind = CompletionItemKind.Variable
//            this.isSet = true;
//            return
//        }
//        if (desc[0] === "alias") {
//            this.item.data.fishKind = FishCompletionItemKind.ALIAS
//            this.item.kind = CompletionItemKind.Struct
//            this.isSet = true;
//            return
//        }
//        if (desc[0] === "abbreviation") {
//            this.item.data.fishKind = FishCompletionItemKind.ABBR;
//            this.item.kind = CompletionItemKind.Interface
//            this.isSet = true;
//            return
//        }
//
//    }
//
//
//
//}
//# sourceMappingURL=completionItemFactory.js.map