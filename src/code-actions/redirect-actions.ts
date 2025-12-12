import { TextEdit } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { logger } from '../logger';
import { createRefactorAction } from './refactors';
import { SupportedCodeActionKinds } from './action-kinds';
import { findParentCommand, isCommand } from '../utils/node-types';

function selectCommandNode(node: SyntaxNode): SyntaxNode | null {
  let cmd = node;
  if (node.type !== 'command') {
    cmd = findParentCommand(node) || node;
  }
  if (!cmd || !isCommand(cmd)) return null;
  return cmd;
}

export function silenceCommandAction(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  logger.log('silence command', { document: document.uri }, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });

  const cmd = selectCommandNode(selectedNode);
  if (!cmd) return;

  const insertEdit = TextEdit.insert(
    { line: cmd.endPosition.row, character: cmd.endPosition.column },
    ' &>/dev/null',
  );

  return createRefactorAction(
    `Silence command '${cmd.firstNamedChild!.text} &>/dev/null' (line: ${cmd.startPosition.row + 1})`,
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [insertEdit],
    },
  );
}

export function silenceStderrCommandAction(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  logger.log('silence stderr command', { document: document.uri }, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });

  const cmd = selectCommandNode(selectedNode);
  if (!cmd) return;

  const insertEdit = TextEdit.insert(
    { line: cmd.endPosition.row, character: cmd.endPosition.column },
    ' 2>/dev/null',
  );

  return createRefactorAction(
    `Silence stderr of command '${cmd.firstNamedChild!.text} 2>/dev/null' (line: ${cmd.startPosition.row + 1})`,
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [insertEdit],
    },
  );
}

export function silenceStdoutCommandAction(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  logger.log('silence stdout command', { document: document.uri }, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });

  const cmd = selectCommandNode(selectedNode);
  if (!cmd) return;

  const insertEdit = TextEdit.insert(
    { line: cmd.endPosition.row, character: cmd.endPosition.column },
    ' >/dev/null',
  );

  return createRefactorAction(
    `Silence stdout of command '${cmd.firstNamedChild!.text} >/dev/null' (line: ${cmd.startPosition.row + 1})`,
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [insertEdit],
    },
  );
}

export function redirectStoutToStder(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  logger.log('redirect stdout to stderr command', { document: document.uri }, { selectedNode: { text: selectedNode.text, type: selectedNode.type } });

  const cmd = selectCommandNode(selectedNode);
  if (!cmd) return;

  const insertEdit = TextEdit.insert(
    { line: cmd.endPosition.row, character: cmd.endPosition.column },
    ' >&2',
  );

  return createRefactorAction(
    `Redirect stdout to stderr of command '${cmd.firstNamedChild!.text} >&2' (line: ${cmd.startPosition.row + 1})`,
    SupportedCodeActionKinds.RefactorRewrite,
    {
      [document.uri]: [insertEdit],
    },
  );
}

export function handleRedirectActions(
  document: LspDocument,
  selectedNode: SyntaxNode,
) {
  const actions = [];

  const silenceAction = silenceCommandAction(document, selectedNode);
  if (silenceAction) actions.push(silenceAction);

  const silenceStderrAction = silenceStderrCommandAction(document, selectedNode);
  if (silenceStderrAction) actions.push(silenceStderrAction);

  const silenceStdoutAction = silenceStdoutCommandAction(document, selectedNode);
  if (silenceStdoutAction) actions.push(silenceStdoutAction);

  const redirectStdoutAction = redirectStoutToStder(document, selectedNode);
  if (redirectStdoutAction) actions.push(redirectStdoutAction);

  return actions;
}
