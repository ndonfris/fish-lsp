import { SyntaxNode } from 'web-tree-sitter';
import { Diagnostic } from 'vscode-languageserver';
import { findParentCommand, isVariableDefinition } from '../utils/node-types';
import { createDiagnostic } from './create';
import * as errorCodes from './errorCodes';
import { LspDocument } from '../document';
import { findFirstNamedSibling } from '../utils/tree-sitter';

function getUniversalOption(node: SyntaxNode): SyntaxNode | null {
  const cmd = findParentCommand(node);
  if (!cmd) {
    return null;
  }
  if (!['set', 'read'].includes(cmd.firstChild?.text || '')) {
    return null;
  }
  for (const child of cmd.children) {
    const text = child.text;
    if (text === '--universal') {
      return child;
    }
    if (text.startsWith('--')) {
      continue;
    }
    if (text.startsWith('-') && text.includes('U')) {
      return child;
    }
  }
  return null;
}

export function getUniversalVariableDiagnostics(node: SyntaxNode, document: LspDocument): Diagnostic | null {
  if (!isVariableDefinition(node)) {
    return null;
  }
  const isUniveralOption = (n: SyntaxNode) => {
    if (n.text.startsWith('--')) {
      return n.text === '--universal';
    }
    if (!n.text.startsWith('--') && n.text.startsWith('-')) {
      return n.text.includes('U');
    }
    return false;
  };
  const universalFlag = findFirstNamedSibling(node, isUniveralOption);
  return universalFlag ? createDiagnostic(universalFlag, errorCodes.universalVariable, document) : null;
}

