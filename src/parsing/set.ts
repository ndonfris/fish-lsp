
import { SyntaxNode } from 'web-tree-sitter';
import { isOption, isCommandWithName, isTopLevelDefinition } from '../utils/node-types';
import { Option, findOptions, findOptionsSet, isMatchingOption } from './options';
import { LspDocument } from '../document';
import { FishSymbol, SetModifierToScopeTag } from './symbol';
import { DefinitionScope, ScopeTag } from '../utils/definition-scope';
import { md } from '../utils/markdown-builder';

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
  return isCommandWithName(node, 'set') && !node.children.some(child => isMatchingOption(child, Option.create('-q', '--query')));
}

function getFallbackModifierScope(document: LspDocument, node: SyntaxNode) {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
      return isTopLevelDefinition(node) ? 'global' : 'local';
    case 'functions':
    default:
      return 'local';
  }
}

export function findSetChildren(node: SyntaxNode) {
  const children = node.childrenForFieldName('argument');
  const firstNonOption = children.findIndex(child => !isOption(child));
  return children.slice(0, firstNonOption + 1);
}

export function setModifierDetailDescriptor(nodee: SyntaxNode) {
  const options = findOptions(nodee.childrenForFieldName('argument'), SetModifiers);
  const modifier = options.found.find(o => o.option.equalsRawOption('-U', '-g', '-f', '-l'));
  if (modifier) {
    switch (true) {
      case modifier.option.isOption('-U', '--universal'):
        return `${md.italic('scope')}: ${md.bold('universal')}`;
      case modifier.option.isOption('-g', '--global'):
        return `${md.italic('scope')}: ${md.bold('global')}`;
      case modifier.option.isOption('-f', '--function'):
        return `${md.italic('scope')}: ${md.bold('function')}`;
      case modifier.option.isOption('-l', '--local'):
        return `${md.italic('scope')}: ${md.bold('local')}`;
      default:
        return '';
    }
  }
  return '';
}

export function processSetCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  /** skip `set -q/--query` */
  if (!isSetDefinition(node)) return [];
  // create the searchNodes, which are the nodes after the command name, but before the variable name
  const searchNodes = findSetChildren(node);
  // find the definition node, which should be the last node of the searchNodes
  const definitionNode = searchNodes.find(n => !isOption(n))!;
  const modifierOption = findOptionsSet(node.childrenForFieldName('argument'), SetModifiers).pop();
  let modifier = 'local' as ScopeTag;
  if (modifierOption) {
    modifier = SetModifierToScopeTag(modifierOption.option) as ScopeTag;
  } else {
    modifier = getFallbackModifierScope(document, node) as ScopeTag;
  }
  return [
    FishSymbol.create(
      definitionNode.text,
      node,
      definitionNode,
      'SET',
      document.uri,
      node.text,
      DefinitionScope.create(node.parent!, modifier),
      children,
    ),
  ];
}
