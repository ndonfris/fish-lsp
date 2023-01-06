import os from 'os'
import {URI, Utils} from 'vscode-uri';
import { LspDocuments } from '../document';
import { DocumentSymbol, SelectionRange, SymbolInformation, SymbolKind, TextDocumentEdit, TextEdit } from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {toSymbolKind} from '../symbols';
import { getPrecedingComments, getRange } from './tree-sitter';
import {findEnclosingVariableScope, findParentVariableDefintionKeyword} from './node-types';
import {Position, Range} from './locations';
import { FishProtocol} from './fishProtocol';

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

export function uriInUserFunctions(uri: string) {
    const path = uriToPath(uri);
    return path?.startsWith(`${os.homedir()}/.config/fish/functions`) 
}

export function nodeToSymbolInformation(node: SyntaxNode, uri: string) : SymbolInformation {
    let name = node.text
    let kind = toSymbolKind(node);
    let range = getRange(node)
    switch (kind) {
        case SymbolKind.Namespace: 
            name = pathToRelativeFilename(uri)
            break
        case SymbolKind.Function: 
        case SymbolKind.Variable: 
        case SymbolKind.File: 
        case SymbolKind.Class: 
        case SymbolKind.Null: 
        default: 
            break
    }
    return SymbolInformation.create(name, kind, range, uri)
}

export function nodeToDocumentSymbol(node: SyntaxNode) : DocumentSymbol {
    let name = node.text
    let detail = node.text
    let kind = toSymbolKind(node);
    let range = getRange(node)
    let selectionRange = getRange(node)
    let children : DocumentSymbol[] = []
    let parent = node.parent || node
    switch (kind) {
        case SymbolKind.Variable: 
            parent = findParentVariableDefintionKeyword(node) || node
            detail = getPrecedingComments(parent)
            range = getRange(parent)
            break
        case SymbolKind.Function: 
            detail = getPrecedingComments(parent)
            range = getRange(parent)
            break
        case SymbolKind.File: 
        case SymbolKind.Class: 
        case SymbolKind.Namespace: 
        case SymbolKind.Null: 
        default: 
            break
    }
    return DocumentSymbol.create(name, detail, kind, range, selectionRange, children)
}

export function toSelectionRange(range: SelectionRange): SelectionRange {
    const span = Range.toTextSpan(range.range)
    return SelectionRange.create(
        Range.fromTextSpan(span),
        range.parent ? toSelectionRange(range.parent) : undefined,
    );
}

export function toTextEdit(edit: FishProtocol.CodeEdit): TextEdit {
    return {
        range: {
            start: Position.fromLocation(edit.start),
            end: Position.fromLocation(edit.end),
        },
        newText: edit.newText,
    };
}

export function toTextDocumentEdit(change: FishProtocol.FileCodeEdits, documents: LspDocuments | undefined): TextDocumentEdit {
    return {
        textDocument: {
            uri: pathToUri(change.fileName, documents),
            version: currentVersion(change.fileName, documents),
        },
        edits: change.textChanges.map(c => toTextEdit(c)),
    };
}
