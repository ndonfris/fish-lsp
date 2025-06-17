import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope, getScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { getRange } from '../utils/tree-sitter';
import { isCommandWithName, isConcatenation, isString, isTopLevelDefinition } from '../utils/node-types';
import { isBuiltin } from '../utils/builtins';
import { md } from '../utils/markdown-builder';
import { flattenNested } from '../utils/flatten';

export type FishAliasInfoType = {
  name: string;
  value: string;
  prefix: 'builtin' | 'command' | '';
  wraps: string | null;
  hasEquals: boolean;
};

export namespace FishAlias {

  /**
   * Checks if a node is an alias command.
   */
  export function isAlias(node: SyntaxNode): boolean {
    return isCommandWithName(node, 'alias');
  }

  /**
   * Extracts the alias name and value from a SyntaxNode representing an alias command.
   * Handles both formats:
   * - alias name=value
   * - alias name value
   */
  export function getInfo(node: SyntaxNode): {
    name: string;
    value: string;
    prefix: 'builtin' | 'command' | '';
    wraps: string | null;
    hasEquals: boolean;
  } | null {
    if (!isCommandWithName(node, 'alias')) return null;

    const firstArg = node.firstNamedChild?.nextNamedSibling;
    if (!firstArg) return null;

    let name: string;
    let value: string;
    let hasEquals: boolean;

    // Handle both alias formats
    if (firstArg.text.includes('=')) {
      // Format: alias name=value
      const [nameStr, ...valueParts] = firstArg.text.split('=');
      // Return null if name or value is empty
      if (!nameStr || valueParts.length === 0) return null;

      name = nameStr;
      value = valueParts.join('=').replace(/^['"]|['"]$/g, '');
      hasEquals = true;
    } else {
      // Format: alias name value
      const valueNode = firstArg.nextNamedSibling;
      if (!valueNode) return null;

      name = firstArg.text;
      value = valueNode.text.replace(/^['"]|['"]$/g, '');
      hasEquals = false;
    }

    // Determine prefix for recursive command prevention
    const words = value.split(/\s+/);
    const firstWord = words.at(0);
    const lastWord = words.at(-1);

    // Determine prefix for recursive command prevention
    let prefix: 'builtin' | 'command' | '' = '';
    if (firstWord === name) {
      prefix = isBuiltin(name) ? 'builtin' : 'command';
    }

    // Determine if we should include wraps
    // Do not wrap if alias foo 'foo xyz' or alias foo 'sudo foo'
    const shouldWrap = firstWord !== name && lastWord !== name;
    const wraps = shouldWrap ? value : null;

    return {
      name,
      value,
      prefix,
      wraps,
      hasEquals,
    };
  }

  /**
   * Converts a SyntaxNode representing an alias command into a function definition.
   * The function definition includes:
   * - function name
   * - optional --wraps flag
   * - description
   * - function body
   */
  export function toFunction(node: SyntaxNode): string | null {
    const aliasInfo = getInfo(node);
    if (!aliasInfo) return null;

    const { name, value, prefix, wraps, hasEquals } = aliasInfo;

    // Escape special characters in the value for both the wraps and description
    const escapedValue = value.replace(/'/g, "\\'");

    // Build the description string that matches fish's alias format
    const description = hasEquals ?
      `alias ${name}=${escapedValue}` :
      `alias ${name} ${escapedValue}`;

    // Build the function components
    const functionParts = [
      `function ${name}`,
      wraps ? `--wraps='${escapedValue}'` : '',
      `--description '${description}'`,
    ].filter(Boolean).join(' ');

    // Build the function body with optional prefix
    const functionBody = prefix ?
      `    ${prefix} ${value} $argv` :
      `    ${value} $argv`;

    // Combine all parts
    return [
      functionParts,
      functionBody,
      'end',
    ].join('\n');
  }

  export function getNameRange(node: SyntaxNode) {
    const aliasInfo = getInfo(node);
    if (!aliasInfo) return null;
    const nameNode = node.firstNamedChild?.nextNamedSibling;
    if (!nameNode) return null;
    if (!aliasInfo.hasEquals) {
      return getRange(nameNode);
    }
    const nameLength = aliasInfo.name.length;
    return {
      start: {
        line: nameNode.startPosition.row,
        character: nameNode.startPosition.column,
      },
      end: {
        line: nameNode.endPosition.row,
        character: nameNode.startPosition.column + nameLength,
      },
    };
  }

  export function buildDetail(node: SyntaxNode) {
    const aliasInfo = getInfo(node);

    if (!aliasInfo) return null;
    const { name } = aliasInfo;

    const detail = toFunction(node);
    if (!detail) return null;

    return [
      `(${md.italic('alias')}) ${name}`,
      md.separator(),
      md.codeBlock('fish', node.text),
      md.separator(),
      md.codeBlock('fish', detail),
    ].join('\n');
  }

  export function toFishDocumentSymbol(
    child: SyntaxNode,
    parent: SyntaxNode,
    document: LspDocument,
    children: FishSymbol[] = [],
  ): FishSymbol | null {
    const aliasInfo = getInfo(parent);
    if (!aliasInfo) return null;

    const { name } = aliasInfo;
    const detail = toFunction(parent);
    if (!detail) return null;

    const selectionRange = getNameRange(parent);
    if (!selectionRange) return null;

    const detailText = buildDetail(parent);
    if (!detailText) return null;

    return FishSymbol.fromObject({
      name,
      uri: document.uri,
      node: parent,
      focusedNode: child,
      detail: detailText,
      fishKind: 'ALIAS',
      range: getRange(parent),
      selectionRange,
      scope: getScope(document, child),
      children,
    });
  }
}

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

export function isAliasDefinitionValue(node: SyntaxNode) {
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
    ? parentNode.firstNamedChild?.nextNamedSibling
    : parentNode.firstChild;
  // skip `alias` named node, since it's not the alias name
  if (firstChild && firstChild.equals(node)) return false;
  const args = flattenNested(...parentNode.childrenForFieldName('argument'))
    .filter(a => a.isNamed);

  // first element is args is the alias name
  // logger.debug('alias args', args.map(a => a.text));
  const aliasValue = args.at(-1);
  return !!aliasValue && aliasValue.equals(node);
}

export function processAliasCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = getAliasScopeModifier(document, node);
  const definitionNode = node.firstNamedChild!;
  const info = FishAlias.getInfo(node);
  const detail = FishAlias.buildDetail(node);
  const nameRange = FishAlias.getNameRange(node);
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

