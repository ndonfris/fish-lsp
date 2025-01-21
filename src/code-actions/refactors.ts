import { CodeAction, CodeActionKind, Range, TextEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { SyntaxNode } from 'web-tree-sitter';
import { getRange, getChildNodes } from '../utils/tree-sitter';
import { findParentCommand, isCommand, isIfStatement } from '../utils/node-types';
import { SupportedCodeActionKinds } from './action-kinds';

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

export function extractToFunction(
  document: LspDocument,
  range: Range,
  _selectedNode: SyntaxNode,
): CodeAction | undefined {
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
  // const insertPosition = getRange(selectedNode).start;
  const insertEdit = TextEdit.insert(
    { line: document.getLines(), character: 0 },
    `\n${functionText}\n`,
  );

  // Replace the selected text with a call to the new function
  const replaceEdit = TextEdit.replace(range, `${functionName}`);

  return createRefactorAction(
    `Extract to function '${functionName}'`,
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
    `Extract command to function '${functionName}'`,
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
  // Only allow extracting commands or expressions
  if (!isCommand(selectedNode)) return undefined;

  const selectedText = document.getText(range);
  const varName = `extracted_var_${Math.floor(Math.random() * 1000)}`;

  // Create variable declaration
  const declaration = `set -l ${varName} (${selectedText})\n`;

  // Replace original text with variable
  const replaceEdit = TextEdit.replace(range, declaration);

  return createRefactorAction(
    `Extract to variable '${varName}'`,
    SupportedCodeActionKinds.RefactorExtract,
    {
      [document.uri]: [replaceEdit],
    },
  );
}

/**
 * TODO - this is not ready yet. It has potential though.
 */
export function convertIfToCombiners(
  document: LspDocument,
  node: SyntaxNode,
): CodeAction | undefined {
  if (!isIfStatement(node)) return undefined;

  // Get the if condition and body
  const children = getChildNodes(node);
  const condition = children[1]; // First child after 'if'
  const body = children.slice(2, -1); // Everything between condition and 'end'

  if (!condition || body.length === 0) return undefined;

  // Convert to and/or format
  const conditionText = document.getText(getRange(condition));
  const bodyText = body.map(n => document.getText(getRange(n))).join('\n');

  // Create both versions (and/or) so user can choose
  const andVersion = `${conditionText} && begin\n${bodyText}\nend`;

  return createRefactorAction(
    'Convert if to combiners',
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [TextEdit.replace(getRange(node), andVersion)],
    },
    true, // Mark as preferred action
  );
}
