import { DocumentSymbol, FoldingRange, FoldingRangeKind, SelectionRange, SymbolInformation, SymbolKind, TextDocumentEdit, TextDocumentItem, TextEdit } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { URI } from 'vscode-uri';
import { findParentVariableDefinitionKeyword, isCommand, isCommandName, isComment, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isString, isTopLevelFunctionDefinition, isVariable, isVariableDefinition } from './node-types';
import { LspDocument, LspDocuments } from '../document';
import { FishProtocol } from './fishProtocol';
import { getPrecedingComments, getRange, getRangeWithPrecedingComments } from './tree-sitter';
import * as LocationNamespace from './locations';
import os from 'os';
import { isBuiltin } from './builtins';

const RE_PATHSEP_WINDOWS = /\\/g;

export function isUri(stringUri: string): boolean {
  const uri = URI.parse(stringUri);
  return URI.isUri(uri);
}

export function uriToPath(stringUri: string): string {
  const uri = URI.parse(stringUri);
  return normalizeFsPath(uri.fsPath);
}

export function pathToUri(filepath: string, documents?: LspDocuments | undefined): string {
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

export function pathToRelativeFunctionName(uriPath: string): string {
  const relativeName = uriPath.split('/').at(-1) || uriPath;
  return relativeName.replace('.fish', '');
}

export function uriInUserFunctions(uri: string) {
  const path = uriToPath(uri);
  return path?.startsWith(`${os.homedir}/.config/fish`) || false;
}

export function nodeToSymbolInformation(node: SyntaxNode, uri: string): SymbolInformation {
  let name = node.text;
  const kind = toSymbolKind(node);
  const range = getRange(node);
  switch (kind) {
    case SymbolKind.Namespace:
      name = pathToRelativeFunctionName(uri);
      break;
    case SymbolKind.Function:
    case SymbolKind.Variable:
    case SymbolKind.File:
    case SymbolKind.Class:
    case SymbolKind.Null:
    default:
      break;
  }
  return SymbolInformation.create(name, kind, range, uri);
}

export function nodeToDocumentSymbol(node: SyntaxNode): DocumentSymbol {
  const name = node.text;
  let detail = node.text;
  const kind = toSymbolKind(node);
  let range = getRange(node);
  const selectionRange = getRange(node);
  const children: DocumentSymbol[] = [];
  let parent = node.parent || node;
  switch (kind) {
    case SymbolKind.Variable:
      parent = findParentVariableDefinitionKeyword(node) || node;
      detail = getPrecedingComments(parent);
      range = getRange(parent);
      break;
    case SymbolKind.Function:
      detail = getPrecedingComments(parent);
      range = getRange(parent);
      break;
    case SymbolKind.File:
    case SymbolKind.Class:
    case SymbolKind.Namespace:
    case SymbolKind.Null:
    default:
      break;
  }
  return DocumentSymbol.create(name, detail, kind, range, selectionRange, children);
}

export function createRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): LSP.Range {
  return {
    start: {
      line: startLine,
      character: startCharacter,
    },
    end: {
      line: endLine,
      character: endCharacter,
    },
  };
}

export function toSelectionRange(range: SelectionRange): SelectionRange {
  const span = LocationNamespace.Range.toTextSpan(range.range);
  return SelectionRange.create(
    LocationNamespace.Range.fromTextSpan(span),
    range.parent ? toSelectionRange(range.parent) : undefined,
  );
}

export function toTextEdit(edit: FishProtocol.CodeEdit): TextEdit {
  return {
    range: {
      start: LocationNamespace.Position.fromLocation(edit.start),
      end: LocationNamespace.Position.fromLocation(edit.end),
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

export function toFoldingRange(node: SyntaxNode, document: LspDocument): FoldingRange {
  let collapsedText: string = '';
  let _kind = FoldingRangeKind.Region;
  if (isFunctionDefinition(node) || isFunctionDefinitionName(node.firstNamedChild!)) {
    collapsedText = node.firstNamedChild?.text || node.text.split(' ')[0]?.toString() || '';
  }
  if (isScope(node)) {
    collapsedText = node.text;
  }
  if (isVariableDefinition(node)) {
    collapsedText = node.text;
  }
  if (isComment(node)) {
    collapsedText = node.text.slice(0, 10);
    if (node.text.length >= 10) {
      collapsedText += '...';
    }
    _kind = FoldingRangeKind.Comment;
  }
  const range = getRangeWithPrecedingComments(node);
  const startLine = range.start.line;
  const endLine = range.end.line > 0 && document.getText(LSP.Range.create(
    LSP.Position.create(range.end.line, range.end.character - 1),
    range.end,
  )) === 'end' ? Math.max(range.end.line + 1, range.start.line) : range.end.line;
  return {
    ...FoldingRange.create(startLine, endLine),
    collapsedText: collapsedText,
    kind: FoldingRangeKind.Region,
  };
}

export function toLspDocument(filename: string, content: string): LspDocument {
  const doc = TextDocumentItem.create(pathToUri(filename), 'fish', 0, content);
  return new LspDocument(doc);
}

export function toSymbolKind(node: SyntaxNode): SymbolKind {
  if (isVariable(node)) {
    return SymbolKind.Variable;
  } else if (isFunctionDefinitionName(node)) { // change from isFunctionDefinition(node)
    return SymbolKind.Function;
  } else if (isString(node)) {
    return SymbolKind.String;
  } else if (isProgram(node) || isFunctionDefinition(node) || isStatement(node)) {
    return SymbolKind.Namespace;
  } else if (isBuiltin(node.text) || isCommandName(node) || isCommand(node)) {
    return SymbolKind.Class;
  }
  return SymbolKind.Null;
}

/**
 *  Pretty much just for logging a symbol kind
 */
export function symbolKindToString(kind: SymbolKind) {
  switch (kind) {
    case SymbolKind.Variable:
      return 'variable';
    case SymbolKind.Function:
      return 'function';
    case SymbolKind.String:
      return 'string';
    case SymbolKind.Namespace:
      return 'namespace';
    case SymbolKind.Class:
      return 'class';
    case SymbolKind.Null:
      return 'null';
    default:
      return 'other';
  }
}

/**
 * @param node - SyntaxNode toSymbolKind/symbolKindToString wrapper for both
 *               `string` and `number` type
 * @returns {
 *    kindType: toSymbolKind(node)  ->  13 | 12 | 15 | 3 | 5 | 21
 *    kindString: symbolKindToString(kindType) -> number
 *  }
 */
export function symbolKindsFromNode(node: SyntaxNode): { kindType: SymbolKind; kindString: string; } {
  const kindType = toSymbolKind(node);
  const kindString = symbolKindToString(kindType);
  return {
    kindType,
    kindString,
  };
}

export type AutoloadType = 'conf.d' | 'functions' | 'completions' | 'config' | '';
export type AutoloadFunctionCallback = (n: SyntaxNode) => boolean;
/**
 * Closure for checking if a documents `node.type === function_definition` is
 * autoloaded. Callback checks the `document.uri` for determining which
 * autoloaded type to check for.
 * ___
 * @param document - LspDocument to check if it is autoloaded
 * @returns (n: SyntaxNode) => boolean - true if the document is autoloaded
 */
export function isAutoloadedUriLoadsFunction(document: LspDocument): (n: SyntaxNode) => boolean {
  const callbackmap: Record<AutoloadType, (n: SyntaxNode) => boolean> = {
    'conf.d': (node: SyntaxNode) => isTopLevelFunctionDefinition(node) && isFunctionDefinition(node),
    config: (node: SyntaxNode) => isTopLevelFunctionDefinition(node) && isFunctionDefinition(node),
    functions: (node: SyntaxNode) => {
      if (isTopLevelFunctionDefinition(node) && isFunctionDefinition(node)) {
        return node.firstChild?.text === document.getAutoLoadName();
      }
      return false;
    },
    completions: (_: SyntaxNode) => false,
    '': (_: SyntaxNode) => false,
  };

  return callbackmap[document.getAutoloadType()];
}
/**
 * The nodes that are considered autoloaded functions are the firstNamedChild of
 * a `function_definition` node. This is because the firstNamedChild is the
 * function's name (skipping the `function` keyword).
 * ___
 * Closure for checking if a documents `node.parent.type === function_definition`
 * is autoloaded. Callback checks the `document.uri` for determining which
 * autoloaded type to check for.
 * ___
 * @param document - LspDocument to check if it is autoloaded
 * @returns (n: SyntaxNode) => boolean - true if function name is autoloaded in the document
 */
export function isAutoloadedUriLoadsFunctionName(document: LspDocument): (n: SyntaxNode) => boolean {
  const callbackmap: Record<AutoloadType, (n: SyntaxNode) => boolean> = {
    'conf.d': (node: SyntaxNode) => isTopLevelFunctionDefinition(node) && isFunctionDefinitionName(node),
    config: (node: SyntaxNode) => isTopLevelFunctionDefinition(node) && isFunctionDefinitionName(node),
    functions: (node: SyntaxNode) => {
      if (isTopLevelFunctionDefinition(node) && isFunctionDefinitionName(node)) {
        return node?.text === document.getAutoLoadName();
      }
      return false;
    },
    completions: (_: SyntaxNode) => false,
    '': (_: SyntaxNode) => false,
  };
  return callbackmap[document.getAutoloadType()];
}
export function shouldHaveAutoloadedFunction(document: LspDocument): boolean {
  return 'functions' === document.getAutoloadType();
}

export function formatTextWithIndents(doc: LspDocument, line: number, text: string) {
  const indent = doc.getIndentAtLine(line);
  return text
    .split('\n')
    .map(line => indent + line)
    .join('\n');
}
