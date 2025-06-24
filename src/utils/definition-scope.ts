import { SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types';
import { isAutoloadedUriLoadsAliasName, isAutoloadedUriLoadsFunctionName } from './translation';
import { firstAncestorMatch, getRange, isPositionWithinRange, getParentNodes } from './tree-sitter';
import { Position, Location, DocumentUri } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { FishSymbol } from '../parsing/symbol';

export type ScopeTag = 'global' | 'universal' | 'local' | 'function' | 'inherit';
export interface DefinitionScope {
  uri: string;
  scopeNode: SyntaxNode;
  scopeTag: ScopeTag;
}

export class DefinitionScope {
  constructor(
    public scopeNode: SyntaxNode,
    public scopeTag: ScopeTag) { }

  static create(
    scopeNode: SyntaxNode,
    scopeTag: 'global' | 'universal' | 'local' | 'function' | 'inherit'
  ): DefinitionScope {
    return new DefinitionScope(scopeNode, scopeTag);
  }

  containsPosition(position: Position) {
    return isPositionWithinRange(position, getRange(this.scopeNode));
  }

  isBeforePosition(position: Position) {
    return this.scopeNode.startPosition.row < position.line ||
      this.scopeNode.startPosition.row === position.line && this.scopeNode.startPosition.column < position.character;
  }

  isAfterPosition(position: Position) {
    return this.scopeNode.endPosition.row > position.line ||
      this.scopeNode.endPosition.row === position.line && this.scopeNode.endPosition.column > position.character;
  }

  isBeforeNode(node: SyntaxNode) {
    const range = getRange(node);
    return this.scopeNode.startPosition.row < range.start.line ||
      this.scopeNode.startPosition.row === range.start.line && this.scopeNode.startPosition.column < range.start.character;
  }

  isAfterNode(node: SyntaxNode) {
    const range = getRange(node);
    return this.scopeNode.endPosition.row > range.end.line ||
      this.scopeNode.endPosition.row === range.end.line && this.scopeNode.endPosition.column > range.end.character;
  }

  containsNode(node: SyntaxNode) {
    const range = getRange(node);
    return this.containsPosition(range.start);
  }

  get tag() {
    const tag = this.scopeTag;
    return DefinitionScope.ScopeTags[tag] || 0;
  }

  static get ScopeTags() {
    return {
      universal: 5,
      global: 4,
      function: 3,
      local: 2,
      inherit: 1,
      '': 0
    } as const;
  }
}

export class VariableDefinitionFlag {
  public short: string;
  public long: string;

  constructor(short: string, long: string) {
    this.short = short;
    this.long = long;
  }

  isMatch(node: SyntaxNode) {
    if (!NodeTypes.isOption(node)) {
      return false;
    }
    if (NodeTypes.isShortOption(node)) {
      return node.text.slice(1).split('').includes(this.short);
    }
    if (NodeTypes.isLongOption(node)) {
      return node.text.slice(2) === this.long;
    }
    return false;
  }

  get kind() {
    return this.long;
  }
}

const variableDefinitionFlags = [
  new VariableDefinitionFlag('g', 'global'),
  new VariableDefinitionFlag('l', 'local'),
  new VariableDefinitionFlag('', 'inherit'),
  //new VariableDefinitionFlag('x', 'export'),
  new VariableDefinitionFlag('f', 'function'),
  new VariableDefinitionFlag('U', 'universal'),
];

const hasParentFunction = (node: SyntaxNode) => {
  return !!firstAncestorMatch(node, NodeTypes.isFunctionDefinition);
};

function getMatchingFlags(focusedNode: SyntaxNode, nodes: SyntaxNode[]) {
  for (const node of nodes) {
    const match = variableDefinitionFlags.find(flag => flag.isMatch(node));
    if (match) {
      return match;
    }
  }
  return hasParentFunction(focusedNode)
    ? new VariableDefinitionFlag('f', 'function')
    : new VariableDefinitionFlag('', 'inherit');
}

function findScopeFromFlag(node: SyntaxNode, flag: VariableDefinitionFlag) {
  let scopeNode: SyntaxNode | null = node.parent!;
  let scopeFlag = flag.kind;
  switch (flag.kind) {
    case 'global':
      scopeNode = firstAncestorMatch(node, NodeTypes.isProgram);
      scopeFlag = 'global';
      break;
    case 'universal':
      scopeNode = firstAncestorMatch(node, NodeTypes.isProgram);
      scopeFlag = 'universal';
      break;
    case 'local':
      scopeNode = firstAncestorMatch(node, NodeTypes.isScope);
      //scopeFlag = 'local'
      break;
    case 'function':
      scopeNode = firstAncestorMatch(node, NodeTypes.isFunctionDefinition);
      scopeFlag = 'function';
      break;
    case 'for_scope':
      scopeNode = firstAncestorMatch(node, NodeTypes.isFunctionDefinition);
      scopeFlag = 'function';
      if (!scopeNode) {
        scopeNode = firstAncestorMatch(node, NodeTypes.isProgram);
        scopeFlag = 'global';
      }
      break;
    case 'inherit':
      scopeNode = firstAncestorMatch(node, NodeTypes.isScope);
      scopeFlag = 'inherit';
      break;
    default:
      scopeNode = firstAncestorMatch(node, NodeTypes.isScope);
      //scopeFlag = 'local'
      break;
  }

  const finalScopeNode = scopeNode || node.parent!;
  return DefinitionScope.create(finalScopeNode, scopeFlag as ScopeTag);
}

export function getVariableScope(node: SyntaxNode) {
  const definitionNodes: SyntaxNode[] = expandEntireVariableLine(node);
  const keywordNode = definitionNodes[0]!;

  let matchingFlag = null;

  switch (keywordNode.text) {
    case 'for':
      matchingFlag = new VariableDefinitionFlag('', 'for_scope');
      break;
    case 'set':
    case 'read':
    case 'function':
    default:
      matchingFlag = getMatchingFlags(node, definitionNodes);
      break;
  }

  const scope = findScopeFromFlag(node, matchingFlag);
  return scope;
}

export function getScope(document: LspDocument, node: SyntaxNode) {
  if (NodeTypes.isAliasDefinitionName(node)) {
    const isAutoloadedName = isAutoloadedUriLoadsAliasName(document);
    if (isAutoloadedName(node)) {
      return DefinitionScope.create(node, 'global')!;
    }
    const parents = getParentNodes(node.parent!.parent!) || getParentNodes(node.parent!);
    const firstParent = parents
      .filter(n => NodeTypes.isProgram(n) || NodeTypes.isFunctionDefinition(n))
      .at(0)!;

    return DefinitionScope.create(firstParent, 'local')!;
  } else if (NodeTypes.isFunctionDefinitionName(node)) {
    const isAutoloadedName = isAutoloadedUriLoadsFunctionName(document);
    // gets <HERE> from ~/.config/fish/functions/<HERE>.fish
    // const loadedName = pathToRelativeFunctionName(uri);

    // we know node.parent must exist because a isFunctionDefinitionName() must have
    // a isFunctionDefinition() parent node. We know there must be atleast one parent
    // because isProgram()  is a valid parent node.
    const parents = getParentNodes(node.parent!.parent!) || getParentNodes(node.parent!);
    const firstParent = parents
      .filter(n => NodeTypes.isProgram(n) || NodeTypes.isFunctionDefinition(n))
      .at(0)!;

    // if the function name is autoloaded or in config.fish
    if (isAutoloadedName(node)) {
      const program = firstAncestorMatch(node, NodeTypes.isProgram)!;
      return DefinitionScope.create(program, 'global')!;
    }
    return DefinitionScope.create(firstParent, 'local')!;
  } else if (NodeTypes.isVariableDefinitionName(node)) {
    return getVariableScope(node);
  }

  // should not ever happen with current LSP implementation
  const scope = firstAncestorMatch(node, NodeTypes.isScope)!;
  return DefinitionScope.create(scope, 'local');
}

export function expandEntireVariableLine(node: SyntaxNode): SyntaxNode[] {
  const results: SyntaxNode[] = [node];

  let current = node.previousSibling;
  while (current !== null) {
    if (!current || NodeTypes.isNewline(current)) {
      break;
    }
    results.unshift(current);
    current = current.previousSibling;
  }

  current = node.nextSibling;
  while (current !== null) {
    if (!current || NodeTypes.isNewline(current)) {
      break;
    }
    results.push(current);
    current = current.nextSibling;
  }

  return results;
}

export function setQuery(searchNodes: SyntaxNode[]) {
  const queryFlag = new VariableDefinitionFlag('q', 'query');
  for (const flag of searchNodes) {
    if (queryFlag.isMatch(flag)) {
      return true;
    }
  }
  return false;
}

// export function patchScopes(symbols: FishSymbol[]) {
//   for (const symbol of symbols) {
//     const equalSymbols = symbol.children.filter(child => 
//       child.kind === symbol.kind && child.name === symbol.name && child.scopeContainsNode()
//     )
//   }
// }
