
import { SyntaxNode } from 'web-tree-sitter';
import { isOption, isCommandWithName } from '../utils/node-types';
import { Option } from './options';

export const CompleteOptions = [
  Option.create('-c', '--command').withValue(),
  Option.create('-p', '--path'),
  Option.create('-e', '--erase'),
  Option.create('-s', '--short-option').withValue(),
  Option.create('-l', '--long-option').withValue(),
  Option.create('-o', '--old-option').withValue(),
  Option.create('-a', '--arguments').withValue(),
  Option.create('-k', '--keep-order'),
  Option.create('-f', '--no-files'),
  Option.create('-F', '--force-files'),
  Option.create('-r', '--require-parameter'),
  Option.create('-x', '--exclusive'),
  Option.create('-d', '--description').withValue(),
  Option.create('-w', '--wraps').withValue(),
  Option.create('-n', '--condition').withValue(),
  Option.create('-C', '--do-complete').withValue(),
  Option.long('--escape').withValue(),
  Option.create('-h', '--help'),
];

export function isCompletionDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'complete');
}

// TODO
export function processCompletion(node: SyntaxNode) {
  if (!isCompletionDefinition(node)) {
    return;
  }

  const modifiers: SyntaxNode[] = [];
  const focuesedNodes = node.childrenForFieldName('argument');
  const definitionNodes = focuesedNodes.filter(n => !isOption(n));

  return {
    definitionNodes,
    modifiers,
  };
}

