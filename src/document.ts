/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as LSP from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createTextDocumentFromFilePath } from './utils/io';
import { FISH_LOCATIONS } from './utils/locations';
import {basename, resolve, sep} from 'path';
import { TextDocuments } from 'vscode-languageserver'

export enum FishFileType {
    function,
    completion,
    script,
    config,
    builtin_function,
    builtin_completion,
}

//export class LspDocuments {
//
//    // consider changing to a map or an object with the keyof syntax
//    private readonly _files: string[] = [];
//
//    // use TextDocuments 
//    private readonly openDocuments: Map<string, LspDocument>;
//
//    public listener: TextDocuments<TextDocument>;
//
//    public documents: Map<string, TextDocument>;
//    //public dependencies: Map<string, SymbolInformation[]>;
//
//    constructor(listener: LSP.TextDocuments<TextDocument>) {
//        this.openDocuments = new Map<string, LspDocument>();
//        this.listener = listener;
//        this.documents = new Map<string, TextDocument>();
//        //this.dependencies = new Map<string, LspDocument[]>();
//    }
//
//    /**
//     * gets the dependency for the the file/uri passed in
//     *
//     * @param {string} file - the file to find in the documents.
//     * @returns {LspDocument | undefined} - the document found matching 
//     *                                      the uri if it exists
//     */
//    get(file: string): LspDocument | undefined {
//        const uri = file
//        const document = this.openDocuments.get(uri);
//        if (!document) {
//            return undefined;
//        }
//        return document;
//    }                
//
//    /**
//     * normalizes a filepaths uri, and creates the textDocument. Also, sets the
//     * dependencies for a newDocument.
//     */
//    async newDocument(uri: string) {
//        let document = await createTextDocumentFromFilePath(uri)
//        if (!document) return;
//        if (this._files.includes(document.uri)) {
//            return
//        }
//        this.documents.set(uri, document)
//        //this.dependencies.set(uri, [])
//    }
//
//    //getDependencies(uri: string) {
//    //    const deps = this.dependencies.get(uri)
//    //    if (!deps) {
//    //        return [] as LspDocument[]
//    //    }
//    //    return deps
//    //}
//
//    ///**
//    // * add a new Dependency, to the document
//    // * @param {string} uri - the uri that has a dependency
//    // * @param {string} depUri - the uri that is the depency
//    // */
//    //public addDependency(uri: string, depUri: string) {
//    //    const newDep = this.get(depUri);
//    //    const oldDeps = this.getDependencies(uri)
//    //    if (oldDeps.includes(depUri)) {
//    //        return 
//    //    }
//    //    if (newDep && !oldDeps.includes(depUri)) {
//    //        this.dependencies.set(uri, [...oldDeps, newDep]);
//    //    }
//    //}
//
//
//    /**
//     * return all the documents seen in the _files field
//     */
//    getOpenDocuments(): LspDocument[] {
//        return [...this.openDocuments.values()];
//    }
//
//    /**
//     * adds a new Uri to the _files array. Returns true if a document is opened
//     * and false if a document is already opened
//     */
//    async open(uri: string): Promise<boolean> {
//        if (this.openDocuments.has(uri)) {
//            return false;
//        }
//        if (!this.get(uri)) {
//            await this.newDocument(uri)
//            const document = this.documents.get(uri)
//            if (this.documents.has(uri) && document) {
//                this.openDocuments.set(uri, document)
//            }
//        }
//        this._files.unshift(uri);
//        return true;
//    }
//
//    /**
//     * deletes an item from the _files array, and returns the document
//     */
//    close(uri: string): LspDocument | undefined {
//        const document = this.openDocuments.get(uri);
//        if (!document) {
//            return undefined;
//        }
//        this._files.splice(this._files.indexOf(uri), 1)
//        this.openDocuments.delete(uri);
//        return document;
//    }
//}

export class LspDocument implements TextDocument {

    protected document: TextDocument;

    private matchingDependency: string;
    private fishFileType: FishFileType;

    constructor(doc: TextDocument) {
        const { uri, languageId, version } = doc;
        this.document = TextDocument.create(uri, languageId, version, doc.getText());
        this.fishFileType = this.setFishFileType()
        this.matchingDependency = this.setMatchingDep();
    }

    get uri(): string {
        return this.document.uri;
    }

    get languageId(): string {
        return this.document.languageId;
    }

    get version(): number {
        return this.document.version;
    }

    getText(range?: LSP.Range): string {
        return this.document.getText(range);
    }

    positionAt(offset: number): LSP.Position {
        return this.document.positionAt(offset);
    }

    offsetAt(position: LSP.Position): number {
        return this.document.offsetAt(position);
    }

    get lineCount(): number {
        return this.document.lineCount;
    }

    getLine(line: number): string {
        const lineRange = this.getLineRange(line);
        return this.getText(lineRange);
    }

    getLineRange(line: number): LSP.Range {
        const lineStart = this.getLineStart(line);
        const lineEnd = this.getLineEnd(line);
        return LSP.Range.create(lineStart, lineEnd);
    }

    getLineEnd(line: number): LSP.Position {
        const nextLineOffset = this.getLineOffset(line + 1);
        return this.positionAt(nextLineOffset - 1);
    }

    getLineOffset(line: number): number {
        const lineStart = this.getLineStart(line);
        return this.offsetAt(lineStart);
    }

    getLineStart(line: number): LSP.Position {
        return LSP.Position.create(line, 0);
    }

    getFileName() {
        return basename(this.document.uri);
    }

    /**
     * checks what type of fish file the current TextDocument is 
     * from the uri path 
     * 
     * @returns {FishFileType} config, functions, completions or script
     */
    setFishFileType(): FishFileType {
        const filepath = this.uri
        if (filepath.includes(FISH_LOCATIONS.config.completions)) {
            return FishFileType.completion;
        } else if (filepath.includes(FISH_LOCATIONS.config.functions)) {
            return FishFileType.function
        } else if (filepath.includes(FISH_LOCATIONS.configFile)) {
            return FishFileType.config
        } else if (filepath.includes(FISH_LOCATIONS.builtins.functions)) {
            return FishFileType.builtin_function
        } else if (filepath.includes(FISH_LOCATIONS.builtins.completions)) {
            return FishFileType.builtin_completion
        } else  {
            return FishFileType.script
        }
    }

    setMatchingDep(): string {
        let dependency = ''
        let dep_file = ''
        switch(this.fishFileType) {
        case FishFileType.completion:
            dep_file = resolve(FISH_LOCATIONS.config.functions, dependency)
            break;
        case FishFileType.builtin_completion:
            dep_file = resolve(FISH_LOCATIONS.builtins.functions, dependency)
            break;
        case FishFileType.function:
            dep_file = resolve(FISH_LOCATIONS.config.completions, dependency)
            break;
        case FishFileType.builtin_function:
            dep_file = resolve(FISH_LOCATIONS.builtins.completions, dependency)
            break;
        default:
            dep_file = ''
            break;
        }
        return dep_file + sep + this.getFileName()

    }

    getFishFileType() : FishFileType {
        return this.fishFileType
    }

    getMatchingDep() : string {
        return this.matchingDependency
    }

    applyEdit(version: number, change: LSP.TextDocumentContentChangeEvent): void {
        const content = this.getText();
        let newContent = change.text;
        if (LSP.TextDocumentContentChangeEvent.isIncremental(change)) {
            const start = this.offsetAt(change.range.start);
            const end = this.offsetAt(change.range.end);
            newContent = content.substring(0, start) + change.text + content.substring(end);
        }
        this.document = TextDocument.create(this.uri, this.languageId, version, newContent);
    }
}

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
