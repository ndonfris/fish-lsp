import { DocumentSymbol, DocumentUri, SelectionRange, SymbolInformation, SymbolKind, TextDocumentItem } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { URI } from 'vscode-uri';
import { findParentVariableDefinitionKeyword, isCommand, isCommandName, isFunctionDefinition, isFunctionDefinitionName, isProgram, isStatement, isString, isTopLevelDefinition, isTopLevelFunctionDefinition, isVariable } from './node-types';
import { LspDocument, LspDocuments } from '../document';
import { getPrecedingComments, getRange } from './tree-sitter';
import * as LocationNamespace from './locations';
import * as os from 'os';
import { isBuiltin } from './builtins';
import { env } from './env-manager';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceUri } from './workspace';

const RE_PATHSEP_WINDOWS = /\\/g;

export function isUri(stringOrUri: unknown): stringOrUri is DocumentUri {
  if (typeof stringOrUri !== 'string') {
    return false;
  }
  const uri = URI.parse(stringOrUri);
  return URI.isUri(uri);
}

/** a string that is a path to a file, not a uri */
export type PathLike = string;
export function isPath(pathOrUri: unknown): pathOrUri is PathLike {
  return typeof pathOrUri === 'string' && !isUri(pathOrUri);
}

/**
 * Type guard to check if an object is a TextDocument from vscode-languageserver-textdocument
 *
 * @param value The value to check
 * @returns True if the value is a TextDocument, false otherwise
 */
export function isTextDocument(value: unknown): value is TextDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    // TextDocument has these properties
    typeof (value as TextDocument).uri === 'string' &&
    typeof (value as TextDocument).languageId === 'string' &&
    typeof (value as TextDocument).version === 'number' &&
    typeof (value as TextDocument).lineCount === 'number' &&
    // TextDocument has these methods
    typeof (value as TextDocument).getText === 'function' &&
    typeof (value as TextDocument).positionAt === 'function' &&
    typeof (value as TextDocument).offsetAt === 'function' &&
    // TextDocumentItem has direct 'text' property, TextDocument doesn't
    (value as any).text === undefined
  );
}

/**
 * Type guard to check if an object is a TextDocumentItem from vscode-languageserver
 *
 * @param value The value to check
 * @returns True if the value is a TextDocumentItem, false otherwise
 */
export function isTextDocumentItem(value: unknown): value is TextDocumentItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    // TextDocumentItem has these properties
    typeof (value as TextDocumentItem).uri === 'string' &&
    typeof (value as TextDocumentItem).languageId === 'string' &&
    typeof (value as TextDocumentItem).version === 'number' &&
    typeof (value as TextDocumentItem).text === 'string' &&
    // TextDocument has these methods, TextDocumentItem doesn't
    (value as any).getText === undefined &&
    (value as any).positionAt === undefined &&
    (value as any).offsetAt === undefined &&
    (value as any).lineCount === undefined
  );
}

export function uriToPath(stringUri: DocumentUri): PathLike {
  const uri = URI.parse(stringUri);
  return normalizeFsPath(uri.fsPath);
}

export function pathToUri(filepath: PathLike, documents?: LspDocuments | undefined): DocumentUri {
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
export function normalizePath(filePath: PathLike): PathLike {
  const fsPath = URI.file(filePath).fsPath;
  return normalizeFsPath(fsPath);
}

/**
 * Normalizes the path obtained through the "fsPath" property of the URI module.
 */
export function normalizeFsPath(fsPath: string): string {
  return fsPath.replace(RE_PATHSEP_WINDOWS, '/');
}

export function pathToRelativeFunctionName(filepath: PathLike): string {
  const relativeName = filepath.split('/').at(-1) || filepath;
  return relativeName.replace('.fish', '');
}

export function uriInUserFunctions(uri: DocumentUri) {
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
 * Converts a URI to a more readable path by replacing known prefixes with fish variables
 * or ~ for home directory.
 *
 * @param uri The URI to convert to a readable path
 * @returns A more readable path using fish variables or tilde when possible
 */
export function uriToReadablePath(uri: DocumentUri | WorkspaceUri): string {
  // First convert URI to filesystem path
  const path = uriToPath(uri);

  // Try to replace with fish variables first
  const autoloadedKeys = env.getAutoloadedKeys();
  for (const key of autoloadedKeys) {
    const values = env.getAsArray(key);

    for (const value of values) {
      if (path.startsWith(value)) {
        return path.replace(value, `$${key}`);
      }
    }
  }

  // If no fish variables match, try to replace home directory with tilde
  const homeDir = os.homedir();
  if (path.startsWith(homeDir)) {
    return path.replace(homeDir, '~');
  }

  // Return the original path if no substitutions were made
  return path;
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

export function isAutoloadedUriLoadsAliasName(document: LspDocument): (n: SyntaxNode) => boolean {
  const callbackmap: Record<AutoloadType, (n: SyntaxNode) => boolean> = {
    'conf.d': (node: SyntaxNode) => isTopLevelDefinition(node),
    config: (node: SyntaxNode) => isTopLevelDefinition(node),
    functions: (_: SyntaxNode) => false,
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
