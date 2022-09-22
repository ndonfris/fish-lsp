/*
 * Copyright (C) 2017, 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as LSP from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

export enum FishFileType {
    function,
    completion,
    script,
    config,
}

export class LspDocument implements TextDocument {

    protected document: TextDocument;

    constructor(doc: LSP.TextDocumentItem) {
        const { uri, languageId, version, text } = doc;
        this.document = TextDocument.create(uri, languageId, version, text);
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

    /**
     * checks what type of fish file the current TextDocument is 
     * from the uri path 
     * 
     * @returns {FishFileType} config, functions, completions or script
     */
    getFishFileType(): FishFileType {
        const filepath = this.uri.split('/');
        if (filepath[-1] === 'config.fish') {
            return FishFileType.config;
        } else if (filepath[-2] === 'functions') {
            return FishFileType.function;
        } else if (filepath[-2] === 'completions') {
            return FishFileType.completion;
        } else {
            return FishFileType.script;
        }
    }

    applyEdit(version: number, change: LSP.TextDocumentContentChangeEvent): void {
        const content = this.getText();
        let newContent = change.text;
        if (LSP.TextDocumentContentChangeEvent.isIncremental(change)) {
            const start = this.offsetAt(change.range.start);
            const end = this.offsetAt(change.range.end);
            newContent = content.substr(0, start) + change.text + content.substring(end);
        }
        this.document = TextDocument.create(this.uri, this.languageId, version, newContent);
    }
}

export class LspDocuments {
    private readonly _files: string[] = [];
    private readonly documents = new Map<string, LspDocument>();

    /**
     * Sorted by last access.
     */
    get files(): string[] {
        return this._files;
    }

    get(file: string): LspDocument | undefined {
        const document = this.documents.get(file);
        if (!document) {
            return undefined;
        }
        if (this.files[0] !== file) {
            this._files.splice(this._files.indexOf(file), 1);
            this._files.unshift(file);
        }
        return document;
    }

    open(file: string, doc: LSP.TextDocumentItem): boolean {
        if (this.documents.has(file)) {
            return false;
        }
        this.documents.set(file, new LspDocument(doc));
        this._files.unshift(file);
        return true;
    }

    close(file: string): LspDocument | undefined {
        const document = this.documents.get(file);
        if (!document) {
            return undefined;
        }
        this.documents.delete(file);
        this._files.splice(this._files.indexOf(file), 1);
        return document;
    }
}
