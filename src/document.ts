import { promises } from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, TextDocumentItem, TextDocumentContentChangeEvent, VersionedTextDocumentIdentifier, TextDocumentIdentifier, DocumentUri } from 'vscode-languageserver';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { homedir } from 'os';
import { AutoloadType, isPath, isTextDocument, isTextDocumentItem, isUri, PathLike, pathToUri, uriToPath } from './utils/translation';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { SyncFileHelper } from './utils/file-operations';
import { logger } from './logger';
import * as Locations from './utils/locations';
import { FishSymbol } from './parsing/symbol';

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

  static createFromUri(uri: DocumentUri): LspDocument {
    const content = SyncFileHelper.read(uriToPath(uri));
    return LspDocument.createTextDocumentItem(uri, content);
  }

  static createFromPath(path: PathLike): LspDocument {
    const content = SyncFileHelper.read(path);
    return LspDocument.createTextDocumentItem(pathToUri(path), content);
  }

  static testUri(uri: DocumentUri): string {
    const removeString = 'tests/workspaces';
    if (uri.includes(removeString)) {
      return 'file:///…/' + uri.slice(uri.indexOf(removeString) + removeString.length + 1);
    }
    return uri;
  }

  static testUtil(uri: DocumentUri) {
    const shortUri = LspDocument.testUri(uri);
    const fullPath = uriToPath(uri);

    const parentDir = path.dirname(fullPath);
    const relativePath = shortUri.slice(shortUri.indexOf(parentDir) + parentDir.length + 1);

    return {
      uri,
      shortUri,
      fullPath,
      relativePath,
      parentDir,
    };
  }

  /**
   * Creates a new LspDocument from a path, URI, TextDocument, TextDocumentItem, or another LspDocument.
   * @param param The parameter to create the LspDocument from.
   * @returns A new LspDocument instance.
   */
  static create(uri: DocumentUri): LspDocument;
  static create(path: PathLike): LspDocument;
  static create(doc: TextDocument): LspDocument;
  static create(doc: TextDocumentItem): LspDocument;
  static create(doc: LspDocument): LspDocument;
  static create(param: PathLike | DocumentUri | TextDocument | TextDocumentItem | LspDocument): LspDocument;
  static create(param: PathLike | DocumentUri | TextDocument | TextDocumentItem | LspDocument): LspDocument {
    if (typeof param === 'string' && isPath(param)) return LspDocument.createFromPath(param);
    if (typeof param === 'string' && isUri(param)) return LspDocument.createFromUri(param);
    if (LspDocument.is(param)) return LspDocument.fromTextDocument(param.document);
    if (isTextDocumentItem(param)) return LspDocument.createTextDocumentItem(param.uri, param.text);
    if (isTextDocument(param)) return LspDocument.fromTextDocument(param);
    // we should never reach here
    logger.error('Invalid parameter type `LspDocument.create()`: ', param);
    return undefined as never;
  }

  static async createFromUriAsync(uri: DocumentUri): Promise<LspDocument> {
    const content = await promises.readFile(uriToPath(uri), 'utf8');
    return LspDocument.createTextDocumentItem(uri, content);
  }

  asTextDocumentItem(): TextDocumentItem {
    return {
      uri: this.document.uri,
      languageId: this.document.languageId,
      version: this.document.version,
      text: this.document.getText(),
    };
  }

  asTextDocumentIdentifier(): TextDocumentIdentifier {
    return {
      uri: this.document.uri,
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

  get path(): string {
    return uriToPath(this.document.uri);
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

  /**
   * @see getLineBeforeCursor()
   */
  getLine(line: number | Position | Range | FishSymbol): string {
    // if (typeof line === 'number') {
    // } else
    if (Locations.Position.is(line)) {
      line = line.line;
    } else if (Locations.Range.is(line)) {
      line = line.start.line;
    } else if (FishSymbol.is(line)) {
      line = line.range.start.line;
    }
    // const lineRange = this.getLineRange(line);
    const lines = this.document.getText().split('\n');
    return lines[line] || '';
    // return this.document.getText().split(('\n').at(line) || '') || '';
    // return this.getText(lineRange);
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

  update(changes: TextDocumentContentChangeEvent[]): LspDocument {
    this.document = TextDocument.update(this.document, changes, this.version + 1);
    return LspDocument.fromTextDocument(this.document);
  }

  asVersionedIdentifier() {
    return VersionedTextDocumentIdentifier.create(this.uri, this.version);
  }

  rename(newUri: string): void {
    this.document = TextDocument.create(newUri, this.languageId, this.version, this.getText());
  }

  getFilePath(): string {
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

  isAutoloadedFunction(): boolean {
    return this.getAutoloadType() === 'functions';
  }

  isAutoloadedCompletion(): boolean {
    return this.getAutoloadType() === 'completions';
  }

  isAutoloadedConfd(): boolean {
    return this.getAutoloadType() === 'conf.d';
  }

  shouldAnalyzeInBackground(): boolean {
    const pathArray = this.uri.split('/');
    const fileName = pathArray.pop();
    const parentDir = pathArray.pop();
    return parentDir && ['functions', 'conf.d', 'completions'].includes(parentDir?.toString()) || fileName === 'config.fish';
  }

  public getWorkspace(): Workspace | undefined {
    return workspaceManager.findContainingWorkspace(this.uri) || undefined;
  }

  private getFolderType(): AutoloadType | null {
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
   * checks if the document is in a location where it is autoloaded
   * @returns {boolean} - true if the document is in a location that could contain `complete` definitions
   */
  isAutoloadedWithPotentialCompletions(): boolean {
    const folderType = this.getFolderType();
    if (!folderType) return false;
    return ['conf.d', 'config', 'completions'].includes(folderType);
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
    if (!this.isAutoloadedUri()) {
      return '';
    }
    const parts = uriToPath(this.uri)?.split('/') || [];
    const name = parts[parts.length - 1];
    return name!.replace('.fish', '');
  }

  getFileName(): string {
    const items = uriToPath(this.uri).split('/') || [];
    const name = items.length > 0 ? items.pop()! : uriToPath(this.uri);
    return name;
  }

  getLines(): number {
    const lines = this.getText().split('\n');
    return lines.length;
  }

  /**
   * Type guard to check if an object is an LspDocument
   *
   * @param value The value to check
   * @returns True if the value is an LspDocument, false otherwise
   */
  static is(value: unknown): value is LspDocument {
    return (
      // Check if it's an object first
      typeof value === 'object' &&
      value !== null &&
      // Check for LspDocument-specific methods/properties not found in TextDocument or TextDocumentItem
      typeof (value as LspDocument).asTextDocumentItem === 'function' &&
      typeof (value as LspDocument).asTextDocumentIdentifier === 'function' &&
      typeof (value as LspDocument).getAutoloadType === 'function' &&
      typeof (value as LspDocument).isAutoloaded === 'function' &&
      typeof (value as LspDocument).path === 'string' &&
      typeof (value as LspDocument).getFileName === 'function' &&
      typeof (value as LspDocument).getRelativeFilenameToWorkspace === 'function' &&
      typeof (value as LspDocument).getLine === 'function' &&
      typeof (value as LspDocument).getLines === 'function' &&
      // Ensure base TextDocument properties are also present
      typeof (value as LspDocument).uri === 'string' &&
      typeof (value as LspDocument).getText === 'function'
    );
  }
}

export class LspDocuments {
  private readonly _files: string[] = [];
  private readonly documents = new Map<string, LspDocument>();

  static create(): LspDocuments {
    return new LspDocuments();
  }

  static from(documents: LspDocuments): LspDocuments {
    const newDocuments = new LspDocuments();
    newDocuments.documents.clear();
    newDocuments._files.length = 0;
    documents.documents.forEach((doc, file) => {
      newDocuments.documents.set(file, doc);
      newDocuments._files.push(file);
    });
    return newDocuments;
  }

  copy(documents: LspDocuments): LspDocuments {
    this.documents.clear();
    this._files.push(...documents._files);
    documents.documents.forEach((doc, file) => {
      this.documents.set(file, doc);
    });
    return this;
  }

  get openDocuments(): LspDocument[] {
    const result: LspDocument[] = [];
    for (const file of this._files.toReversed()) {
      const document = this.documents.get(file);
      if (document) {
        result.push(document);
      }
    }
    return result;
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

  openPath(path: string, doc: TextDocumentItem): LspDocument {
    const lspDocument = new LspDocument(doc);
    this.documents.set(path, lspDocument);
    this._files.unshift(path);
    return lspDocument;
  }

  private getPathFromParam(param: PathLike | DocumentUri | LspDocument | TextDocumentItem | TextDocument): string {
    if (isUri(param)) {
      return uriToPath(param);
    }
    if (isPath(param)) {
      return param;
    }
    if (isTextDocument(param)) {
      return uriToPath(param.uri);
    }
    if (isTextDocumentItem(param)) {
      return uriToPath(param.uri);
    }
    if (LspDocument.is(param)) {
      return (param as LspDocument).path;
    }
    throw new Error('Invalid parameter type');
  }

  open(uri: DocumentUri): boolean;
  open(path: PathLike): boolean;
  open(lspDocument: LspDocument): boolean;
  open(textDocument: TextDocument): boolean;
  open(textDocumentItem: TextDocumentItem): boolean;
  open(param: PathLike | DocumentUri | LspDocument | TextDocument | TextDocumentItem): boolean;
  open(param: PathLike | DocumentUri | LspDocument | TextDocument | TextDocumentItem): boolean {
    const path: string = this.getPathFromParam(param);
    if (this.documents.has(path)) {
      return false;
    }
    const newDoc = LspDocument.create(param);
    this.documents.set(path, newDoc);
    this._files.unshift(path);
    return true;
  }

  isOpen(path: string | DocumentUri): boolean {
    if (URI.isUri(path)) {
      path = uriToPath(path);
    }
    return this.documents.has(path);
  }

  get uris(): string[] {
    return Array.from(this._files).map(file => pathToUri(file));
  }

  getDocument(uri: DocumentUri): LspDocument | undefined {
    const path = uriToPath(uri);
    return this.documents.get(path);
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

  updateTextDocument(textDocument: TextDocument): LspDocument {
    const path = uriToPath(textDocument.uri);
    this.documents.set(path, LspDocument.fromTextDocument(textDocument));
    return this.documents.get(path) as LspDocument;
  }

  applyChanges(uri: DocumentUri, changes: TextDocumentContentChangeEvent[]) {
    const path = uriToPath(uri);
    let document = this.documents.get(path);
    if (document) {
      document = document.update(changes);
      this.documents.set(path, document);
    }
  }

  set(document: LspDocument): void {
    const path = uriToPath(document.uri);
    this.documents.set(path, document);
  }

  all(): LspDocument[] {
    return Array.from(this.documents.values());
  }

  closeTextDocument(document: TextDocument): LspDocument | undefined {
    const path = uriToPath(document.uri);
    return this.close(path);
  }

  close(uri: DocumentUri): LspDocument | undefined;
  close(path: PathLike): LspDocument | undefined;
  close(lspDocument: LspDocument): LspDocument | undefined;
  close(textDocument: TextDocument): LspDocument | undefined;
  close(textDocumentItem: TextDocumentItem): LspDocument | undefined;
  close(param: PathLike | DocumentUri | LspDocument | TextDocument | TextDocumentItem): LspDocument | undefined;
  close(param: PathLike | DocumentUri | LspDocument | TextDocument | TextDocumentItem): LspDocument | undefined {
    const path: string = this.getPathFromParam(param);
    const document = this.documents.get(path);
    if (!document) {
      return undefined;
    }
    this.documents.delete(path);
    this._files.splice(this._files.indexOf(path), 1);
    return document;
  }

  closeAll(): void {
    this.documents.clear();
    this._files.length = 0;
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

  clear(): void {
    this.documents.clear();
    this._files.length = 0;
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

