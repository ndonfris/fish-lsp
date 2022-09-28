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
exports.Completion = void 0;
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
// utils create CompletionResolver and CompletionItems
// also decide which completion icons each item will have
// try to get clean implementation of {...CompletionItem.create(), item: desc}
// • include pipe completions
// • include escape character completions
// • 
// • 
class Completion {
    constructor() {
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
            this.globalVariableList = [];
            this.abbrList = [];
        });
    }
    // here you build the completion data per type
    // call enrichCompletions on new this.completions
    // therefore you probably want to add the defaults (abbr & global variable list)
    // after this.completions is enriched
    enrichCompletions() {
    }
    // probably need some of SyntaxTree class in this file
    generate() {
        return __awaiter(this, void 0, void 0, function* () {
            return vscode_languageserver_protocol_1.CompletionList.create(this.completions, this.isIncomplete);
        });
    }
}
exports.Completion = Completion;
//# sourceMappingURL=completion.js.map