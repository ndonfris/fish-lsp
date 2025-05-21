import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';

export function isForVariableDefinitionName(node: SyntaxNode): boolean {
  if (node.parent && node.parent.type === 'for_statement') {
    return !!node.parent.firstNamedChild &&
      node.parent.firstNamedChild.type === 'variable_name' &&
      node.parent.firstNamedChild.equals(node);
  }
  return false;
}

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
