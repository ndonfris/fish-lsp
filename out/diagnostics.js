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
exports.getSymbolKind = exports.FishSymbol = exports.FishDiagnostics = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
//import {LspDocuments} from './document';
const builtins_1 = require("./utils/builtins");
const exec_1 = require("./utils/exec");
const node_types_1 = require("./utils/node-types");
const tree_sitter_1 = require("./utils/tree-sitter");
// subclass of analyzer
// should map getRange to syntaxNodes,
// can you some of the implementations for server.onHover()
//  • implements refrences
//  • implements workspace diagnostics for server.onContentChanged()
//  • implements inlay hints
//  • implements goto defeinition?
//  • implements rename?
//  • implements signature
// PROBS GO LOOK AT TSSERVER
// simple diagnostic example: https://github.com/microsoft/vscode-extension-samples/blob/main/diagnostic-related-information-sample/src/extension.ts
// 1.) get all locations
// after completing this file, add commands.ts
// use script to retrieve filelocation if exists.
class FishDiagnostics {
    //private tree: SyntaxTree;
    //private uri: string;
    constructor() {
        //this.uri = uri
        //this.tree = tree;
        this.locations = [];
        this.symbols = new Map();
        // this.diagnostics = diagnostics
        // this.documentSymbols = documentSymbols
        // this.inlayHints = inlayHits
        // this.defintions = definitions
        // this.semanticTokens = semanticTokens
        // this.signature = signature
    }
    //
    // TODO: ...stuff...
    //
    initializeLocations(uri, tree) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const func of tree.functions) {
                this.locations.push(vscode_languageserver_1.Location.create(uri, (0, tree_sitter_1.getRange)(func)));
            }
            for (const variable of tree.variable_definitions) {
                this.locations.push(vscode_languageserver_1.Location.create(uri, (0, tree_sitter_1.getRange)(variable)));
            }
            for (const cmd of tree.commands) {
                const cmdDep = yield (0, exec_1.execFindDependency)(cmd.child(0).text);
            }
        });
    }
}
exports.FishDiagnostics = FishDiagnostics;
// might be better to just create on the fly, and only show inlayHints for current document
// tldr signature would be nice
class FishSymbol {
    constructor(name, node, uri, containerName) {
        this.refrences = [];
        this.children = [];
        this.name = name;
        this.kind = getSymbolKind(node);
        this.range = (0, tree_sitter_1.getRange)(node);
        this.uri = uri;
        const possibleParent = (0, node_types_1.findFunctionScope)(node);
        if (containerName != "") {
            this.containerName = containerName;
        }
        else if (possibleParent) {
            this.containerName = possibleParent.child(1).text;
        }
        this.location = vscode_languageserver_1.Location.create(uri, this.range);
        this.symbolInfo = vscode_languageserver_1.SymbolInformation.create(this.name, this.kind, this.range, this.uri, this.containerName);
    }
    getName() {
        return this.name;
    }
    getUri() {
        return this.uri;
    }
    getSymbolInfo() {
        return this.symbolInfo;
    }
    addChild(node) {
        const child = new FishSymbol(this.name, node, this.uri, this.name);
        this.children.push(child);
    }
    getLocalLocations() {
        const locations = [];
        for (const child of this.children.values()) {
            locations.push(child.location);
        }
        return locations;
    }
    addRefrence(uri, node) {
        this.refrences.push(vscode_languageserver_1.Location.create(uri, (0, tree_sitter_1.getRange)(node)));
    }
    getGlobalLocations() {
        return this.refrences;
    }
    getAllLocations() {
        return [
            ...this.refrences,
            ...this.children.map(child => child.location)
        ];
    }
    getRefrenceCount() {
        return this.getAllLocations().length;
    }
    getDefinintion() {
        return this.location;
    }
}
exports.FishSymbol = FishSymbol;
//export function buildSymbol(tree: SyntaxTree, documents: LspDocuments) {
//    
//
//}
//
function getSymbolKind(node) {
    var _a;
    if ((0, node_types_1.isVariable)(node)) {
        return vscode_languageserver_1.SymbolKind.Variable;
    }
    else if ((0, node_types_1.isFunctionDefinintion)(node)) {
        return vscode_languageserver_1.SymbolKind.Function;
    }
    else if ((0, node_types_1.isStatement)(node)) {
        return vscode_languageserver_1.SymbolKind.Namespace;
    }
    else if ((0, node_types_1.isCommand)(node)) {
        const text = (_a = node.child(0)) === null || _a === void 0 ? void 0 : _a.text;
        if (text && (0, builtins_1.isBuiltin)(text)) {
            return vscode_languageserver_1.SymbolKind.Struct;
        }
        return vscode_languageserver_1.SymbolKind.File;
    }
    else if ((0, node_types_1.isBeforeCommand)(node)) {
        return vscode_languageserver_1.SymbolKind.Interface;
    }
    else {
        return vscode_languageserver_1.SymbolKind.Field;
    }
}
exports.getSymbolKind = getSymbolKind;
//
//  goto defintion
//      • goto defintion
//
//  goto refrences
//      • goto refrences
//
//  goto
//      • goto refrences
//
// signature help:
//      • show manpage/tldr
//
// include code-actions here?
// include formatter here?
//
// Possible code-actions/commands:
//      • refactor to private function
//      • run subcommand
//      • execute current line
//      • goto manpage
//      • /usr/share/fish
//      • use fallback documentation provider
//      • install fallback documentation provider (tldr)
//      • goto config.fish
//      • enable --help completions in .config/fish/completions/*.fish
//      • search in history?
//      •
//
//
//# sourceMappingURL=diagnostics.js.map