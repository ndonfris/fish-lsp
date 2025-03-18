import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import * as Alias from '../utils/alias-helpers';
import { getRange } from '../utils/tree-sitter';
import { isTopLevelDefinition } from '../utils/node-types';

function getAliasScopeModifier(document: LspDocument, node: SyntaxNode) {
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

export function processAliasCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = getAliasScopeModifier(document, node);
  const definitionNode = node.firstNamedChild!;
  const info = Alias.FishAlias.getInfo(node);
  const detail = Alias.FishAlias.buildDetail(node);
  const nameRange = Alias.FishAlias.getNameRange(node);
  if (!info || !detail) return [];
  return [
    FishSymbol.fromObject({
      name: info.name,
      node,
      focusedNode: definitionNode,
      range: getRange(node),
      selectionRange: nameRange || getRange(definitionNode),
      fishKind: 'ALIAS',
      uri: document.uri,
      detail,
      scope: DefinitionScope.create(node.parent!, modifier),
      children,
    }),
  ];
}
