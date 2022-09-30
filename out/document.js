"use strict";
/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.LspDocument = exports.LspDocuments = exports.FishFileType = void 0;
const LSP = __importStar(require("vscode-languageserver"));
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const io_1 = require("./utils/io");
const locations_1 = require("./utils/locations");
const path_1 = require("path");
var FishFileType;
(function (FishFileType) {
    FishFileType[FishFileType["function"] = 0] = "function";
    FishFileType[FishFileType["completion"] = 1] = "completion";
    FishFileType[FishFileType["script"] = 2] = "script";
    FishFileType[FishFileType["config"] = 3] = "config";
    FishFileType[FishFileType["builtin_function"] = 4] = "builtin_function";
    FishFileType[FishFileType["builtin_completion"] = 5] = "builtin_completion";
})(FishFileType = exports.FishFileType || (exports.FishFileType = {}));
class LspDocuments {
    //public dependencies: Map<string, SymbolInformation[]>;
    constructor(listener) {
        // consider changing to a map or an object with the keyof syntax
        this._files = [];
        this.openDocuments = new Map();
        this.listener = listener;
        this.documents = new Map();
        //this.dependencies = new Map<string, LspDocument[]>();
    }
    /**
     * gets the dependency for the the file/uri passed in
     *
     * @param {string} file - the file to find in the documents.
     * @returns {LspDocument | undefined} - the document found matching
     *                                      the uri if it exists
     */
    get(file) {
        const uri = file;
        const document = this.documents.get(uri);
        if (!document) {
            return undefined;
        }
        return document;
    }
    /**
     * normalizes a filepaths uri, and creates the textDocument. Also, sets the
     * dependencies for a newDocument.
     */
    newDocument(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            let document = yield (0, io_1.createTextDocumentFromFilePath)(uri);
            if (!document)
                return;
            if (this._files.includes(document.uri)) {
                return;
            }
            this.documents.set(uri, document);
            //this.dependencies.set(uri, [])
        });
    }
    //getDependencies(uri: string) {
    //    const deps = this.dependencies.get(uri)
    //    if (!deps) {
    //        return [] as LspDocument[]
    //    }
    //    return deps
    //}
    ///**
    // * add a new Dependency, to the document
    // * @param {string} uri - the uri that has a dependency
    // * @param {string} depUri - the uri that is the depency
    // */
    //public addDependency(uri: string, depUri: string) {
    //    const newDep = this.get(depUri);
    //    const oldDeps = this.getDependencies(uri)
    //    if (oldDeps.includes(depUri)) {
    //        return 
    //    }
    //    if (newDep && !oldDeps.includes(depUri)) {
    //        this.dependencies.set(uri, [...oldDeps, newDep]);
    //    }
    //}
    /**
     * return all the documents seen in the _files field
     */
    getOpenDocuments() {
        return [...this.openDocuments.values()];
    }
    /**
     * adds a new Uri to the _files array. Returns true if a document is opened
     * and false if a document is already opened
     */
    open(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.openDocuments.has(uri)) {
                return false;
            }
            if (!this.get(uri)) {
                yield this.newDocument(uri);
                const document = this.documents.get(uri);
                if (this.documents.has(uri) && document) {
                    this.openDocuments.set(uri, document);
                }
            }
            this._files.unshift(uri);
            return true;
        });
    }
    /**
     * deletes an item from the _files array, and returns the document
     */
    close(uri) {
        const document = this.openDocuments.get(uri);
        if (!document) {
            return undefined;
        }
        this._files.splice(this._files.indexOf(uri), 1);
        this.openDocuments.delete(uri);
        return document;
    }
}
exports.LspDocuments = LspDocuments;
class LspDocument {
    constructor(doc) {
        const { uri, languageId, version, text } = doc;
        this.document = vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, version, text);
        this.fishFileType = this.setFishFileType();
        this.matchingDependency = this.setMatchingDep();
    }
    get uri() {
        return this.document.uri;
    }
    get languageId() {
        return this.document.languageId;
    }
    get version() {
        return this.document.version;
    }
    getText(range) {
        return this.document.getText(range);
    }
    positionAt(offset) {
        return this.document.positionAt(offset);
    }
    offsetAt(position) {
        return this.document.offsetAt(position);
    }
    get lineCount() {
        return this.document.lineCount;
    }
    getLine(line) {
        const lineRange = this.getLineRange(line);
        return this.getText(lineRange);
    }
    getLineRange(line) {
        const lineStart = this.getLineStart(line);
        const lineEnd = this.getLineEnd(line);
        return LSP.Range.create(lineStart, lineEnd);
    }
    getLineEnd(line) {
        const nextLineOffset = this.getLineOffset(line + 1);
        return this.positionAt(nextLineOffset - 1);
    }
    getLineOffset(line) {
        const lineStart = this.getLineStart(line);
        return this.offsetAt(lineStart);
    }
    getLineStart(line) {
        return LSP.Position.create(line, 0);
    }
    getFileName() {
        return (0, path_1.basename)(this.document.uri);
    }
    /**
     * checks what type of fish file the current TextDocument is
     * from the uri path
     *
     * @returns {FishFileType} config, functions, completions or script
     */
    setFishFileType() {
        const filepath = this.uri;
        if (filepath.includes(locations_1.FISH_LOCATIONS.config.completions)) {
            return FishFileType.completion;
        }
        else if (filepath.includes(locations_1.FISH_LOCATIONS.config.functions)) {
            return FishFileType.function;
        }
        else if (filepath.includes(locations_1.FISH_LOCATIONS.configFile)) {
            return FishFileType.config;
        }
        else if (filepath.includes(locations_1.FISH_LOCATIONS.builtins.functions)) {
            return FishFileType.builtin_function;
        }
        else if (filepath.includes(locations_1.FISH_LOCATIONS.builtins.completions)) {
            return FishFileType.builtin_completion;
        }
        else {
            return FishFileType.script;
        }
    }
    setMatchingDep() {
        let dependency = '';
        let dep_file = '';
        switch (this.fishFileType) {
            case FishFileType.completion:
                dep_file = (0, path_1.resolve)(locations_1.FISH_LOCATIONS.config.functions, dependency);
                break;
            case FishFileType.builtin_completion:
                dep_file = (0, path_1.resolve)(locations_1.FISH_LOCATIONS.builtins.functions, dependency);
                break;
            case FishFileType.function:
                dep_file = (0, path_1.resolve)(locations_1.FISH_LOCATIONS.config.completions, dependency);
                break;
            case FishFileType.builtin_function:
                dep_file = (0, path_1.resolve)(locations_1.FISH_LOCATIONS.builtins.completions, dependency);
                break;
            default:
                dep_file = '';
                break;
        }
        return dep_file + path_1.sep + this.getFileName();
    }
    getFishFileType() {
        return this.fishFileType;
    }
    getMatchingDep() {
        return this.matchingDependency;
    }
    applyEdit(version, change) {
        const content = this.getText();
        let newContent = change.text;
        if (LSP.TextDocumentContentChangeEvent.isIncremental(change)) {
            const start = this.offsetAt(change.range.start);
            const end = this.offsetAt(change.range.end);
            newContent = content.substring(0, start) + change.text + content.substring(end);
        }
        this.document = vscode_languageserver_textdocument_1.TextDocument.create(this.uri, this.languageId, version, newContent);
    }
}
exports.LspDocument = LspDocument;
//export class LspDocuments {
//    private readonly _files: string[] = [];
//    private readonly documents = new Map<string, LspDocument>();
//
//    /**
//     * Sorted by last access.
//     */
//    get files(): string[] {
//        return this._files;
//    }
//
//    get(file: string): LspDocument | undefined {
//        const document = this.documents.get(file);
//        if (!document) {
//            return undefined;
//        }
//        if (this.files[0] !== file) {
//            this._files.splice(this._files.indexOf(file), 1);
//            this._files.unshift(file);
//        }
//        return document;
//    }
//
//    open(file: string, doc: LSP.TextDocumentItem): boolean {
//        if (this.documents.has(file)) {
//            return false;
//        }
//        this.documents.set(file, new LspDocument(doc));
//        this._files.unshift(file);
//        return true;
//    }
//
//    close(file: string): LspDocument | undefined {
//        const document = this.documents.get(file);
//        if (!document) {
//            return undefined;
//        }
//        this.documents.delete(file);
//        this._files.splice(this._files.indexOf(file), 1);
//        return document;
//    }
//}
//# sourceMappingURL=document.js.map