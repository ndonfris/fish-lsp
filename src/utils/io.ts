import { accessSync, constants, readdirSync, readFileSync, statSync, readFile } from 'fs'
import { homedir } from 'os'
import { fileURLToPath, URL } from 'url'
import { promisify } from 'util'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { isFishExtension } from './tree-sitter'
import { resolve } from 'path';
import {Context} from '../interfaces';

export async function createTextDocumentFromFilePath(url: URL): Promise<TextDocument | null> {
    let content: string
    let uri: string = fileURLToPath(url)
    try {
        content = readFileSync(resolve(uri), "utf8");
    } catch (err) {
        const { message, name } = err as Error;
        //context.connection.console.error(`pathname: ${uri}`);
        //context.connection.console.error(`${name}: ${message}`);
        return null;
    }

    return TextDocument.create(url.pathname, "fish", 0, content);
}

///** Get files ending with .fish recursively */
export function getFishFilesInDir(uri: string): URL[] {
  const result: URL[] = []
  const url = new URL(uri)

  try {
    accessSync(url, constants.R_OK)
  } catch (_err) {
    return []
  }

  for (const dirent of readdirSync(url, { withFileTypes: true })) {
    if (isFishExtension(dirent.name)) {
      result.push(new URL(`${uri}/${dirent.name}`))
      continue
    }

    if (dirent.isDirectory()) {
      result.push(...getFishFilesInDir(`${uri}/${dirent.name}`))
    }
  }

  return result
}

//export function readDocumentFromUrl(context: Context, url: URI): TextDocument | null {
//  let content: string
//
//  try {
//    content = readFileSync(url.fsPath, 'utf8')
//  } catch (err) {
//    const { message, name } = err as Error
//    context.connection.console.error(`${name}: ${message}`)
//    return null
//  }
//
//  return TextDocument.create(url.fsPath, 'fish', 0, content)
//}

//export function isDir(uri: string): boolean {
//  return statSync(new URL(uri)).isDirectory()
//}
//
//
//
///// @SEE https://github.com/typescript-language-server/typescript-language-server/blob/114d4309cb1450585f991604118d3eff3690237c/src/protocol-translation.ts#L17
//// officical ts-server implementation
//
//const RE_PATHSEP_WINDOWS = /\\/g;
//
//export function uriToPath(stringUri: string): string | undefined {
//    // Vim may send `zipfile:` URIs which tsserver with Yarn v2+ hook can handle. Keep as-is.
//    // Example: zipfile:///foo/bar/baz.zip::path/to/module
//    if (stringUri.startsWith('zipfile:')) {
//        return stringUri;
//    }
//    const uri = URI.parse(stringUri);
//    if (uri.scheme !== 'file') {
//        return undefined;
//    }
//    return normalizeFsPath(uri.fsPath);
//}
//
//
//export function pathToUri(filepath: string, documents: LspDocuments | undefined): string {
//    // Yarn v2+ hooks tsserver and sends `zipfile:` URIs for Vim. Keep as-is.
//    // Example: zipfile:///foo/bar/baz.zip::path/to/module
//    if (filepath.startsWith('zipfile:')) {
//        return filepath;
//    }
//    const fileUri = URI.file(filepath);
//    const normalizedFilepath = normalizePath(fileUri.fsPath);
//    const document = documents && documents.get(normalizedFilepath);
//    return document ? document.uri : fileUri.toString();
//}
//
///**
// * Normalizes the file system path.
// *
// * On systems other than Windows it should be an no-op.
// *
// * On Windows, an input path in a format like "C:/path/file.ts"
// * will be normalized to "c:/path/file.ts".
// */
//export function normalizePath(filePath: string): string {
//    const fsPath = URI.file(filePath).fsPath;
//    return normalizeFsPath(fsPath);
//}
//
///**
// * Normalizes the path obtained through the "fsPath" property of the URI module.
// */
//export function normalizeFsPath(fsPath: string): string {
//    return fsPath.replace(RE_PATHSEP_WINDOWS, '/');
//}
