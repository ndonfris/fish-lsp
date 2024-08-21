import { SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types';
import { pathToRelativeFunctionName } from './translation';
import { firstAncestorMatch, getRange, isPositionWithinRange, getParentNodes, positionToPoint, pointToPosition, isNodeWithinRange } from './tree-sitter';
import { Position } from 'vscode-languageserver';

export type ScopeTag = 'global'  | 'local' | 'function' | 'inherit';
export interface DefinitionScope {
  scopeNode: SyntaxNode;
  scopeTag: ScopeTag;
  containsPosition: (position: Position) => boolean;
  containsNode: (node: SyntaxNode) => boolean;
}

export namespace DefinitionScope {
  export function create(scopeNode: SyntaxNode, scopeTag: ScopeTag): DefinitionScope {
    return {
      scopeNode,
      scopeTag,
      containsPosition: (position: Position) => isPositionWithinRange(position, getRange(scopeNode)),
      containsNode: (node: SyntaxNode) => isNodeWithinRange(node, getRange(scopeNode))
    };
  }
}

// @TODO: 
//    use NodeTypes.isMatchingOption(node, {...}) instead of this class
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
    // case 'for_scope':
    //   scopeNode = firstAncestorMatch(node, NodeTypes.isFunctionDefinition);
    //   scopeFlag = 'function';
    //   if (!scopeNode) {
    //     scopeNode = firstAncestorMatch(node, NodeTypes.isProgram);
    //     scopeFlag = 'global';
    //   }
    //   break;
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

function  getUriScopeType(uri: string) {
  const uriParts = uri.split('/');
  if (uriParts.at(-2)?.includes('functions')) {
    return 'function';
  }
  if (uriParts.at(-1) === 'config.fish' || uriParts.at(-2) === '.conf.d') {
    return 'config';
  }
  return 'local';
}

function getNodeScopeType(node: SyntaxNode) {
  if (NodeTypes.isFunctionDefinitionName(node)) {
    return 'function';
  }
  if (NodeTypes.isVariableDefinitionName(node)) {
    return 'variable';
  }
  return 'unknown';
}

function getFunctionScope(node: SyntaxNode) {
  let current = node;
  while (current !== null) {
    if (NodeTypes.isFunctionDefinition(current) || NodeTypes.isProgram(current)) {
      return current
    }
    current = current.parent!;
  }
  return null;
}

export function getScope(uri: string, node: SyntaxNode) {
  const nodeType = getNodeScopeType(node);
  const uriType = getUriScopeType(uri);
  if (nodeType === 'function') {
    const parent = node.parent!.parent!;
    const scopeNode = getFunctionScope(parent!);
    if (!scopeNode) return DefinitionScope.create(parent, 'local'); 

    /**
     * creates a global/function scopeTag for functions in config.fish or conf.d/*.fish
     */
    if (uriType === 'config') {
      /**
       * scopeTag is 'global' if the function is called from root level
       * scopeTag is 'function' if the function is nested in another function
       */
      const scopeTag = NodeTypes.isProgram(scopeNode) ? 'global' : 'function';
      return DefinitionScope.create(scopeNode, scopeTag);

    /**
     * creates a global/function/local scopeTag for functions in functions/*.fish
     */
    } else if (uriType === 'function') {
      const functionName = pathToRelativeFunctionName(uri);
      /**
       * scopeTag is 'global' if the function name is the same as the function definition
       * scopeTag is 'function' if the function nested in another function
       * scopeTag is 'local' if the function is in the same file but not nested
       */
      const scopeTag = 
        NodeTypes.isProgram(scopeNode) && functionName === node.text ? 'global' : 
        NodeTypes.isFunctionDefinition(scopeNode) ? 'function' : 'local';

      return DefinitionScope.create(scopeNode, scopeTag);
    } else {
      return DefinitionScope.create(scopeNode, 'local');
    }
  } else if (nodeType === 'variable') {
    return getVariableScope(node);
  } else {
    // should not ever happen with current LSP implementation
    return DefinitionScope.create(node, 'local');
  }

  // if (NodeTypes.isFunctionDefinitionName(node)) {
  //   // gets <HERE> from ~/.config/fish/functions/<HERE>.fish
  //   const loadedName = pathToRelativeFunctionName(uri);
  //
  //   // we know node.parent must exist because a isFunctionDefinitionName() must have
  //   // a isFunctionDefinition() parent node. We know there must be atleast one parent
  //   // because isProgram()  is a valid parent node.
  //   const firstParent = getParentNodes(node.parent!)
  //     .filter(n => NodeTypes.isProgram(n) || NodeTypes.isFunctionDefinition(n))
  //     .at(0)!;
  //
  //   // if the function name is autoloaded or in config.fish
  //   if (loadedName === node.text || loadedName === 'config') {
  //     const program = firstAncestorMatch(node, NodeTypes.isProgram)!;
  //     return DefinitionScope.create(program, 'global')!;
  //   }
  //   return DefinitionScope.create(firstParent, 'local')!;
  // } else if (NodeTypes.isVariableDefinitionName(node)) {
  //   return getVariableScope(node);
  // }
  //
  // // should not ever happen with current LSP implementation
  // const scope = firstAncestorMatch(node, NodeTypes.isScope)!;
  // return DefinitionScope.create(scope, 'local');
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

// @TODO 
//      skip queries and use NodeTypes.isMatchingOption(node, {...}) instead
export function setQuery(searchNodes: SyntaxNode[]) {
  const queryFlag = new VariableDefinitionFlag('q', 'query');
  for (const flag of searchNodes) {
    if (queryFlag.isMatch(flag)) {
      return true;
    }
  }
  return false;
}