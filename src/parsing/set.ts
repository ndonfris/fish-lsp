import { SyntaxNode } from 'web-tree-sitter';
import { isOption, isCommandWithName, isTopLevelDefinition, findParentCommand, isConditionalCommand, hasParentFunction, findParentWithFallback, isFunctionDefinition, isScope } from '../utils/node-types';
import { Option, findOptions, findOptionsSet, isMatchingOption } from './options';
import { LspDocument } from '../document';
import { FishSymbol, ModifierScopeTag, SetModifierToScopeTag } from './symbol';
import { DefinitionScope, ScopeTag } from '../utils/definition-scope';

export const SetOptions = [
  Option.create('-U', '--universal'),
  Option.create('-g', '--global'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
  Option.create('-x', '--export'),
  Option.create('-u', '--unexport'),
  Option.long('--path'),
  Option.long('--unpath'),
  Option.create('-a', '--append'),
  Option.create('-p', '--prepend'),
  Option.create('-e', '--erase'),
  Option.create('-q', '--query'),
  Option.create('-n', '--names'),
  Option.create('-S', '--show'),
  Option.long('--no-event'),
  Option.create('-L', '--long'),
  Option.create('-h', '--help'),
];

// const setModifiers = SetOptions.filter(option => option.equalsRawLongOption('--universal', '--global', '--function', '--local'));
export const SetModifiers = [
  Option.create('-U', '--universal'),
  Option.create('-g', '--global'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
];

export function isSetDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'set') && !node.children.some(child => isMatchingOption(child, Option.create('-q', '--query'), Option.create('-n', '--names'), Option.create('-S', '--show'), Option.create('-e', '--erase')));
}

export function isSetQueryDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'set') && node.children.some(child => isMatchingOption(child, Option.create('-q', '--query')));
}

/**
 * checks if a node is the variable name of a set command
 * set -g -x foo '...'
 *           ^-- cursor is here
 */
export function isSetVariableDefinitionName(node: SyntaxNode, excludeQuery = true) {
  if (!node.parent || !isSetDefinition(node.parent)) return false;
  if (excludeQuery && isSetQueryDefinition(node.parent)) return false;
  const searchNodes = findSetChildren(node.parent);
  const definitionNode = searchNodes.find(n => !isOption(n));
  return !!definitionNode && definitionNode.equals(node);
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

export function findSetChildren(node: SyntaxNode) {
  const children = node.childrenForFieldName('argument');
  const firstNonOption = children.findIndex(child => !isOption(child));
  return children.slice(0, firstNonOption + 1);
}

export function setModifierDetailDescriptor(node: SyntaxNode) {
  const options = findOptions(node.childrenForFieldName('argument'), SetModifiers);
  const exportedOption = options.found.find(o => o.option.equalsRawOption('-x', '--export') || o.option.equalsRawOption('-u', '--unexport'));
  const exportedStr = exportedOption ? exportedOption.option.isOption('-x', '--export') ? 'exported' : 'unexported' : '';
  const modifier = options.found.find(o => o.option.equalsRawOption('-U', '-g', '-f', '-l'));
  if (modifier) {
    switch (true) {
      case modifier.option.isOption('-U', '--universal'):
        return ['universally scoped', exportedStr].filter(Boolean).join('; ');
      case modifier.option.isOption('-g', '--global'):
        return ['globally scoped', exportedStr].filter(Boolean).join('; ');
      case modifier.option.isOption('-f', '--function'):
        return ['function scoped', exportedStr].filter(Boolean).join('; ');
      case modifier.option.isOption('-l', '--local'):
        return ['locally scoped', exportedStr].filter(Boolean).join('; ');
      default:
        return ['', exportedStr].filter(Boolean).join('; ');
    }
  }
  return ['', exportedStr].filter(Boolean).join('; ');
}

function findParentScopeNode(commandNode: SyntaxNode, modifier: ModifierScopeTag): SyntaxNode {
  switch (modifier) {
    case 'universal':
    case 'global':
    case 'function':
      return findParentWithFallback(commandNode, (n) => isFunctionDefinition(n));
    case 'inherit':
    case 'local':
    default:
      return findParentWithFallback(commandNode, (n) => isScope(n));
  }
}

export function processSetCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  /** skip `set -q/--query` && `set -e/--erase` */
  if (!isSetDefinition(node)) return [];
  // create the searchNodes, which are the nodes after the command name, but before the variable name
  const searchNodes = findSetChildren(node);
  // find the definition node, which should be the last node of the searchNodes
  const definitionNode = searchNodes.find(n => !isOption(n));

  const skipText: string[] = ['-', '$', '('];
  if (
    !definitionNode
    || definitionNode.type === 'concatenation' // skip `set -e FOO[1]`
    || skipText.some(t => definitionNode.text.startsWith(t)) // skip `set $FOO`, `set (FOO)`, `set -`
  ) return [];

  const modifierOption = findOptionsSet(searchNodes, SetModifiers).pop();
  let modifier = 'local' as ScopeTag;
  if (modifierOption) {
    modifier = SetModifierToScopeTag(modifierOption.option) as ScopeTag;
  } else {
    modifier = getFallbackModifierScope(document, node) as ScopeTag;
  }

  const options = findOptionsSet(searchNodes, SetOptions).map(o => o.option);

  const scopeNode = findParentScopeNode(node, modifier);

  // fix conditional_command scoping to use the parent command
  // of the conditional_execution statement, so that
  // we can reference the variable in the parent scope
  let parentNode = findParentCommand(node.parent || node) || node.parent || node;
  if (parentNode && isConditionalCommand(parentNode)) {
    while (parentNode && isConditionalCommand(parentNode)) {
      if (parentNode.type === 'function_definition') break;
      if (!parentNode.parent) break;
      parentNode = parentNode.parent;
    }
  }

  return [
    FishSymbol.create(
      definitionNode.text.toString(),
      node,
      definitionNode,
      'SET',
      document,
      document.uri,
      node.text.toString(),
      DefinitionScope.create(scopeNode, modifier),
      options,
      children,
    ),
  ];
}
