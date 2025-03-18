
import { SyntaxNode } from 'web-tree-sitter';
import { isOption, isCommandWithName, isTopLevelDefinition } from '../utils/node-types';
import { Option, findOptionsSet, isMatchingOption } from './options';
import { LspDocument } from '../document';
import { FishSymbol, SetModifierToScopeTag } from './symbol';
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

export function processSetCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const definitionNode = node.childrenForFieldName('argument')!.find(n => !isOption(n))!;
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

