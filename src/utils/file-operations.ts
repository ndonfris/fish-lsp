import { PathLike, appendFileSync, closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { pathToUri } from './translation';
import { basename, dirname, extname } from 'path';
import { env } from './env-manager';

/**
 * Synchronous file operations.
 */
export class SyncFileHelper {
  static open(filePath: PathLike, flags: string): number {
    const expandedFilePath = this.expandEnvVars(filePath);
    return openSync(expandedFilePath, flags);
  }

  static close(fd: number): void {
    closeSync(fd);
  }

  static read(filePath: PathLike, encoding: BufferEncoding = 'utf8'): string {
    const expandedFilePath = this.expandEnvVars(filePath);
    return readFileSync(expandedFilePath, { encoding });
  }

  static write(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandEnvVars(filePath);
    writeFileSync(expandedFilePath, data, { encoding });
  }

  static append(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandEnvVars(filePath);
    appendFileSync(expandedFilePath, data, { encoding });
  }

  static expandEnvVars(filePath: PathLike): string {
    let filePathString = filePath.toString();
    // Expand ~ to home directory
    filePathString = filePathString.replace(/^~/, process.env.HOME!);
    // Expand environment variables
    filePathString = filePathString.replace(/\$([a-zA-Z0-9_]+)/g, (_, envVarName) => {
      return env.get(envVarName) || '';
    });
    return filePathString;
  }

  static exists(filePath: PathLike): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    return existsSync(expandedFilePath);
  }

  static delete(filePath: PathLike): void {
    unlinkSync(filePath);
  }

  static create(filePath: PathLike) {
    const expandedFilePath = this.expandEnvVars(filePath);
    if (this.isDirectory(expandedFilePath)) {
      return this.getPathTokens(filePath);
    } else if (!this.exists(expandedFilePath)) {
      this.write(expandedFilePath, '');
    }
    return this.getPathTokens(expandedFilePath);
  }

  static getPathTokens(filePath: PathLike) {
    const expandedFilePath = this.expandEnvVars(filePath);
    return {
      path: expandedFilePath,
      filename: basename(expandedFilePath, extname(expandedFilePath)),
      extension: extname(expandedFilePath).substring(1),
      directory: dirname(expandedFilePath),
      exists: this.exists(expandedFilePath),
      uri: pathToUri(expandedFilePath),
    };
  }

  static convertTextToFishFunction(filePath: PathLike, data: string, _encoding: BufferEncoding = 'utf8') {
    const expandedFilePath = this.expandEnvVars(filePath);
    const { filename, path, extension, exists } = this.getPathTokens(expandedFilePath);
    const content = [
      '',
      `function ${filename}`,
      data.split('\n').map(line => '\t' + line).join('\n'),
      'end',
    ].join('\n');

    if (exists) {
      this.append(path, content, 'utf8');
      return this.toLspDocument(path, extension);
    }
    this.write(path, content);
    return this.toLspDocument(path, extension);
  }

  static toTextDocumentItem(filePath: PathLike, languageId: string, version: number): TextDocumentItem {
    const expandedFilePath = this.expandEnvVars(filePath);
    const content = this.read(expandedFilePath);
    const uri = pathToUri(expandedFilePath.toString());
    return TextDocumentItem.create(uri, languageId, version, content);
  }

  static toLspDocument(filePath: PathLike, languageId: string = 'fish', version: number = 1): LspDocument {
    const expandedFilePath = this.expandEnvVars(filePath);
    let content = this.read(expandedFilePath);

    if (!content) {
      content = '';
    }
    const doc = this.toTextDocumentItem(expandedFilePath, languageId, version);
    return new LspDocument(doc);
  }

  static isDirectory(filePath: PathLike): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    try {
      const fileStat = statSync(expandedFilePath);
      return fileStat.isDirectory();
    } catch (_) {
      return false;
    }
  }
}
