import { SyntaxNode } from 'web-tree-sitter';
import { Option, isMatchingOption, findMatchingOptions } from './options';
import { isOption, isCommandWithName, isString, isTopLevelDefinition, findParent, isProgram, isFunctionDefinition, hasParentFunction } from '../utils/node-types';
import { FishSymbol, SetModifierToScopeTag } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope } from '../utils/definition-scope';

export const ReadOptions = [
  Option.create('-U', '--universal'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
  Option.create('-g', '--global'),
  Option.create('-u', '--unexport'),
  Option.create('-x', '--export'),
  Option.create('-c', '--command').withValue(),
  Option.create('-s', '--silent'),
  Option.create('-p', '--prompt').withValue(),
  Option.create('-P', '--prompt-str').withValue(),
  Option.create('-R', '--right-prompt').withValue(),
  Option.create('-S', '--shell'),
  Option.create('-d', '--delimiter').withValue(),
  Option.create('-n', '--nchars').withValue(),
  Option.create('-t', '--tokenize'),
  Option.create('-a', '--list').withAliases('--array'),
  Option.create('-z', '--null'),
  Option.create('-L', '--line'),
  Option.create('-h', '--help'),
];

export const ReadModifiers = [
  Option.create('-U', '--universal'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
  Option.create('-g', '--global'),
];

/**
 * checks if a node is the variable name of a read command
 * read -g -x -p 'stuff' foo bar baz
 *                        ^   ^   ^
 *                        |   |   |
 *                     cursor could be here
 */
export function isReadVariableDefinitionName(node: SyntaxNode) {
  if (!node.parent || !isReadDefinition(node.parent)) return false;
  const { definitionNodes } = findReadChildren(node.parent);
  return !!definitionNodes.find(n => n.equals(node));
}

export function isReadDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'read') && !node.children.some(child => isMatchingOption(child, Option.create('-q', '--query')));
}

function getFallbackModifierScope(document: LspDocument, node: SyntaxNode) {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
    case 'functions':
      return isTopLevelDefinition(node) ? 'global' : hasParentFunction(node) ? 'function' : 'inherit';
    case 'completions':
      return isTopLevelDefinition(node) ? 'local' : hasParentFunction(node) ? 'function' : 'local';
    case '':
      return 'local';
    default:
      return 'inherit';
  }
}

/**
 * Find all the read command's children that are variable names
 * @param node The node to check isCommandWithName(node, 'read')
 * @returns nodes that are variable names and the modifier if seen
 */
function findReadChildren(node: SyntaxNode): { definitionNodes: SyntaxNode[]; modifier: Option | undefined; } {
  let modifier: Option | undefined = undefined;
  const definitionNodes: SyntaxNode[] = [];
  const allFocused: SyntaxNode[] = node.childrenForFieldName('argument')
    .filter((n) => {
      switch (true) {
        case isMatchingOption(n, Option.create('-l', '--local')):
        case isMatchingOption(n, Option.create('-f', '--function')):
        case isMatchingOption(n, Option.create('-g', '--global')):
        case isMatchingOption(n, Option.create('-U', '--universal')):
          modifier = findMatchingOptions(n, ...ReadModifiers);
          return false;
        case isMatchingOption(n, Option.create('-c', '--command')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-d', '--delimiter')):
        case isMatchingOption(n, Option.create('-d', '--delimiter')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-n', '--nchars')):
        case isMatchingOption(n, Option.create('-n', '--nchars')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-p', '--prompt')):
        case isMatchingOption(n, Option.create('-p', '--prompt')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-P', '--prompt-str')):
        case isMatchingOption(n, Option.create('-P', '--prompt-str')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-R', '--right-prompt')):
        case isMatchingOption(n, Option.create('-R', '--right-prompt')):
          return false;
        case isMatchingOption(n, Option.create('-s', '--silent')):
        case isMatchingOption(n, Option.create('-S', '--shell')):
        case isMatchingOption(n, Option.create('-t', '--tokenize')):
        case isMatchingOption(n, Option.create('-u', '--unexport')):
        case isMatchingOption(n, Option.create('-x', '--export')):
        case isMatchingOption(n, Option.create('-a', '--list')):
        case isMatchingOption(n, Option.create('-z', '--null')):
        case isMatchingOption(n, Option.create('-L', '--line')):
          return false;
        default:
          return true;
      }
    });

  allFocused.forEach((arg) => {
    if (isOption(arg)) return;
    if (isString(arg)) return;
    definitionNodes.push(arg);
  });
  return {
    definitionNodes,
    modifier,
  };
}

/**
 * Get all read command variable names as `FishSymbol[]`
 */
export function processReadCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const result: FishSymbol[] = [];
  const { definitionNodes, modifier } = findReadChildren(node);
  const scopeModifier = modifier ? SetModifierToScopeTag(modifier) : getFallbackModifierScope(document, node);
  const definitionScope = scopeModifier === 'global'
    ? DefinitionScope.create(findParent(node, isProgram)!, scopeModifier)
    : DefinitionScope.create(findParent(node, isFunctionDefinition || isProgram)!, scopeModifier);

  for (const arg of definitionNodes) {
    if (arg.text.startsWith('$')) continue;
    result.push(FishSymbol.create(arg.text, node, arg, 'READ', document, document.uri, node.text, definitionScope, children));
  }

  return result;
}
