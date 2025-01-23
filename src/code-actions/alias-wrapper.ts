import os from 'os';
import { CodeAction, CreateFile, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { getRange } from '../utils/tree-sitter';
import { LspDocument } from '../document';
import { execAsyncF } from '../utils/exec';
import { join } from 'path';
import { SupportedCodeActionKinds } from './action-kinds';
import { pathToUri } from '../utils/translation';

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
 * Creates a quick-fix code action to convert an alias to a function inline
 * This action will replace the alias line with the function content.
 */
export async function createAliasInlineAction(
  node: SyntaxNode,
  doc: LspDocument,
): Promise<CodeAction> {
  const aliasCommand = node.text;
  const funcName = extractFunctionName(node);

  const stdout = await execAsyncF(`${aliasCommand} && functions ${funcName} | tail +2 | fish_indent`);
  const edit = TextEdit.replace(
    getRange(node),
    `\n${stdout}\n`,
  );

  return {
    title: `Convert alias '${funcName}' to inline function`,
    kind: SupportedCodeActionKinds.QuickFix,
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
  node: SyntaxNode,
  doc: LspDocument,
): Promise<CodeAction> {
  const aliasCommand = node.text;
  const funcName = extractFunctionName(node);

  // Get function content but remove first line (function declaration) and indent
  const functionContent = await execAsyncF(`${aliasCommand} && functions ${funcName} | tail +2 | fish_indent`);

  // Create path for new function file
  const functionPath = join(os.homedir(), '.config', 'fish', 'functions', `${funcName}.fish`);
  const functionUri = pathToUri(functionPath);

  // const createFileAction = OptionalVersionedTextDocumentIdentifier.create(functionUri, null)

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

  // // Create workspace edit
  // const workspaceEdit: WorkspaceEdit = {
  //   documentChanges: [
  //     // Create the new function file
  //     {
  //       kind: 'create',
  //       uri: functionUri,
  //       options: {
  //         overwrite: true,
  //         ignoreIfExists: false,
  //       },
  //     } as CreateFile,
  //     // Add content to the new file
  //     {
  //       textDocument: {
  //         uri: functionUri,
  //         version: 1,
  //       },
  //       edits: [
  //         {
  //           range: {
  //             start: { line: 0, character: 0 },
  //             end: { line: 0, character: 0 },
  //           },
  //           newText: functionContent,
  //         },
  //       ],
  //     },
  //     // Remove the alias line from the current document
  //     {
  //       textDocument: {
  //         uri: doc.uri,
  //         version: doc.version + 1,
  //       },
  //       edits: [
  //         {
  //           range: getRange(node),
  //           newText: '',  // Replace the alias line with empty string
  //         },
  //       ],
  //     },
  //   ],
  // };

  return {
    title: `Convert alias '${funcName}' to function in file: ~/.config/fish/functions/${funcName}.fish`,
    kind: SupportedCodeActionKinds.QuickFix,
    edit: workspaceEdit,
    isPreferred: false,
  };
}
