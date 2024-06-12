import { isCommandName, isDefinition, isFunctionDefinitionName, isVariableDefinitionName } from '../utils/node-types';
import { SyntaxNode } from 'web-tree-sitter';

// scope.ts
 interface DefinitionInfo {
  node: SyntaxNode;
  references: SyntaxNode[];
}

class Scope {
  definitions: { [name: string]: DefinitionInfo } = {};

  addDefinition(name: string, node: SyntaxNode) {
    if (!this.definitions[name]) {
      this.definitions[name] = { node, references: [] };
    }
  }

  addReference(name: string, node: SyntaxNode) {
    if (this.definitions[name]) {
      this.definitions[name]!.references.push(node);
    }
  }

  hasDefinition(name: string): boolean {
    return this.definitions.hasOwnProperty(name);
  }

  getUnusedDefinitions(): SyntaxNode[] {
    const unused: SyntaxNode[] = [];
    for (const key in this.definitions) {
      if (this.definitions.hasOwnProperty(key)) {
        const info = this.definitions[key];
        if (info && info.references.length === 0) {
          unused.push(info.node);
        }
      }
    }
    return unused;
  }

  getDefinitionCount(): number {
    return Object.keys(this.definitions).length;
  }

  getReferenceCount(): number {
    let count = 0;
    for (const key in this.definitions) {
      if (this.definitions.hasOwnProperty(key)) {
        count += this.definitions[key]!.references.length;
      }
    }
    return count;
  }

  logScope() {
    console.log('Current Scope Definitions:');
    for (const key in this.definitions) {
      if (this.definitions.hasOwnProperty(key)) {
        const info = this.definitions[key];
        console.log(`Definition: ${key}, References: ${info?.references.length}`);
      }
    }
  }
}

export class ScopeStack {
  private stack: Scope[] = [];

  pushScope() {
    this.stack.push(new Scope());
  }

  popScope() {
    return this.stack.pop();
  }

  currentScope(): Scope | undefined{
    return this.stack[this.stack.length - 1];
  }

  addDefinition(name: string, node: SyntaxNode) {
    this.currentScope()?.addDefinition(name, node);
  }

  addReference(name: string, node: SyntaxNode) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i]!.hasDefinition(name)) {
        this.stack[i]!.addReference(name, node);
        break;
      }
    }
  }

  hasDefinition(name: string): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i]!.hasDefinition(name)) {
        return true;
      }
    }
    return false;
  }

  getAllUnusedDefinitions(): SyntaxNode[] {
    let unused: SyntaxNode[] = [];
    for (const scope of this.stack) {
      unused = unused.concat(scope.getUnusedDefinitions());
    }
    return unused;
  }

  getTotalDefinitions(): number {
    return this.stack.reduce((acc, scope) => acc + scope.getDefinitionCount(), 0);
  }

  getTotalReferences(): number {
    return this.stack.reduce((acc, scope) => acc + scope.getReferenceCount(), 0);
  }
  logCurrentState() {
    console.log('Logging current state of the scope stack:');
    this.stack.forEach((scope, index) => {
      console.log(`Scope level: ${index}`);
      scope.logScope();
    });
  }
}

export function isReference(node: SyntaxNode, scopeStack: ScopeStack): boolean {
  if (isVariableDefinitionName(node) || isFunctionDefinitionName(node)) return false;
  return scopeStack.hasDefinition(node.text)
}
