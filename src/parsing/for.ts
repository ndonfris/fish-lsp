import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
// import { isTopLevelDefinition } from '../utils/node-types';

export function isForVariableDefinitionName(node: SyntaxNode): boolean {
  if (node.parent && node.parent.type === 'for_statement') {
    return !!node.parent.firstNamedChild &&
      node.parent.firstNamedChild.type === 'variable_name' &&
      node.parent.firstNamedChild.equals(node);
  }
  return false;
}

// function getForScopeModifier(document: LspDocument, node: SyntaxNode): 'local' {
//   const autoloadType = document.getAutoloadType();
//   switch (autoloadType) {
//     case 'conf.d':
//     case 'config':
//       return 'local';
//     case 'functions':
//       return 'local';
//     default:
//       return 'local';
//   }
// }

export function processForDefinition(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = 'local';
  const definitionNode = node.firstNamedChild!;
  const definitionScope = DefinitionScope.create(node, modifier);
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
