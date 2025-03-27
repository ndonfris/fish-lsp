import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { isTopLevelDefinition } from '../utils/node-types';

export function isForDefinition(node: SyntaxNode) {
  return node.type === 'for_statement' && node.firstNamedChild && node.firstNamedChild.type === 'variable_name';
}

function getForScopeModifier(document: LspDocument, node: SyntaxNode) {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
      return isTopLevelDefinition(node) ? 'global' : 'local';
    case 'functions':
      return 'local';
    default:
      return 'local';
  }
}

export function processForDefinition(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = getForScopeModifier(document, node);
  const definitionNode = node.firstNamedChild!;
  const definitionScope = modifier === 'global'
    ? DefinitionScope.create(node.parent!, modifier)
    : DefinitionScope.create(node, modifier);
  return [
    FishSymbol.create(
      definitionNode.text,
      node,
      definitionNode,
      'FOR',
      document.uri,
      node.text,
      definitionScope,
      children,
    ),
  ];
}
