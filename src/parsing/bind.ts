import { SyntaxNode } from 'web-tree-sitter';
import { findOptions, Option } from './options';
import { findParentCommand, isCommandWithName, isFunctionDefinitionName } from '../utils/node-types';

export const BindOptions = [
  Option.create('-f', '--function-names'),
  Option.create('-K', '--key-names'),
  Option.create('-L', '--list-modes'),
  Option.create('-M', '--mode').withValue(),
  Option.create('-m', '--new-mode').withValue(),
  Option.create('-e', '--erase'),
  Option.create('-a', '--all'),
  Option.long('--preset').withAliases('--user'),
  Option.create('-s', '--silent'),
  Option.create('-h', '--help'),
];

export function isBindCommand(node: SyntaxNode) {
  return isCommandWithName(node, 'bind');
}

export function isBindKeySequence(node: SyntaxNode) {
  const parent = findParentCommand(node);
  if (!parent || !isBindCommand(parent)) {
    return false;
  }
  const children = parent.namedChildren.slice(1);
  const optionResults = findOptions(children, BindOptions);
  const { remaining } = optionResults;
  return remaining.at(0)?.equals(node);
}

export function isBindFunctionCall(node: SyntaxNode) {
  const parent = findParentCommand(node);
  if (!parent || !isBindCommand(parent)) {
    return false;
  }
  const children = parent.namedChildren.slice(1);
  const optionResults = findOptions(children, BindOptions);
  const { remaining } = optionResults;
  const functionCalls = remaining.slice(1);
  return functionCalls.some(child => isFunctionDefinitionName(child) && child.equals(node));
}
