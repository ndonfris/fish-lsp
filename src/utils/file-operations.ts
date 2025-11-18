import { PathLike, accessSync, appendFileSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { pathToUri } from './translation';
import { basename, dirname, extname, normalize } from 'path';
import { env } from './env-manager';
import * as promises from 'fs/promises';
import { logger } from '../logger';

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
    try {
      const expandedFilePath = this.expandEnvVars(filePath);
      if (this.isDirectory(expandedFilePath)) {
        return '';
      }
      return readFileSync(expandedFilePath, { encoding });
    } catch (error) {
      logger.error(`Error reading file: ${filePath}`, error);
      return '';
    }
  }

  static loadDocumentSync(filePath: PathLike): LspDocument | undefined {
    try {
      const expandedFilePath = this.expandEnvVars(filePath);

      // Check if path exists and is a file
      if (!this.exists(expandedFilePath)) {
        return undefined;
      }

      const stats = statSync(expandedFilePath);
      if (stats.isDirectory()) {
        return undefined;
      }

      // Read file content safely
      const content = readFileSync(expandedFilePath, { encoding: 'utf8' });
      const uri = pathToUri(expandedFilePath.toString());

      // Create document
      const doc = TextDocumentItem.create(uri, 'fish', 0, content);
      return new LspDocument(doc);
    } catch (error) {
      // Handle all possible errors without crashing
      // Just return undefined on any file system error
      return undefined;
    }
  }

  // Write a file synchronously
  static write(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandEnvVars(filePath);
    writeFileSync(expandedFilePath, data, { encoding });
  }

  // write to a file that needs a directory created first
  static writeRecursive(filePath: PathLike, data: string, encoding: BufferEncoding = 'utf8'): void {
    const expandedFilePath = this.expandEnvVars(filePath);
    const directory = dirname(expandedFilePath);

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(expandedFilePath, data, { encoding });
    } catch (error) {
      logger.error(`Error writing file recursively: ${expandedFilePath}`, error);
    }
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

  /**
   * Expands environment variables and normalizes the path
   * - First expands ~ and $VARS using expandEnvVars()
   * - Then normalizes the path using path.normalize()
   * - Preserves relative vs absolute path semantics
   * @param filePath The path to expand and normalize
   * @returns The expanded and normalized path
   */
  static expandNormalize(filePath: PathLike): string {
    const expandedPath = this.expandEnvVars(filePath);
    return normalize(expandedPath);
  }

  static isExpandable(filePath: PathLike): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    return expandedFilePath !== filePath.toString() && expandedFilePath !== '';
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

  static isFile(filePath: PathLike): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    try {
      const fileStat = statSync(expandedFilePath);
      return fileStat.isFile();
    } catch (_) {
      return false;
    }
  }

  /**
   * Synchronously checks if a workspace path is a writable directory
   * @param workspacePath - The path to check
   * @returns true if path exists, is a directory, and is writable
   */
  static isWriteableDirectory(workspacePath: string): boolean {
    const expandedPath = this.expandEnvVars(workspacePath);
    if (!this.isDirectory(expandedPath)) {
      return false;
    }
    return this.isWriteablePath(expandedPath);
  }

  static isWriteableFile(filePath: string): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    if (!this.isFile(expandedFilePath)) {
      return false;
    }
    return this.isWriteablePath(expandedFilePath);
  }

  static isWriteable(filePath: string): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    return this.isWriteablePath(expandedFilePath);
  }

  private static isWriteablePath(path: string): boolean {
    try {
      accessSync(path, constants.W_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  static isAbsolutePath(filePath: string): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    return expandedFilePath.startsWith('/') || expandedFilePath.startsWith('~');
  }

  static isRelativePath(filePath: string): boolean {
    const expandedFilePath = this.expandEnvVars(filePath);
    return !this.isAbsolutePath(expandedFilePath);
  }
}

export namespace AsyncFileHelper {
  export async function isReadable(filePath: string): Promise<boolean> {
    const expandedFilePath = SyncFileHelper.expandEnvVars(filePath);
    try {
      await promises.access(expandedFilePath, promises.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  export async function isDir(filePath: string): Promise<boolean> {
    const expandedFilePath = SyncFileHelper.expandEnvVars(filePath);
    try {
      const fileStat = await promises.stat(expandedFilePath);
      return fileStat.isDirectory();
    } catch {
      return false;
    }
  }

  export async function isFile(filePath: string): Promise<boolean> {
    const expandedFilePath = SyncFileHelper.expandEnvVars(filePath);
    try {
      const fileStat = await promises.stat(expandedFilePath);
      return fileStat.isFile();
    } catch {
      return false;
    }
  }

  export async function readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const expandedFilePath = SyncFileHelper.expandEnvVars(filePath);
    return promises.readFile(expandedFilePath, { encoding });
  }

}
