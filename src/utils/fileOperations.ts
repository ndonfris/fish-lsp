import { PathLike, appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { TextDocument, TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { pathToUri } from './translation';
import { basename, dirname, extname, format } from 'path';

/**
 * Synchronous file operations.
 */
export class SyncFileHelper {
  static open(filePath: PathLike, flags: string): number {
    const expandedFilePath = this.expandTilde(filePath);
    return openSync(expandedFilePath, flags);
  }

  static close(fd: number): void {
    closeSync(fd);
  }

  static read(filePath: PathLike, encoding: BufferEncoding = 'utf8'): string {
    const expandedFilePath = this.expandTilde(filePath);
    return readFileSync(expandedFilePath, { encoding });
  }

  static write(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandTilde(filePath);
    writeFileSync(expandedFilePath, data, { encoding });
  }

  static append(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandTilde(filePath);
    appendFileSync(expandedFilePath, data, { encoding });
  }

  static expandTilde(filePath: PathLike): string {
    const filePathString = filePath.toString();
    if (filePathString.startsWith('~')) {
      return filePathString.replace('~', process.env.HOME!);
    }
    return filePathString;
  }

  static exists(filePath: PathLike): boolean {
    const expandedFilePath = this.expandTilde(filePath);
    return existsSync(expandedFilePath);
  }

  static delete(filePath: PathLike): void {
    unlinkSync(filePath);
  }

  static create(filePath: PathLike) {
    const expandedFilePath = this.expandTilde(filePath);
    if (!this.exists(expandedFilePath)) {
      this.write(expandedFilePath, '');
    }
    return this.getPathTokens(expandedFilePath);
  }

  static getPathTokens(filePath: PathLike) {
    const expandedFilePath = this.expandTilde(filePath);
    return {
      path: expandedFilePath,
      filename: basename(expandedFilePath, extname(expandedFilePath)),
      extension: extname(expandedFilePath).substring(1),
      directory: dirname(expandedFilePath),
      exists: this.exists(expandedFilePath),
      uri: pathToUri(expandedFilePath),
    };
  }

  static convertTextToFishFunction(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8') {
    const expandedFilePath = this.expandTilde(filePath);
    const { filename, path, extension, exists } = this.getPathTokens(expandedFilePath);
    const content = [
      '',
      `function ${filename}`,
      data.split('\n').map(line => '\t' + line).join('\n'),
      'end',
    ].join('\n');

    if (exists) {
      this.append(path, content, 'utf8');
      return this.toLspDocument(path, extension, 1);
    }
    this.write(path, content);
    return this.toLspDocument(path, extension, 1);
  }

  static toTextDocumentItem(filePath: PathLike, languageId: string, version: number): TextDocumentItem {
    const expandedFilePath = this.expandTilde(filePath);
    const content = this.read(expandedFilePath);
    const uri = pathToUri(expandedFilePath.toString());
    return TextDocumentItem.create(uri, languageId, version, content);
  }

  static toLspDocument(filePath: PathLike, languageId: string, version: number): LspDocument {
    const expandedFilePath = this.expandTilde(filePath);
    let content = this.read(expandedFilePath);

    if (!content) {
      content = '';
    }
    const doc = this.toTextDocumentItem(expandedFilePath, languageId, version);
    return new LspDocument(doc);
  }
}
