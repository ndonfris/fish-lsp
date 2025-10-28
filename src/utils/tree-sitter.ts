import { extname } from 'path';
import { Position, Range, URI } from 'vscode-languageserver';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import { findSetDefinedVariable, isFunctionDefinition, isVariableDefinition, isFunctionDefinitionName, isVariable, isScope, isProgram, isCommandName, isForLoop, findForLoopVariable } from './node-types';
import { Maybe } from './maybe';

// You can add this as a utility function or extend it if needed
export function isSyntaxNode(obj: unknown): obj is SyntaxNode {
  return typeof obj === 'object'
    && obj !== null
    && 'id' in obj
    && 'type' in obj
    && 'text' in obj
    && 'tree' in obj
    && 'startPosition' in obj
    && 'endPosition' in obj
    && 'children' in obj
    && 'equals' in obj
    && 'isNamed' in obj
    && 'isMissing' in obj
    && 'isError' in obj
    && 'isExtra' in obj
    && typeof (obj as any).id === 'number'
    && typeof (obj as any).isNamed === 'boolean'
    && typeof (obj as any).isMissing === 'boolean'
    && typeof (obj as any).isError === 'boolean'
    && typeof (obj as any).isExtra === 'boolean'
    && typeof (obj as any).type === 'string'
    && typeof (obj as any).text === 'string'
    && typeof (obj as any).equals === 'function'
    && Array.isArray((obj as any).children);
}

/**
 * Returns an array for all the nodes in the tree (@see also nodesGen)
 *
 * @param {SyntaxNode} root - the root node to search from
 * @returns {SyntaxNode[]} all children of the root node (flattened)
 */
export function getChildNodes(root: SyntaxNode): SyntaxNode[] {
  const queue: SyntaxNode[] = [root];
  const result: SyntaxNode[] = [];
  while (queue.length) {
    const current : SyntaxNode | undefined = queue.shift();
    if (current) {
      result.push(current);
    }
    if (current && current.children) {
      queue.unshift(...current.children);
    }
  }
  return result;
}

export function getNamedChildNodes(root: SyntaxNode): SyntaxNode[] {
  const queue: SyntaxNode[] = [root];
  const result: SyntaxNode[] = [];
  while (queue.length) {
    const current : SyntaxNode | undefined = queue.shift();
    if (current && current.isNamed) {
      result.push(current);
    }
    if (current && current.children) {
      queue.unshift(...current.children);
    }
  }
  return result;
}

export function findChildNodes(root: SyntaxNode, predicate: (node: SyntaxNode) => boolean): SyntaxNode[] {
  const queue: SyntaxNode[] = [root];
  const result: SyntaxNode[] = [];
  while (queue.length) {
    const current : SyntaxNode | undefined = queue.shift();
    if (current && predicate(current)) {
      result.push(current);
    }
    if (current && current.children) {
      queue.unshift(...current.children);
    }
  }
  return result;
}

/**
 * Collect all nodes of specific types using breadth-first iteration
 * @param root - The root node to search from
 * @param types - Array of node types to collect
 * @returns Array of nodes matching the specified types
 */
export function collectNodesByTypes(root: SyntaxNode, types: string[]): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  const queue: SyntaxNode[] = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (types.includes(current.type)) {
      results.push(current);
    }

    queue.push(...current.namedChildren);
  }

  return results;
}

/**
 * Gets path to root starting where index 0 is child node passed in.
 * Format: [child, child.parent, ..., root]
 *
 * @param {SyntaxNode} child - the lowest child of root
 * @returns {SyntaxNode[]} an array of ancestors to the descendent node passed in.
 */
export function getParentNodes(child: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let current: null | SyntaxNode = child;
  while (current !== null) {
    // result.unshift(current); // unshift would be used for [root, ..., child]
    if (current) {
      result.push(current);
    }
    current = current?.parent || null;
  }
  return result;
}

/**
 * Generator function for finding parent nodes. Default behavior is to exclude the child node passed in.
 * If you want to include the child node, pass in true as the second argument.
 * @param {SyntaxNode} child - the child node to start from
 * @param {boolean} [includeSelf] - if true, the child node is included in the results
 * @returns {Generator<SyntaxNode>} - a generator that yields parent nodes
 */
export function* getParentNodesGen(child: SyntaxNode, includeSelf: boolean = false): Generator<SyntaxNode> {
  let current: null | SyntaxNode = includeSelf ? child : child.parent;
  while (current !== null) {
    yield current;
    current = current.parent;
  }
}

/**
 * Generator function for finding child nodes. Default behavior is to exclude the parent node passed in.
 */
export function* nodesGen(node: SyntaxNode) {
  const queue: SyntaxNode[] = [node];

  while (queue.length) {
    const n = queue.shift();

    if (!n) {
      return;
    }

    if (n.children.length) {
      queue.unshift(...n.children);
    }

    yield n;
  }
}

export function* namedNodesGen(node: SyntaxNode) {
  const queue: SyntaxNode[] = [node];

  while (queue.length) {
    const n = queue.shift();

    if (!n?.isNamed) {
      return;
    }

    if (n.children.length) {
      queue.unshift(...n.children);
    }

    yield n;
  }
}
export function findFirstParent(node: SyntaxNode, predicate: (node: SyntaxNode) => boolean) : SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;
  while (current !== null) {
    if (predicate(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * collects all siblings either before or after the current node.
 *
 * @param {SyntaxNode} node - the node to start from
 * @param {'forward' | 'backward'} [lookForward] -  if 'backward' (DEFAULT), looks nodes after the current node.
 * otherwise if specified false, looks for nodes before the current node.
 * @returns {SyntaxNode[]} - an array of either previous siblings or next siblings.
 */
export function getSiblingNodes(
  node: SyntaxNode,
  predicate : (n: SyntaxNode) => boolean,
  direction: 'before' | 'after' = 'before',
): SyntaxNode[] {
  const siblingFunc = (n: SyntaxNode) =>
    direction === 'before' ? n.previousNamedSibling : n.nextNamedSibling;
  let current: SyntaxNode | null = node;
  const result: SyntaxNode[] = [];
  while (current) {
    current = siblingFunc(current);
    if (current && predicate(current)) {
      result.push(current);
    }
  }
  return result;
}

/**
 * Similar to getSiblingNodes. Only returns first node matching the predicate
 */
export function findFirstNamedSibling(
  node: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
  direction: 'before' | 'after' = 'before',
): SyntaxNode | null {
  const siblingFunc = (n: SyntaxNode) =>
    direction === 'before' ? n.previousNamedSibling : n.nextNamedSibling;
  let current: SyntaxNode | null = node;
  while (current) {
    current = siblingFunc(current);
    if (current && predicate(current)) {
      return current;
    }
  }
  return null;
}

export function findFirstSibling(
  node: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
  direction: 'before' | 'after' = 'before',
): SyntaxNode | null {
  const siblingFunc = (n: SyntaxNode) =>
    direction === 'before' ? n.previousSibling : n.nextSibling;
  let current: SyntaxNode | null = node;
  while (current) {
    current = siblingFunc(current);
    if (current && predicate(current)) {
      return current;
    }
  }
  return null;
}

const findFirstParentFunctionOrProgram = (parent: SyntaxNode) => {
  const result = findFirstParent(parent, n => isFunctionDefinition(n) || isProgram(n));
  if (result) {
    return result;
  }
  return parent;
};

export function findEnclosingScope(node: SyntaxNode) : SyntaxNode {
  let parent = node.parent || node;
  if (isFunctionDefinitionName(node)) {
    return findFirstParentFunctionOrProgram(parent);
  } else if (node.text === 'argv') {
    parent = findFirstParentFunctionOrProgram(parent);
    return isFunctionDefinition(parent) ? parent.firstNamedChild || parent : parent;
  } else if (isVariable(node)) {
    parent = findFirstParent(node, n => isScope(n)) || parent;
    return isForLoop(parent) && findForLoopVariable(parent)?.text === node.text
      ? parent
      : findFirstParent(node, n => isProgram(n) || isFunctionDefinitionName(n))
                || parent;
  } else if (isCommandName(node)) {
    return findFirstParent(node, n => isProgram(n)) || parent;
  } else {
    return findFirstParent(node, n => isScope(n)) || parent;
  }
}

// some nodes (such as commands) to get their text, you will need
// the first named child.
// other nodes (such as flags) need just the actual text.
export function getNodeText(node: SyntaxNode | null): string {
  if (!node) {
    return '';
  }
  if (isFunctionDefinition(node)) {
    return node.child(1)?.text || '';
  }
  if (isVariableDefinition(node)) {
    const defVar = findSetDefinedVariable(node)!;
    return defVar.text || '';
  }
  return node.text !== null ? node.text.trim() : '';
}

export function getNodesTextAsSingleLine(nodes: SyntaxNode[]): string {
  let text = '';
  for (const node of nodes) {
    text += ' ' + node.text.split('\n').map(n => n.split(' ').map(n => n.trim()).join(' ')).map(n => n.trim()).join(';');
    if (!text.endsWith(';')) {
      text += ';';
    }
  }
  return text.replaceAll(/;+/g, ';').trim();
}

export function firstAncestorMatch(
  start: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
): SyntaxNode | null {
  const ancestors = getParentNodes(start) || [];
  const root = ancestors[ancestors.length - 1];
  //if (ancestors.length < 1) return root;
  for (const p of ancestors) {
    if (!predicate(p)) {
      continue;
    }
    return p;
  }
  return !!root && predicate(root) ? root : null;
}

/**
 * finds all ancestors (parent nodes) of a node that match a predicate
 *
 * @param {SyntaxNode} start - the leaf/deepest child node to start searching from
 * @param {(n: SyntaxNode) => boolean} predicate - a function that returns true if the node matches
 * @param {boolean} [inclusive] - if true, the start node can be included in the results
 * @returns {SyntaxNode[]} - an array of nodes that match the predicate
 */
export function ancestorMatch(
  start: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
  inclusive: boolean = true,
): SyntaxNode[] {
  const ancestors = getParentNodes(start) || [];
  const searchNodes : SyntaxNode[] = [];
  for (const p of ancestors) {
    searchNodes.push(...getChildNodes(p));
  }
  const results: SyntaxNode[] = searchNodes.filter(neighbor => predicate(neighbor));
  return inclusive ? results : results.filter(ancestor => ancestor !== start);
}

/**
 * searches for all children nodes that match the predicate passed in
 *
 * @param {SyntaxNode} start - the root node to search from
 * @param {(n: SyntaxNode) => boolean} predicate - a function that returns a bollean
 * incating whether the node passed in matches the search criteria
 *  @param {boolean} inclusive: boolean = true,
 * @returns {SyntaxNode[]} - all child nodes that match the predicate
 */
export function descendantMatch(
  start: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
  inclusive = true,
) : SyntaxNode[] {
  const descendants: SyntaxNode[] = [];
  descendants.push(...getChildNodes(start));
  const results = descendants.filter(descendant => predicate(descendant));
  return inclusive ? results : results.filter(r => r !== start);
}

export function hasNode(allNodes: SyntaxNode[], matchNode: SyntaxNode) {
  for (const node of allNodes) {
    if (node.equals(matchNode)) {
      return true;
    }
  }
  return false;
}

export function getNamedNeighbors(node: SyntaxNode): SyntaxNode[] {
  return node.parent?.namedChildren || [];
}

export function getRange(node: SyntaxNode): Range {
  return Range.create(
    node.startPosition.row,
    node.startPosition.column,
    node.endPosition.row,
    node.endPosition.column,
  );
}

/**
 * findNodeAt() - handles moving backwards if the cursor is not currently on a node (safer version of getNodeAt)
 */
export function findNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null {
  if (!tree.rootNode) {
    return null;
  }

  let currentCol = column;
  const currentLine = line;

  while (currentLine > 0) {
    const currentNode = tree.rootNode.descendantForPosition({ row: currentLine, column: currentCol });
    if (currentNode) {
      return currentNode;
    }
    currentCol--;
  }
  return tree.rootNode.descendantForPosition({ row: line, column });
}

export function equalRanges(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

/**
 * Check if a range contains otherRange.
 * @param outer - The range that should contain the other range.
 * @param inner - The range that should be contained by the other range.
 * @returns `true` if `range` contains `otherRange`.
 */
export function containsRange(outer: Range, inner: Range): boolean {
  if (inner.start.line < outer.start.line || inner.end.line < outer.start.line) {
    return false;
  }
  if (inner.start.line > outer.end.line || inner.end.line > outer.end.line) {
    return false;
  }
  if (inner.start.line === outer.start.line && inner.start.character < outer.start.character) {
    return false;
  }
  if (inner.end.line === outer.end.line && inner.end.character > outer.end.character) {
    return false;
  }
  return true;
}

/**
 * @param before - The range that should precede the other range.
 * @param after - The range that should follow the other range.
 * @returns `true` if `before` precedes `after`.
 */
export function precedesRange(before: Range, after: Range): boolean {
  if (before.start.line < after.start.line) {
    return true;
  }
  if (before.start.line === after.start.line && before.start.character < after.start.character) {
    return true;
  }
  return false;
}

/**
 * getNodeAt() - handles moving backwards if the cursor i
 */
export function getNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null {
  if (!tree.rootNode) {
    return null;
  }

  return tree.rootNode.descendantForPosition({ row: line, column });
}

/**
 * Check if a node contains otherNode.
 * @param outer - The outer node that should contain the other node.
 * @param inner - The inner node that should be contained by the outer node.
 * @returns `true` if `node` contains `otherNode`.
 */
export function containsNode(outer: SyntaxNode, inner: SyntaxNode): boolean {
  return containsRange(getRange(outer), getRange(inner));
}

export function getNodeAtRange(root: SyntaxNode, range: Range): SyntaxNode | null {
  return root.descendantForPosition(
    positionToPoint(range.start),
    positionToPoint(range.end),
  );
}

export function positionToPoint(pos: Position): Point {
  return {
    row: pos.line,
    column: pos.character,
  };
}

export function pointToPosition(point: Point): Position {
  return {
    line: point.row,
    character: point.column,
  };
}

export function rangeToPoint(range: Range): Point {
  return {
    row: range.start.line,
    column: range.start.character,
  };
}

export function getRangeWithPrecedingComments(node: SyntaxNode): Range {
  let currentNode: SyntaxNode | null = node.previousNamedSibling;
  let previousNode: SyntaxNode = node;
  while (currentNode?.type === 'comment') {
    previousNode = currentNode;
    currentNode = currentNode.previousNamedSibling;
  }
  return Range.create(
    pointToPosition(previousNode.startPosition),
    pointToPosition(node.endPosition),
  );
}

export function getPrecedingComments(node: SyntaxNode | null): string {
  if (!node) {
    return '';
  }
  const comments = commentsHelper(node);
  if (!comments) {
    return node.text;
  }
  return [
    commentsHelper(node),
    node.text,
  ].join('\n');
}

function commentsHelper(node: SyntaxNode | null) : string {
  if (!node) {
    return '';
  }

  const comment: string[] = [];
  let currentNode = node.previousNamedSibling;

  while (currentNode?.type === 'comment') {
    //comment.unshift(currentNode.text.replaceAll(/#+\s?/g, ''))
    comment.unshift(currentNode.text);
    currentNode = currentNode.previousNamedSibling;
  }

  return comment.join('\n');
}

export function isFishExtension(path: URI | string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.fish';
}

export function isPositionWithinRange(position: Position, range: Range): boolean {
  const doesStartInside =
    position.line > range.start.line ||
    position.line === range.start.line && position.character >= range.start.character;

  const doesEndInside =
    position.line < range.end.line ||
    position.line === range.end.line && position.character <= range.end.character;

  return doesStartInside && doesEndInside;
}

export function isPositionAfter(first: Position, second: Position): boolean {
  return (
    first.line < second.line ||
        first.line === second.line && first.character < second.character
  );
}
export function isNodeWithinRange(node: SyntaxNode, range: Range): boolean {
  const doesStartInside =
    node.startPosition.row > range.start.line ||
    node.startPosition.row === range.start.line &&
      node.startPosition.column >= range.start.character;

  const doesEndInside =
    node.endPosition.row < range.end.line ||
    node.endPosition.row === range.end.line &&
      node.endPosition.column <= range.end.character;

  return doesStartInside && doesEndInside;
}

export function isNodeWithinOtherNode(node: SyntaxNode, otherNode: SyntaxNode): boolean {
  return isNodeWithinRange(node, getRange(otherNode));
}

/**
 * Checks if a server position is within a tree-sitter node
 */
export function isPositionInNode(position: Position, node: SyntaxNode): boolean {
  const start = node.startPosition;
  const end = node.endPosition;

  // Check if position is before the node
  if (position.line < start.row) return false;
  if (position.line === start.row && position.character < start.column) return false;

  // Check if position is after the node
  if (position.line > end.row) return false;
  if (position.line === end.row && position.character > end.column) return false;

  return true;
}

export function getLeafNodes(node: SyntaxNode): SyntaxNode[] {
  function gatherLeafNodes(node: SyntaxNode, leafNodes: SyntaxNode[] = []): SyntaxNode[] {
    if (node.childCount === 0 && node.text !== '') {
      leafNodes.push(node);
      return leafNodes;
    }
    for (const child of node.children) {
      leafNodes = gatherLeafNodes(child, leafNodes);
    }
    return leafNodes;
  }
  return gatherLeafNodes(node);
}

export function getLastLeafNode(node: SyntaxNode, maxIndex: number = Infinity): SyntaxNode {
  const allLeafNodes = getLeafNodes(node).filter(leaf => leaf.startPosition.column < maxIndex);
  return allLeafNodes[allLeafNodes.length - 1]!;
}

export function getNodeAtPosition(tree: Tree, position: { line: number; character: number; }): SyntaxNode | null {
  return tree.rootNode.descendantForPosition({ row: position.line, column: position.character });
}

/**
 * Tree traversal utilities for functional composition and null-safe operations
 *
 * Provides methods to traverse syntax trees in a functional manner,
 * eliminating repetitive while loops and null checking patterns.
 *
 * @example
 * ```typescript
 * // Instead of:
 * let current = node.parent;
 * while (current) {
 *   if (predicate(current)) {
 *     return current;
 *   }
 *   current = current.parent;
 * }
 * return null;
 *
 * // Use:
 * TreeWalker.walkUp(node, predicate).getOrElse(null);
 * ```
 */
export class TreeWalker {
  /**
   * Walk up the tree until a node matching the predicate is found
   */
  static walkUp(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): Maybe<SyntaxNode> {
    let current = node.parent;
    while (current) {
      if (predicate(current)) {
        return Maybe.of(current);
      }
      current = current.parent;
    }
    return Maybe.none();
  }

  /**
   * Walk up the tree and collect all nodes matching the predicate
   */
  static walkUpAll(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode[] {
    const results: SyntaxNode[] = [];
    let current = node.parent;
    while (current) {
      if (predicate(current)) {
        results.push(current);
      }
      current = current.parent;
    }
    return results;
  }

  /**
   * Find the first child node matching the predicate
   */
  static findFirstChild(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): Maybe<SyntaxNode> {
    const child = node.namedChildren.find(predicate);
    return Maybe.of(child);
  }

  /**
   * Find the highest (farthest from start node) ancestor matching the predicate
   */
  static findHighest(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): Maybe<SyntaxNode> {
    const all = TreeWalker.walkUpAll(node, predicate);
    return Maybe.of(all[all.length - 1]);
  }

  /**
   * Walk down the tree breadth-first until a node matching the predicate is found
   */
  static walkDown(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): Maybe<SyntaxNode> {
    const queue: SyntaxNode[] = [node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (predicate(current)) {
        return Maybe.of(current);
      }
      queue.push(...current.namedChildren);
    }
    return Maybe.none();
  }

  /**
   * Walk down the tree and collect all nodes matching the predicate
   */
  static walkDownAll(node: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode[] {
    const results: SyntaxNode[] = [];
    const queue: SyntaxNode[] = [node];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (predicate(current)) {
        results.push(current);
      }
      queue.push(...current.namedChildren);
    }
    return results;
  }
}
