import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';

// TODO think of better naming conventions for these functions
// TODO add symbols in sourced file to the current file in analysis
// TODO add sourced file to the current workspace

export function isSourceCommandName(node: SyntaxNode) {
  return isCommandWithName(node, 'source') || isCommandWithName(node, '.');
}

export function isSourceCommandWithArgument(node: SyntaxNode) {
  return isSourceCommandName(node) && node.childCount > 1;
}

export function isSourceCommandArgumentName(node: SyntaxNode) {
  if (node.parent && isSourceCommandWithArgument(node.parent)) {
    return node.parent?.child(1)?.equals(node) && node.isNamed;
  }
  return false;
}

export function isSourcedFilename(node: SyntaxNode) {
  if (node.parent && isSourceCommandName(node.parent)) {
    return node.parent?.child(1)?.equals(node) && node.isNamed;
  }
  return false;
}

export function isExistingSourceFilenameNode(node: SyntaxNode) {
  if (!isSourcedFilename(node)) return false;
  return SyncFileHelper.exists(node.text);
}

export function getExpandedSourcedFilenameNode(node: SyntaxNode) {
  if (isExistingSourceFilenameNode(node)) {
    return SyncFileHelper.expandEnvVars(node.text);
  }
  return undefined;
}
