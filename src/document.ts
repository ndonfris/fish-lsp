import { promises as fs } from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, TextDocumentItem, TextDocumentContentChangeEvent } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { homedir } from 'os';
import { AutoloadType, uriToPath } from './utils/translation';

export class LspDocument implements TextDocument {
  protected document: TextDocument;

  constructor(doc: TextDocumentItem) {
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
        ? dirs.findLastIndex(dir => ['conf.d', 'functions', 'completions', 'config.fish'].includes(dir))
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
    const path = uriToPath(this.uri);
    if (path?.includes('fish/functions')) {
      return true;
    } else if (path?.includes('fish/conf.d')) {
      return true;
    } else if (path?.includes('fish/config.fish')) {
      return true;
    }
    return false;
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
    const path = uriToPath(this.uri);
    if (path?.includes('fish/functions')) {
      return true;
    } else if (path?.includes('fish/conf.d')) {
      return true;
    } else if (path?.includes('fish/config.fish')) {
      return true;
    } else if (path?.includes('fish/completions')) {
      return true;
    }
    return false;
  }

  /**
   * helper that gets the document URI if it is fish/functions directory
   */
  getAutoloadType(): AutoloadType {
    const path = uriToPath(this.uri);
    if (path?.includes('fish/functions')) {
      return 'functions';
    } else if (path?.includes('fish/conf.d')) {
      return 'conf.d';
    } else if (path?.includes('fish/config.fish')) {
      return 'config';
    } else if (path?.includes('fish/completions')) {
      return 'completions';
    }
    return '';
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

  open(file: string, doc: TextDocumentItem): boolean {
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
