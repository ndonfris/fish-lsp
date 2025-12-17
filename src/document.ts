import * as path from 'path';
import { homedir } from 'os';
import { promises } from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, TextDocumentItem, TextDocumentContentChangeEvent, VersionedTextDocumentIdentifier, TextDocumentIdentifier, DocumentUri } from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver/node';
import { workspaceManager } from './utils/workspace-manager';
import { AutoloadType, isPath, isTextDocument, isTextDocumentItem, isUri, PathLike, pathToUri, uriToPath } from './utils/translation';
import { Workspace } from './utils/workspace';
import { SyncFileHelper } from './utils/file-operations';
import { logger } from './logger';
import * as Locations from './utils/locations';
import { FishSymbol } from './parsing/symbol';
import { logTreeSitterDocumentDebug, returnParseTreeString } from './utils/cli-dump-tree';

export class LspDocument implements TextDocument {
  protected document: TextDocument;
  public lastChangedLineSpan?: LineSpan;

  constructor(doc: TextDocumentItem) {
    const { uri, languageId, version, text } = doc;
    this.document = TextDocument.create(uri, languageId, version, text);
    this.lastChangedLineSpan = computeChangedLineSpan([{ text }]);
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

  static create(
    uri: string,
    languageId: string,
    version: number,
    text: string,
  ): LspDocument {
    const inner = TextDocument.create(uri, languageId, version, text);
    return new LspDocument({ uri: inner.uri, languageId: inner.languageId, version: inner.version, text: inner.getText() });
  }

  static update(
    doc: LspDocument,
    changes: TextDocumentContentChangeEvent[],
    version: number,
  ): LspDocument {
    doc.document = TextDocument.update(doc.document, changes, version);
    doc.lastChangedLineSpan = computeChangedLineSpan(changes);
    return doc;
  }

  /**
   * Creates a new LspDocument from a path, URI, TextDocument, TextDocumentItem, or another LspDocument.
   * @param param The parameter to create the LspDocument from.
   * @returns A new LspDocument instance.
   */
  static createFrom(uri: DocumentUri): LspDocument;
  static createFrom(path: PathLike): LspDocument;
  static createFrom(doc: TextDocument): LspDocument;
  static createFrom(doc: TextDocumentItem): LspDocument;
  static createFrom(doc: LspDocument): LspDocument;
  static createFrom(param: PathLike | DocumentUri | TextDocument | TextDocumentItem | LspDocument): LspDocument;
  static createFrom(param: PathLike | DocumentUri | TextDocument | TextDocumentItem | LspDocument): LspDocument {
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

  /**
   * Fallback span that covers the entire document
   */
  get fullSpan() {
    return {
      start: 0,
      end: this.positionAt(this.getText().length).line,
    };
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
    if (Locations.Position.is(line)) {
      line = line.line;
    } else if (Locations.Range.is(line)) {
      line = line.start.line;
    } else if (FishSymbol.is(line)) {
      line = line.range.start.line;
    }
    const lines = this.document.getText().split('\n');
    return lines[line] || '';
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

  /**
   * Apply incremental LSP changes to this document.
   *
   * @param changes TextDocumentContentChangeEvent[] from textDocument/didChange
   * @param version Optional LSP version; if omitted, increments current version
   */
  update(changes: TextDocumentContentChangeEvent[], version?: number): void {
    const newVersion = version ?? this.version + 1;
    this.document = TextDocument.update(this.document, changes, newVersion);
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

    // Treat funced files as if they were in the functions directory
    if (this.isFunced()) return 'functions';
    if (this.isCommandlineBuffer()) return 'conf.d';

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
    if (this.isFunced()) return true;
    return ['functions', 'conf.d', 'config'].includes(folderType);
  }

  isFunced(): boolean {
    return LspDocument.isFuncedPath(this.path);
  }

  isCommandlineBuffer(): boolean {
    return LspDocument.isCommandlineBufferPath(this.path);
  }

  static isFuncedPath(path: string): boolean {
    return path.startsWith('/tmp/fish-funced.');
  }

  static isCommandlineBufferPath(path: string): boolean {
    return path.startsWith('/tmp/fish.') && path.endsWith('command-line.fish');
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

  showTree(): void {
    logTreeSitterDocumentDebug(this);
  }

  getTree(): string {
    return returnParseTreeString(this);
  }

  updateVersion(version: number) {
    this.document = this.create(this.document.uri, this.document.languageId, version, this.document.getText());
    return this;
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

  /**
   * @TODO check that this correctly handles range creation for both starting and ending positions
   * If this doesn't work as expected, we could alternatively create the range manually with
   * `getRange(analyzedDocument.root)`
   */
  get fileRange(): Range {
    const start = Position.create(0, 0);
    const end = this.positionAt(this.getText().length);
    return Range.create(start, end);
  }

  hasShebang(): boolean {
    const firstLine = this.getLine(0);
    return firstLine.startsWith('#!');
  }
}

/**
 * A LineSpan represents a range of lines in a document that have changed.
 *
 * We use this later to optimize diagnostic updates, by comparing the changed
 * line span to the ranges of existing diagnostics, and removing any that
 * fall within the changed span.
 *
 * @property start - The starting line number (0-based).
 * @property end - The ending line number (0-based).
 * @property isFullDocument - If true, indicates the entire document changed.
 *
 * isFullDocument is optional and defaults to false, but is useful because
 * the consumer of this type, might want to treat actual isFullDocument changes
 * differently than incremental changes that would happen `documents.onDidChangeContent()`
 */
export type LineSpan = { start: number; end: number; isFullDocument?: boolean; };

/**
 * Computes the span of lines that have changed in a set of TextDocumentContentChangeEvent.
 */
function computeChangedLineSpan(
  changes: TextDocumentContentChangeEvent[],
): LineSpan | undefined {
  if (changes.length === 0) return undefined;

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const c of changes) {
    // Full-document sync
    if (TextDocumentContentChangeEvent.isFull(c)) {
      return { start: 0, end: Number.MAX_SAFE_INTEGER, isFullDocument: true };
    }

    // Incremental sync
    if (TextDocumentContentChangeEvent.isIncremental(c)) {
      const { range } = c as TextDocumentContentChangeEvent & { range: Range; };
      if (range.start.line < start) start = range.start.line;
      if (range.end.line > end) end = range.end.line;
    }
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end, isFullDocument: false };
}

// compare a Range to a LineSpan, with an optional offset (how many lines to expand the span by)
export function rangeOverlapsLineSpan(
  range: Range,
  span: { start: number; end: number; },
  offset: number = 1,
): boolean {
  const safeOffset = Math.max(0, offset);

  // Expand the span by `offset` in both directions
  const expandedStart = Math.max(0, span.start - safeOffset);
  const expandedEnd = span.end + safeOffset;

  // Standard closed-interval overlap check:
  // [range.start.line, range.end.line] vs [expandedStart, expandedEnd]
  return range.start.line <= expandedEnd && range.end.line >= expandedStart;
}

/**
 * GLOBAL DOCUMENTS OBJECT (TextDocuments<LspDocument>)
 *
 * This is now the canonical document manager, just like the VS Code sample,
 * but parameterized with our LspDocument wrapper.
 *
 * @example
 *
 * ```typescript
 * const documents = new TextDocuments(TextDocument);
 * ```
 */
export const documents = new TextDocuments<LspDocument>({
  create: (uri, languageId, version, text) =>
    new LspDocument({ uri, languageId: languageId || 'fish', version, text }),
  update: (doc, changes, version) => {
    doc.update(changes, version);
    return doc;
  },
});

export type Documents = typeof documents;
