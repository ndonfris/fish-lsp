//import * as LSP from 'vscode-languageserver/node';
//import { FISH_LOCATIONS, getAllFishLocations } from './utils/locations';
//import {basename, resolve, sep} from 'path';
//import { createTextDocumentFromFilePath } from './utils/io';
//import { getAllFishLocations, getFishTextDocumentsFromStandardLocations } from './utils/locations';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RemoteConsole, Position, Range, TextDocumentItem, TextDocumentPositionParams, TextDocuments, TextDocumentContentChangeEvent } from 'vscode-languageserver';
import { URI, Utils } from 'vscode-uri';
import FastGlob from 'fast-glob';
import { homedir } from 'os';
import { promises, readFileSync } from 'fs';
//import {logger} from './logger';
//import {FilepathResolver} from './utils/filepathResolver';
import { uriToPath } from './utils/translation';
import { sep } from 'path';

// removed the need for utils/{io,locations}.ts with funcitons at the top of this file.
// Add back later

/**
 * @async getFishDocumentsFromFileSystem() - Function to retrieve
 *                                           Fish default locations for documents are:
 *                                           $HOME/.config/fish, and /usr/share/fish
 *
 * @returns {Promise<TextDocument[]>} - Get all fish files in a directory path and return
 *                                      them as TextDocuments.
 */
// export async function getWorkspacePaths(documents: LspDocuments, paths: string[]): Promise<LspDocuments> {
//
//     const allFiles: string[] = [];
//
//     paths.forEach((path) => {
//         const files = FastGlob.sync("**.fish", {
//             absolute: true,
//             dot: true,
//             globstar: true,
//             cwd: path,
//         });
//         allFiles.push(...files);
//     });
//
//     // now allFiles contains every fish file that could be used in the workspace
//     await Promise.allSettled(allFiles.map(async file => {
//         const doc = documents.get(file.toString());
//         if (!doc) {
//             return false;
//         }
//         return true
//     }))
//
//     return documents
//
// }

/**
 * TODO: handle uri: URI | string differently
 *       @see https://stackoverflow.com/questions/39065077/typescript-multiple-type-parameter
 *
 * @async createTextDocumentFromURI() - creates a text document from a vscode-uri
 *
 * @param {URI} uri - vscode uri object
 * @returns {Promise<TextDocument>} - a textdocument, if the document contents of
 *                                    the document cannont be resovled then we will just
 *                                    create a text document with empty contents
 */
//async function createTextDocumentFromURI(uri: URI): Promise<TextDocument> {
//    const file = Utils.resolvePath(uri).fsPath
//    const contents = await promises.readFile(file, 'utf8')
//    return TextDocument.create(uri.toString(), 'fish', 0, contents || "")
//}

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

  /*
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

  applyEdits(version: number, ...changes: TextDocumentContentChangeEvent[]): void {
    const content = this.getText();
    for (const change of changes) {
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

  isFunction(): boolean {
    const pathArray = this.uri.split('/');
    const fileName = pathArray.pop();
    const parentDir = pathArray.pop();
    return parentDir === 'functions' || fileName === 'config.fish';
  }

  shouldAnalyzeInBackground(): boolean {
    const pathArray = this.uri.split('/');
    const fileName = pathArray.pop();
    const parentDir = pathArray.pop();
    return parentDir === 'functions' || fileName === 'config.fish';
  }

  /**
     * checks if the document is in fish/functions directory
     */
  isAutoLoaded(): boolean {
    const path = uriToPath(this.uri);
    return path?.includes(`${homedir()}/.config/fish`) || false;
  }

  /**
     * helper that gets the document URI if it is fish/functions directory
     * @returns {string} - what the function name should be, or '' if it is not autoloaded
     */
  getAutoLoadName(): string {
    if (!this.isAutoLoaded()) {
      return '';
    }
    const parts = uriToPath(this.uri)?.split('/') || [];
    const name = parts[parts.length - 1];
    return name!.replace('.fish', '');
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
