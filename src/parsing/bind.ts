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

/**
 * Checks if a node is a bind command. `bind ...`
 */
export function isBindCommand(node: SyntaxNode) {
  return isCommandWithName(node, 'bind');
}

/**
 * Checks if a node is a bind command's key sequence.
 * `bind -M insert ctrl-r ...` -> ctrl-r
 */
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

/**
 * Checks if a node is a bind command's function call, which
 * is any argument after the key sequence && bind options on
 * a `bind -M default ctrl-r cmd1 cmd2 cmd3` -> cmd1, cmd2, cmd3
 */
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
