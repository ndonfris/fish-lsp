import {URI, Utils} from 'vscode-uri';
import { LspDocuments } from '../document';
import { Range } from 'vscode-languageserver';

const RE_PATHSEP_WINDOWS = /\\/g;

export function uriToPath(stringUri: string): string | undefined {
    // Vim may send `zipfile:` URIs which tsserver with Yarn v2+ hook can handle. Keep as-is.
    // Example: zipfile:///foo/bar/baz.zip::path/to/module
    if (stringUri.startsWith('zipfile:')) {
        return stringUri;
    }
    const uri = URI.parse(stringUri);
    if (uri.scheme !== 'file') {
        return undefined;
    }
    return normalizeFsPath(uri.fsPath);
}

export function pathToUri(filepath: string, documents: LspDocuments | undefined): string {
    // Yarn v2+ hooks tsserver and sends `zipfile:` URIs for Vim. Keep as-is.
    // Example: zipfile:///foo/bar/baz.zip::path/to/module
    if (filepath.startsWith('zipfile:')) {
        return filepath;
    }
    const fileUri = URI.file(filepath);
    const normalizedFilepath = normalizePath(fileUri.fsPath);
    const document = documents && documents.get(normalizedFilepath);
    return document ? document.uri : fileUri.toString();
}

/**
 * Normalizes the file system path.
 *
 * On systems other than Windows it should be an no-op.
 *
 * On Windows, an input path in a format like "C:/path/file.ts"
 * will be normalized to "c:/path/file.ts".
 */
export function normalizePath(filePath: string): string {
    const fsPath = URI.file(filePath).fsPath;
    return normalizeFsPath(fsPath);
}

/**
 * Normalizes the path obtained through the "fsPath" property of the URI module.
 */
export function normalizeFsPath(fsPath: string): string {
    return fsPath.replace(RE_PATHSEP_WINDOWS, '/');
}

function currentVersion(filepath: string, documents: LspDocuments | undefined): number | null {
    const fileUri = URI.file(filepath);
    const normalizedFilepath = normalizePath(fileUri.fsPath);
    const document = documents && documents.get(normalizedFilepath);
    return document ? document.version : null;
}


export function pathToRelativeFilename(uriPath: string) : string {
    const relativeName = uriPath.split('/').at(-1) || uriPath;
    return relativeName.replace('.fish', '');

}

