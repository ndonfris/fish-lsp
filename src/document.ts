import { promises as fs } from 'fs';
import { DocumentUri, TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, TextDocumentItem, TextDocumentContentChangeEvent } from 'vscode-languageserver';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { homedir } from 'os';
import { AutoloadType, uriToPath } from './utils/translation';
import { Workspace, workspaces } from './utils/workspace';

export class LspDocument implements TextDocument {
  protected document: TextDocument;

  constructor(doc: TextDocumentItem) {
    const { uri, languageId, version, text } = doc;
    this.document = TextDocument.create(uri, languageId, version, text);
  }
  static createTextDocumentItem(uri: string, text: string): LspDocument {
    return new LspDocument({
      uri,
      languageId: 'fish',
      version: 1,
      text,
    });
  }

  static fromTextDocument(doc: TextDocument): LspDocument {
    const item = TextDocumentItem.create(doc.uri, doc.languageId, doc.version, doc.getText());
    return new LspDocument(item);
  }

  asTextDocumentItem(): TextDocumentItem {
    return {
      uri: this.document.uri,
      languageId: this.document.languageId,
      version: this.document.version,
      text: this.document.getText(),
    };
  }

  get uri(): DocumentUri {
    return this.document.uri;
  }

  get languageId(): string {
    return this.document.languageId;
  }

  get version(): number {
    return this.document.version;
  }

  getText(range?: Range): string {
    return this.document.getText(range);
  }

  positionAt(offset: number): Position {
    return this.document.positionAt(offset);
  }

  offsetAt(position: Position): number {
    return this.document.offsetAt(position);
  }

  get lineCount(): number {
    return this.document.lineCount;
  }

  create(uri: string, languageId: string, version: number, text: string): LspDocument {
    return new LspDocument({
      uri,
      languageId: languageId || 'fish',
      version: version || 1,
      text,
    });
  }

  update(changes: TextDocumentContentChangeEvent[]): void {
    this.document = TextDocument.update(this.document, changes, this.version);
  }

  /**
   * @see getLineBeforeCursor()
   */
  getLine(line: number): string {
    const lineRange = this.getLineRange(line);
    return this.getText(lineRange);
  }

  getLineBeforeCursor(position: Position): string {
    const lineStart = Position.create(position.line, 0);
    const lineEnd = Position.create(position.line, position.character);
    const lineRange = Range.create(lineStart, lineEnd);
    return this.getText(lineRange);
  }

  getLineRange(line: number): Range {
    const lineStart = this.getLineStart(line);
    const lineEnd = this.getLineEnd(line);
    return Range.create(lineStart, lineEnd);
  }

  getLineEnd(line: number): Position {
    const nextLineOffset = this.getLineOffset(line + 1);
    return this.positionAt(nextLineOffset - 1);
  }

  getLineOffset(line: number): number {
    const lineStart = this.getLineStart(line);
    return this.offsetAt(lineStart);
  }

  getLineStart(line: number): Position {
    return Position.create(line, 0);
  }

  getIndentAtLine(line: number): string {
    const lineText = this.getLine(line);
    const indent = lineText.match(/^\s+/);
    return indent ? indent[0] : '';
  }

  applyEdits(version: number, ...changes: TextDocumentContentChangeEvent[]): void {
    for (const change of changes) {
      const content = this.getText();
      let newContent = change.text;
      if (TextDocumentContentChangeEvent.isIncremental(change)) {
        const start = this.offsetAt(change.range.start);
        const end = this.offsetAt(change.range.end);
        newContent = content.substring(0, start) + change.text + content.substring(end);
      }
      this.document = TextDocument.create(this.uri, this.languageId, version, newContent);
    }
  }

  rename(newUri: string): void {
    this.document = TextDocument.create(newUri, this.languageId, this.version, this.getText());
  }

  getFilePath(): string | undefined {
    return uriToPath(this.uri);
  }

  getFilename(): string {
    return this.uri.split('/').pop() as string;
  }

  getRelativeFilenameToWorkspace(): string {
    const home = homedir();
    const path = this.uri.replace(home, '~');
    const dirs = path.split('/');
    const workspaceRootIndex = dirs.find(dir => dir === 'fish')
      ? dirs.indexOf('fish')
      : dirs.find(dir => ['conf.d', 'functions', 'completions', 'config.fish'].includes(dir))
        // ? dirs.findLastIndex(dir => ['conf.d', 'functions', 'completions', 'config.fish'].includes(dir))
        ? dirs.findIndex(dir => ['conf.d', 'functions', 'completions', 'config.fish'].includes(dir))
        : dirs.length - 1;

    return dirs.slice(workspaceRootIndex).join('/');
  }

  /**
   * checks if the functions are defined in a functions directory
   */
  isFunction(): boolean {
    const pathArray = this.uri.split('/');
    const fileName = pathArray.pop();
    const parentDir = pathArray.pop();
    /** paths that autoload all top level functions to the shell env */
    if (parentDir === 'conf.d' || fileName === 'config.fish') {
      return true;
    }
    /** path that autoload matching filename functions to the shell env */
    return parentDir === 'functions';
  }

  shouldAnalyzeInBackground(): boolean {
    const pathArray = this.uri.split('/');
    const fileName = pathArray.pop();
    const parentDir = pathArray.pop();
    return parentDir && ['functions', 'conf.d'].includes(parentDir?.toString()) || fileName === 'config.fish';
    // const folderType = this.getFolderType();
    // if (!folderType) return false;
    // return ['functions', 'conf.d', 'completions', 'config' ].includes(folderType)
  }

  public getWorkspace(): Workspace | undefined {
    return workspaces.find(workspace => workspace.contains(this.uri));
  }

  private getFolderType(): AutoloadType | null {
    // if (!this.getWorkspace()) return null;

    const docPath = uriToPath(this.uri);
    if (!docPath) return null;

    const dirName = path.basename(path.dirname(docPath));
    const fileName = path.basename(docPath);

    if (dirName === 'functions') return 'functions';
    if (dirName === 'conf.d') return 'conf.d';
    if (dirName === 'completions') return 'completions';
    if (fileName === 'config.fish') return 'config';

    return '';
  }

  /**
   * checks if the document is in a location where the functions
   * that it defines are autoloaded by fish.
   *
   * Use isAutoloadedUri() if you want to check for completions
   * files as well. This function does not check for completion
   * files.
   */
  isAutoloaded(): boolean {
    const folderType = this.getFolderType();
    if (!folderType) return false;
    return ['functions', 'conf.d', 'config'].includes(folderType);
  }

  /**
   * checks if the document is in a location:
   *  - `fish/{conf.d,functions,completions}/file.fish`
   *  - `fish/config.fish`
   *
   *  Key difference from isAutoLoaded is that this function checks for
   *  completions files as well. isAutoloaded() does not check for
   *  completion files.
   */
  isAutoloadedUri(): boolean {
    const folderType = this.getFolderType();
    if (!folderType) return false;
    return ['functions', 'conf.d', 'config', 'completions'].includes(folderType);
  }

  /**
   * helper that gets the document URI if it is fish/functions directory
   */
  getAutoloadType(): AutoloadType {
    return this.getFolderType() || '';
  }

  /**
     * helper that gets the document URI if it is fish/functions directory
     * @returns {string} - what the function name should be, or '' if it is not autoloaded
     */
  getAutoLoadName(): string {
    if (!this.isAutoloaded()) {
      return '';
    }
    const parts = uriToPath(this.uri)?.split('/') || [];
    const name = parts[parts.length - 1];
    return name!.replace('.fish', '');
  }

  getLines(): number {
    const lines = this.getText().split('\n');
    return lines.length;
  }
}

export class LspDocuments {
  private readonly _files: string[] = [];
  private readonly documents = new Map<string, LspDocument>();
  private loadingQueue: Set<string> = new Set();
  private loadedFiles: Map<string, number> = new Map(); // uri -> timestamp

  static create(): LspDocuments {
    return new LspDocuments();
  }

  /**
   * Sorted by last access.
   */
  get files(): string[] {
    return this._files;
  }

  get(file?: string): LspDocument | undefined {
    if (!file) {
      return undefined;
    }
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

  // Enhanced get method that supports async loading
  async getAsync(uri?: string): Promise<LspDocument | undefined> {
    if (!uri) return undefined;
    return this.getDocument(uri);
  }

  async getDocument(uri: string): Promise<LspDocument | undefined> {
    if (!this.loadingQueue.has(uri) && !this.loadedFiles.has(uri)) {
      this.loadingQueue.add(uri);
      try {
        const content = await fs.readFile(uriToPath(uri), 'utf8');
        const doc = new LspDocument({
          uri,
          languageId: 'fish',
          version: 1,
          text: content,
        });
        this.documents.set(uri, doc);
        this.loadedFiles.set(uri, Date.now());
      } finally {
        this.loadingQueue.delete(uri);
      }
    }
    return this.documents.get(uri);
  }

  open(doc: LspDocument): boolean {
    const file = uriToPath(doc.uri);
    if (this.documents.has(file)) {
      return false;
    }
    this.documents.set(file, doc);
    this._files.unshift(file);
    return true;
  }

  openTextDocument(document: TextDocument): LspDocument {
    const path = uriToPath(document.uri);
    if (this.documents.has(path)) {
      return this.documents.get(path)!;
    }
    const lspDocument = LspDocument.fromTextDocument(document);
    this.documents.set(path, lspDocument);
    this._files.unshift(path);
    return lspDocument;
  }

  updateTextDocument(textDocument: TextDocument): void {
    const path = uriToPath(textDocument.uri);
    this.documents.set(path, LspDocument.fromTextDocument(textDocument));
  }

  closeTextDocument(document: TextDocument): LspDocument | undefined {
    const path = uriToPath(document.uri);
    return this.close(path);
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

  rename(oldFile: string, newFile: string): boolean {
    const document = this.documents.get(oldFile);
    if (!document) {
      return false;
    }
    document.rename(newFile);
    this.documents.delete(oldFile);
    this.documents.set(newFile, document);
    this._files[this._files.indexOf(oldFile)] = newFile;
    return true;
  }

  public toResource(filepath: string): URI {
    const document = this.documents.get(filepath);
    if (document) {
      return URI.parse(document.uri);
    }
    return URI.file(filepath);
  }
}

/**
 * GLOBAL DOCUMENTS OBJECT
 *
 * This is a singleton object that holds all the documents open inside of it.
 *
 * Import this object and use it to access the documents.
 *
 * NOTE: while the documents inside this object should be accessible anywhere in
 *       the code, the object itself does not need to handle listening to events.
 *
 *       This is done by the server itself, in the `server.register()` method,
 *       specifically by the `this.documents` property of the server.
 *
 *       Notice that the server has a `this.documents` object (that is used to listen for document events)
 *       and it updates the `documents` object here, when they are seen
 */
export const documents = LspDocuments.create();
