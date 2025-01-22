import os from 'os';
import { CodeAction, CodeActionKind, CreateFile, Diagnostic, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorCodes } from '../diagnostics/errorCodes';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { LspDocument } from '../document';
import { isBuiltin } from '../utils/builtins';
import { execAsyncF } from '../utils/exec';
import { join, resolve } from 'path';
import { SupportedCodeActionKinds } from './action-kinds';
import { pathToUri } from '../utils/translation';

/**
 * Extracts the alias command and its value from an alias command node
 * Handles both formats:
 * - alias ll='ls -l'
 * - alias ll 'ls -l'
 */
export function extractAliasInfo(node: SyntaxNode): { command: string; value: string; } | null {
  const children = getChildNodes(node);
  if (children.length < 3) return null;

  // Skip 'alias' command name
  let command: string | undefined;
  let value: string | undefined;

  // Remove 'alias' from start if present and get rest of command
  const cmdText = children[1]?.text.replace(/^alias\s+/, '');
  if (!cmdText) return null;

  // Handle name=value format
  if (cmdText.includes('=')) {
    const [name, ...valueParts] = cmdText.split('=');
    command = name;
    value = valueParts.join('=');
  } else {
    // Handle name value format
    command = cmdText;
    value = children.slice(2).map(n => n.text).join(' ');
  }

  if (!command || !value) return null;

  // Remove surrounding quotes if present
  value = value.replace(/^['"]|['"]$/g, '');
  command = command.trim();

  return { command, value };
}

/**
 * Determines if a prefix (builtin/command) is needed and returns the appropriate one
 */
export function determinePrefix(aliasName: string, commandBody: string): string {
  // Get first word of the command
  const firstWord = commandBody.trim().split(/\s+/)[0];

  if (firstWord === aliasName) {
    return isBuiltin(aliasName) ? 'builtin' : 'command';
  }

  return '';
}

/**
 * Determines if --wraps flag should be added
 */
export function shouldAddWraps(aliasName: string, commandBody: string): boolean {
  const words = commandBody.trim().split(/\s+/);
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  return firstWord !== aliasName && lastWord !== aliasName;
}

/**
 * Creates a function definition string from alias command and value
 */
export function createFunctionDefinition(aliasName: string, commandBody: string): string {
  const prefix = determinePrefix(aliasName, commandBody);
  const wrapsFlag = shouldAddWraps(aliasName, commandBody) ?
    `--wraps ${JSON.stringify(commandBody)}` : '';

  const description = `--description ${JSON.stringify(`alias ${aliasName}=${commandBody}`)}`;

  return [
    `function ${aliasName} ${wrapsFlag} ${description}`,
    `    ${prefix ? prefix + ' ' : ''}${commandBody} $argv`,
    'end',
  ].join('\n');
}

/**
 * Converts an alias diagnostic to a code action that replaces it with a function
 */
export function convertAliasToFunction(
  diagnostic: Diagnostic,
  node: SyntaxNode,
  document: LspDocument,
): CodeAction | null {
  // Verify this is an alias diagnostic
  if (diagnostic.code !== ErrorCodes.usedAlias) {
    return null;
  }

  const aliasInfo = extractAliasInfo(node);
  if (!aliasInfo) return null;

  const { command, value } = aliasInfo;
  const functionDef = createFunctionDefinition(command, value);

  const edit = TextEdit.replace(
    Range.create(
      diagnostic.range.start,
      diagnostic.range.end,
    ),
    functionDef,
  );

  return {
    title: `Convert alias '${command}' to function`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
  };
}

/**
 * Main handler function for code actions related to diagnostics
 */
export function handleDiagnosticCodeAction(
  diagnostic: Diagnostic,
  root: SyntaxNode,
  document: LspDocument,
): CodeAction | null {
  const node = getChildNodes(root).find(n =>
    n.startPosition.row === diagnostic.range.start.line &&
    n.startPosition.column === diagnostic.range.start.character,
  );

  if (!node) return null;

  switch (diagnostic.code) {
    case ErrorCodes.usedAlias:
      return convertAliasToFunction(diagnostic, node, document);
    default:
      return null;
  }
}

/**
 * Creates a code action that uses 'alias --save' and opens the resulting file
 */
export async function createAliasSaveAction(
  node: SyntaxNode,
  doc: LspDocument,
): Promise<CodeAction> {
  // Get the full alias command text
  const aliasCommand = node.text;

  // Add --save flag before any quoted parts
  const saveCommand = aliasCommand.replace(/(['"])/, '--save $1');

  // Execute the alias --save command
  await execAsyncF(saveCommand);

  // Extract function name to determine file path
  const funcName = extractFunctionName(node);
  const funcPath = resolve(os.homedir(), '.config/fish/functions', `${funcName}.fish`);

  return {
    title: `Save alias as function in ${funcPath} file`,
    kind: CodeActionKind.RefactorExtract,
    edit: {
      changes: {
        [doc.uri]: [TextEdit.del(getRange(node))],
      },
    },
    command: {
      title: 'Open saved function',
      command: 'fish-lsp.openSavedFunction',
      arguments: [funcPath],
    },
  };
}

function extractFunctionName(node: SyntaxNode): string {
  const children = node.children;
  if (children.length < 2) return '';

  const nameNode = children[1];
  if (!nameNode) return '';

  // Handle both formats: alias name='cmd' and alias name 'cmd'
  const name = nameNode.text.split('=')[0]?.toString() || '';
  return name.trim();
}

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
    title: 'Convert alias to function inline',
    kind: SupportedCodeActionKinds.QuickFix,
    edit: {
      changes: {
        [doc.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

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

  // Create workspace edit
  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      // Create the new function file
      {
        kind: 'create',
        uri: functionUri,
        options: {
          overwrite: true,
          ignoreIfExists: false,
        },
      } as CreateFile,
      // Add content to the new file
      {
        textDocument: {
          uri: functionUri,
          version: 1,
        },
        edits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: functionContent,
          },
        ],
      },
      // Remove the alias line from the current document
      {
        textDocument: {
          uri: doc.uri,
          version: doc.version + 1,
        },
        edits: [
          {
            range: getRange(node),
            newText: '',  // Replace the alias line with empty string
          },
        ],
      },
    ],
  };

  return {
    title: `Convert alias to function file: ~/.config/fish/functions/${funcName}.fish`,
    kind: SupportedCodeActionKinds.QuickFix,
    edit: workspaceEdit,
    isPreferred: false,
  };
}
