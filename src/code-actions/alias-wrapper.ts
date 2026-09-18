import * as os from 'os';
import { CodeAction, CreateFile, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { getRange } from '../utils/tree-sitter';
import { LspDocument } from '../document';
import { runEmbeddedFish } from '../utils/exec';
import { join } from 'path';
import { SupportedCodeActionKinds } from './action-kinds';
import { pathToUri } from '../utils/translation';
import { isOption } from '../utils/node-types';
import { safeFishSource } from '../utils/safe-fish-source';
import AliasFunction from '../../fish_files/alias-function.fish';

/**
 * Extracts the function name from an alias node
 * ---
 *
 * ```fish
 * # handles both cases
 * alias name='cmd'
 * alias name 'cmd'
 * ```
 *
 * ---
 * @param node The alias node
 * @returns The function name
 */
function extractFunctionName(node: SyntaxNode): string {
  const children = node.children;
  if (children.length < 2) return '';

  const nameNode = children[1];
  if (!nameNode) return '';

  // Handle both formats: alias name='cmd' and alias name 'cmd'
  const name = nameNode.text.split('=')[0]?.toString() || '';
  return name.trim();
}

/**
 * The function (fish_indent-ed, without its `# Defined via` line) that the `alias`
 * command `node` would define. Never runs the file's `alias` line: `alias` `source`s
 * its body, so `alias x='end; rm …; function y'` would run `rm`. Each argument reaches
 * fish as `safeFishSource()`, and `alias-function.fish` prints what `alias` would source.
 */
async function aliasFunctionText(node: SyntaxNode): Promise<string> {
  const args = node.childrenForFieldName('argument')
    .filter(arg => !isOption(arg)) // e.g. `--save` (writing the function to disk)
    .map(arg => safeFishSource(arg));
  const { stdout } = await runEmbeddedFish(AliasFunction, args);
  return stdout.trim();
}

/**
 * Creates a quick-fix code action to convert an alias to a function inline
 * This action will replace the alias line with the function content.
 */
export async function createAliasInlineAction(
  doc: LspDocument,
  node: SyntaxNode,
): Promise<CodeAction | undefined> {
  const funcName = extractFunctionName(node);

  if (!funcName) {
    return undefined;
  }

  const stdout = await aliasFunctionText(node);
  const edit = TextEdit.replace(
    getRange(node),
    `\n${stdout}\n`,
  );

  return {
    title: `Convert alias '${funcName}' to inline function`,
    kind: SupportedCodeActionKinds.RefactorExtract,
    edit: {
      changes: {
        [doc.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

function createVersionedDocument(uri: string) {
  return VersionedTextDocumentIdentifier.create(uri, 0);
}

function createFunctionFileEdit(functionUri: string, content: string) {
  return TextDocumentEdit.create(
    createVersionedDocument(functionUri),
    [TextEdit.insert({ line: 0, character: 0 }, content)],
  );
}

function createRemoveAliasEdit(document: LspDocument, node: SyntaxNode) {
  return TextDocumentEdit.create(
    createVersionedDocument(document.uri),
    [TextEdit.del(getRange(node))],
  );
}

/**
 * Creates a quick-fix code action to convert an alias to a function file.
 */
export async function createAliasSaveActionNewFile(
  doc: LspDocument,
  node: SyntaxNode,
): Promise<CodeAction> {
  const funcName = extractFunctionName(node);

  // Get function content but remove first line (function declaration) and indent
  const functionContent = await aliasFunctionText(node);

  // Create path for new function file
  const functionPath = join(os.homedir(), '.config', 'fish', 'functions', `${funcName}.fish`);
  const functionUri = pathToUri(functionPath);

  const createFileAction = CreateFile.create(functionUri, {
    ignoreIfExists: false,
    overwrite: true,
  });

  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      createFileAction,
      createFunctionFileEdit(functionUri, functionContent),
      createRemoveAliasEdit(doc, node),
    ],
  };

  return {
    title: `Convert alias '${funcName}' to function in file: ~/.config/fish/functions/${funcName}.fish`,
    kind: SupportedCodeActionKinds.RefactorExtract,
    edit: workspaceEdit,
    isPreferred: false,
  };
}

/**
 * Extra exports for testing purposes
 */
export const AliasHelper = {
  extractFunctionName,
  createAliasInlineAction,
  createAliasSaveActionNewFile,
} as const;
