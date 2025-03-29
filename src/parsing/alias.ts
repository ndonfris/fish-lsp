import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import * as Alias from '../utils/alias-helpers';
import { getRange } from '../utils/tree-sitter';
import { isCommandWithName, isConcatenation, isString, isTopLevelDefinition } from '../utils/node-types';

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

/**
 * TODO: remove this function from ../utils/node-types.ts `isAliasName`
 * checks if a node is the firstNamedChild of an alias command
 *
 * alias ls='ls -G'
 *        ^-- cursor is here
 *
 * alias cls 'command ls'
 *       ^-- cursor is here
 */
export function isAliasDefinitionName(node: SyntaxNode) {
  if (isString(node) || isConcatenation(node)) return false;
  if (!node.parent) return false;
  // concatenated node is an alias with `=`
  const isConcatenated = isConcatenation(node.parent);
  // if the parent is a concatenation node, then move up to it's parent
  let parentNode = node.parent;
  // if that is the case, then we need to move up 1 more parent
  if (isConcatenated) parentNode = parentNode.parent as SyntaxNode;
  if (!parentNode || !isCommandWithName(parentNode, 'alias')) return false;
  // since there is two possible cases, handle concatenated and non-concatenated differently
  const firstChild = isConcatenated
    ? parentNode.firstNamedChild
    : parentNode.firstChild;
  // skip `alias` named node, since it's not the alias name
  if (firstChild && firstChild.equals(node)) return false;
  const args = parentNode.childrenForFieldName('argument');
  // first element is args is the alias name
  const aliasName = isConcatenated
    ? args.at(0)?.firstChild
    : args.at(0);
  return !!aliasName && aliasName.equals(node);
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
