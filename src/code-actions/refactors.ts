import os from 'os';
import { ChangeAnnotation, CodeAction, CodeActionKind, CreateFile, Range, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { findParentCommand, isCommand, isCommandWithName, isFunctionDefinitionName, isIfStatement } from '../utils/node-types';
import { SupportedCodeActionKinds } from './action-kinds';
import { convertIfToCombinersString } from './combiner';
import path from 'path';
import { pathToUri } from '../utils/translation';
import { logger } from '../logger';

/**
 * Notice how this file compared to the other code-actions, uses a node as it's parameter
 * This is because the reafactors are not based on diagnostics. However, if we need to use
 * a diagnostic for some reason, we can always pass its `Document.data.node` property.
 *
 * This section is very much still a WIP, so there are definitely some improvements
 * to be made.
 */

export function createRefactorAction(
  title: string,
  kind: CodeActionKind,
  edits: { [uri: string]: TextEdit[]; },
  preferredAction = false,
): CodeAction {
  return {
    title,
    kind,
    edit: { changes: edits },
    isPreferred: preferredAction,
  };
}

export function extractFunctionWithArgparseToCompletionsFile(
  document: LspDocument,
  range: Range,
  node: SyntaxNode,
) {
  logger.log('extractFunctionWithArgparseToCompletionsFile', document, range, { node: { text: node.text, type: node.type } });

  let selectedNode = node;
  if (isFunctionDefinitionName(node)) {
    selectedNode = node.parent!;
  }
  if (selectedNode.type !== 'function_definition') return;
  const hasArgparse = getChildNodes(selectedNode).some(n => isCommandWithName(n, 'argparse'));
  if (!hasArgparse) return;

  const functionName = getChildNodes(selectedNode).find(n => isFunctionDefinitionName(n))!.text;
  const autoloadType = document.getAutoloadType();
  /** cancel if we're not in an autoloaded file */
  if (functionName !== document.getAutoLoadName() || !['functions', 'config.fish'].includes(autoloadType)) return;

  const completionPath = path.join(os.homedir(), '.config', 'fish', 'completions', `${functionName}.fish`);
  const completionUri = pathToUri(completionPath);

  const changeAnnotation: ChangeAnnotation = {
    label: `Create completions for '${functionName}' in file: ${completionPath}`,
    description: `Create completions for '${functionName}' to file: ${completionPath}`,
  };

  const createFileAction = CreateFile.create(completionUri, { ignoreIfExists: true, overwrite: false });

  // Get the selected text
  const selectedText = `complete -c ${functionName}`;
  const createFileEdit = TextDocumentEdit.create(
    VersionedTextDocumentIdentifier.create(completionUri, 0),
    [TextEdit.insert({ line: 0, character: 0 }, selectedText)]);

  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      createFileAction,
      createFileEdit,
    ],
    changeAnnotations: { [changeAnnotation.label]: changeAnnotation },
  };

  return {
    title: `Create completions for '${functionName}' in file: ${completionPath}`,
    kind: SupportedCodeActionKinds.RefactorExtract,
    edit: workspaceEdit,
  } as CodeAction;
}

export function extractFunctionToFile(
  document: LspDocument,
  range: Range,
  node: SyntaxNode,
) {
  logger.log('extractFunctionToFile', document, range, { node: { text: node.text, type: node.type } });

  let selectedNode = node;
  if (isFunctionDefinitionName(node)) {
    selectedNode = node.parent!;
  }
  if (selectedNode.type !== 'function_definition') return;

  const functionName = getChildNodes(selectedNode).find(n => isFunctionDefinitionName(n))!.text;
  // cancel if we're already in the file
  if (functionName === document.getAutoLoadName()) return;
  const functionPath = path.join(os.homedir(), '.config', 'fish', 'functions', `${functionName}.fish`);
  const functionUri = pathToUri(functionPath);

  const changeAnnotation: ChangeAnnotation = {
    label: `Extract function '${functionName}' to file: ${functionPath}`,
    description: `Extract function '${functionName}' to file: ${functionPath}`,
  };

  const createFileAction = CreateFile.create(functionUri, { ignoreIfExists: false, overwrite: true });

  // Get the selected text
  const selectedText = document.getText(getRange(selectedNode));
  const createFileEdit = TextDocumentEdit.create(
    VersionedTextDocumentIdentifier.create(functionUri, 0),
    [TextEdit.insert({ line: 0, character: 0 }, selectedText)]);

  const removeOldFunction = TextDocumentEdit.create(
    VersionedTextDocumentIdentifier.create(document.uri, document.version),
    [TextEdit.del(getRange(selectedNode))]);

  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      createFileAction,
      createFileEdit,
      removeOldFunction,
    ],
    changeAnnotations: { [changeAnnotation.label]: changeAnnotation },
  };

  return {
    title: `Extract function '${functionName}' to file: ${functionPath}`,
    kind: SupportedCodeActionKinds.RefactorExtract,
    edit: workspaceEdit,
  } as CodeAction;
}

export function extractToFunction(
  document: LspDocument,
  range: Range,
): CodeAction | undefined {
  logger.log('extractToFunction', document, range);
  // Generate a unique function name
  const functionName = `extracted_function_${Math.floor(Math.random() * 1000)}`;

  // Get the selected text
  const selectedText = document.getText(range);

  // Create the new function
  const functionText = [
    `\nfunction ${functionName}`,
    ...selectedText.split('\n').map(line => `    ${line}`), // Indent the function body
    'end\n',
  ].join('\n');

  // Insert the new function before the current scope
  const insertEdit = TextEdit.insert(
    { line: range.start.line, character: 0 },
    `\n${functionText}\n`,
  );

  // Replace the selected text with a call to the new function
  const replaceEdit = TextEdit.replace(range, `${functionName}`);

  return createRefactorAction(
    `Extract to local function '${functionName}'`,
    SupportedCodeActionKinds.RefactorExtract,
    {
      [document.uri]: [replaceEdit, insertEdit],
    },
  );
}

export function extractCommandToFunction(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  logger.log('extractCommandToFunction', document, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });
  // Generate a unique function name
  const functionName = `extracted_function_${Math.floor(Math.random() * 1000)}`;

  let cmd = selectedNode;
  if (selectedNode.type !== 'command') {
    cmd = findParentCommand(selectedNode) || selectedNode;
  }
  if (!cmd) return;

  // Get the selected text
  const selectedText = document.getText(getRange(cmd));
  // Create the new function
  const functionText = [
    `\nfunction ${functionName}`,
    ...selectedText.split('\n').map(line => `    ${line}`), // Indent the function body
    'end\n',
  ].join('\n');

  // Replace the selected text with a call to the new function
  const replaceEdit = TextEdit.replace(getRange(cmd), `${functionName}`);

  // Insert the new function before the current scope
  // const insertPosition = getRange(selectedNode).start;
  const insertEdit = TextEdit.insert(
    { line: document.getLines(), character: 0 },
    `\n${functionText}\n`,
  );

  return createRefactorAction(
    `Extract command to local function '${functionName}'`,
    SupportedCodeActionKinds.RefactorExtract,
    {
      [document.uri]: [replaceEdit, insertEdit],
    },

  );
}

export function extractToVariable(
  document: LspDocument,
  range: Range,
  selectedNode: SyntaxNode,
): CodeAction | undefined {
  logger.log('extractToVariable', document, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });
  // Only allow extracting commands or expressions
  if (!isCommand(selectedNode)) return undefined;

  const selectedText = document.getText(range);
  const varName = `extracted_var_${Math.floor(Math.random() * 1000)}`;

  // Create variable declaration
  const declaration = `set -l ${varName} (${selectedText})\n`;

  // Replace original text with variable
  const replaceEdit = TextEdit.replace(range, declaration);

  return createRefactorAction(
    `Extract selected '${selectedNode.firstNamedChild!.text}' command to local variable '${varName}'`,
    SupportedCodeActionKinds.RefactorExtract,
    {
      [document.uri]: [replaceEdit],
    },
  );
}

export function convertIfToCombiners(
  document: LspDocument,
  selectedNode: SyntaxNode,
): CodeAction | undefined {
  logger.log('convertIfToCombiners', document, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });
  let node = selectedNode;
  if (node.type === 'if' && !isIfStatement(node)) {
    node = node.parent!;
  }
  if (!isIfStatement(node)) return undefined;
  const combinerString = convertIfToCombinersString(node);
  return createRefactorAction(
    `Convert selected if statement to conditionally executed statement (line: ${node.startPosition.row + 1})`,
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [TextEdit.replace(getRange(node), combinerString)],
    },
    true, // Mark as preferred action
  );
}
