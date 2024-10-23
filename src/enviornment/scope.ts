import { SyntaxNode } from 'web-tree-sitter';
import * as Locations from '../utils/locations';

export interface Scope {
    node: SyntaxNode;
    kind: 'function' | 'program';
    parent: Scope | null;
    children: Scope[];
}

export class Scope {
  constructor(
    public node: SyntaxNode,
    public kind: 'function' | 'program',
    public parent: Scope | null = null,
    public children: Scope[] = [],
  ) {}

  contains(node: SyntaxNode) {
    return Locations.Range.containsRange(
      Locations.Range.fromNode(this.node),
      Locations.Range.fromNode(node),
    );
  }
}



export class ScopeStack {
  private root: Scope | null = null;
  private nodeToScope: Map<SyntaxNode, Scope> = new Map();

  constructor(flatScopes: Scope[]) {
    this.buildHierarchy(flatScopes);
  }

  private buildHierarchy(flatScopes: Scope[]): void {
    // Reset all parent/children relationships
    flatScopes.forEach(scope => {
      scope.children = [];
      scope.parent = null;
    });

    // Build parent-child relationships
    flatScopes.forEach(scope => {
      let bestParent: Scope | null = null;
      let bestSize = Infinity;

      flatScopes.forEach(potentialParent => {
        if (potentialParent === scope) return;

        if (this.isContained(scope.node, potentialParent.node)) {
          const size = this.nodeSize(potentialParent.node);
          if (size < bestSize) {
            bestParent = potentialParent;
            bestSize = size;
          }
        }
      });

      if (bestParent) {
        scope.parent = bestParent;
        bestParent.children.push(scope);
      } else if (!this.root) {
        this.root = scope;
      }
    });

    // Build lookup map
    this.buildMap(this.root);
  }

  private buildMap(scope: Scope | null): void {
    if (!scope) return;
    this.nodeToScope.set(scope.node, scope);
    scope.children.forEach(child => this.buildMap(child));
  }

  private isContained(inner: SyntaxNode, outer: SyntaxNode): boolean {
    const innerStart = inner.startPosition;
    const innerEnd = inner.endPosition;
    const outerStart = outer.startPosition;
    const outerEnd = outer.endPosition;

    const afterStart =
            innerStart.row > outerStart.row ||
            innerStart.row === outerStart.row && innerStart.column >= outerStart.column;

    const beforeEnd =
            innerEnd.row < outerEnd.row ||
            innerEnd.row === outerEnd.row && innerEnd.column <= outerEnd.column;

    return afterStart && beforeEnd;
  }

  private nodeSize(node: SyntaxNode): number {
    return (node.endPosition.row - node.startPosition.row) * 1000 +
               (node.endPosition.column - node.startPosition.column);
  }

  findScope(node: SyntaxNode): Scope | null {
    // First check if the node is directly mapped
    const directScope = this.nodeToScope.get(node);
    if (directScope) return directScope;

    // Otherwise find the smallest containing scope
    const current = this.root;
    let result = null;

    const traverse = (scope: Scope | null): void => {
      if (!scope) return;

      if (this.isContained(node, scope.node)) {
        result = scope;
        // Continue searching children for more specific scope
        scope.children.forEach(traverse);
      }
    };

    traverse(this.root);
    return result;
  }

  getStack(node: SyntaxNode): Scope[] {
    const scope = this.findScope(node);
    if (!scope) return [];

    const stack: Scope[] = [];
    let current: Scope | null = scope;

    while (current) {
      stack.push(current);
      current = current.parent;
    }

    return stack.reverse(); // Return outermost to innermost
  }

  // Debugging helper
  print(): void {
    const printScope = (scope: Scope, depth = 0): void => {
      const indent = '  '.repeat(depth);
      console.log(`${indent}${scope.kind} (${scope.node.startPosition.row}:${scope.node.startPosition.column})`);
      scope.children.forEach(child => printScope(child, depth + 1));
    };

    if (this.root) {
      printScope(this.root);
    }
  }
}

// Example usage:
/*
const flatScopes: Scope[] = [
    {
        node: programNode,
        kind: 'program',
        parent: null,
        children: []
    },
    {
        node: functionNode,
        kind: 'function',
        parent: null,
        children: []
    }
];

const stack = new ScopeStack(flatScopes);
const scope = stack.findScope(someNode);
const scopeStack = stack.getStack(someNode);
*/
