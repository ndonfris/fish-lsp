import { DocumentUri, SymbolKind } from 'vscode-languageserver';
import { FishDocumentSymbol } from './new-symbol';
import * as NodeTypes from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { containsRange, findChildNodes, getChildNodes, getRange, pointToPosition } from './tree-sitter';
import { symbolKindToString } from './translation';
import { flattenNested } from './flatten';

/**
 * ------------------------------------------------------------------------------
 * TODO: 10/10/2024
 * ------------------------------------------------------------------------------
 *   • current testing is done in:  `test-data/new-analyzer.ts`
 *   • improve the children encapsulation method & logic
 *   • tag for function scope is not working correctly
 *   • redo the `toString()` method
 *   • use get/set methods for properties that make sense syntactically
 *   • add more tests for the `ScopeModifier` namespace
 *   • add more tests for `getEncapsulatedNodes()` results
 *   • PLEASE, drop some comments once `getEncapsulatedNodes()` is
 *     working correctly so that edge cases are not forgotten!
 *   • new-analyzer.ts will implement a simplified version of the
 *     current DefinitionNode builder to extend the diagnostics
 *     that can be found from the info
 *
 *
 *                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 *                  ~ new-analyzer.ts changes HERE ~
 *                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 *
 *        - symbol-table will store references and definitions in O(n) time
 *        - control flow graph will be able to track code paths in O(n) time
 *        - other related new diagnostics are now possible by using the
 *          decoupled symbol-table and control-flow-graph
 *
 * ------------------------------------------------------------------------------
 * Once completed, remove the ./src/utils/new-symbol.ts, test-data/new-analyzer.ts,
 * and the ./src/utils/new-scope.ts files. Replace their original files with the new
 * implementations.
 * ------------------------------------------------------------------------------
 * Testing is done with the snippet below:
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 *   ```sh
 *    >_  nodemon --exec 'ts-node ./test-data/new-analyzer.ts' --ext ts --watch .
 *   ```
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 */

/**
 * type mapping for ScopeTag values, with a numeric value to represent scope hierarchy
 */
export const ScopeTag = {
  local: 0,
  inherit: 1,
  function: 2,
  global: 3,
  universal: 4,
} as const;
/* Create a type from the object keys */
export type ScopeTag = keyof typeof ScopeTag;
/* Utility type to get the numeric value of a ScopeTag */
export type ScopeTagValue = typeof ScopeTag[ScopeTag];
const getScopeTagValue = (tag: ScopeTag): ScopeTagValue => ScopeTag[tag];

export class Scope {
  public excludedNodes: SyntaxNode[] = [];

  constructor(
    public uri: DocumentUri,
    public currentNode: SyntaxNode,
    public parentNode: SyntaxNode,
    public symbol: FishDocumentSymbol,
  ) {
    this.setExcluded();
  }

  public static create(
    uri: DocumentUri,
    currentNode: SyntaxNode,
    parentNode: SyntaxNode,
    symbol: FishDocumentSymbol,
  ): Scope {
    return new Scope(uri, currentNode, parentNode, symbol);
  }

  public static fromSymbol(symbol: FishDocumentSymbol): Scope {
    const grandParent = findParent(symbol.parentNode, (n) => {
      return n.type === 'function_definition' || n.type === 'program';
    }) || symbol.parentNode;
    switch (symbol.kind) {
      case SymbolKind.Variable:
        /**
         * keep the scope at the same level, since the parent of a variable name is the
         *
         */
        return new Scope(symbol.uri, symbol.currentNode, symbol.parentNode, symbol);
      case SymbolKind.Function:
        /**
         * shift the scope up one level, since the parent of a function name is the
         * node's direct `function_definition`.
         *
         * Now its grandparent is the actual scope node which is either a `function_definition`
         * of a `program` node.
         */
        return new Scope(symbol.uri, symbol.parentNode, grandParent, symbol);
    }
    return new Scope(symbol.uri, symbol.currentNode, symbol.parentNode, symbol);
  }

  /**
   * TODO: finish
   */
  get tag(): 'local' | 'inherit' | 'function' | 'global' | 'universal' {
    const kindModifier = this.getKindModifier();
    const scopeType = this.getScopeTypeFromUri();
    switch (this.kind) {
      case 'variable':
        return kindModifier;
      case 'function':
        return scopeType;
    }
  }

  get tagValue(): ScopeTagValue {
    return getScopeTagValue(this.tag);
  }

  static getTagValue(tag: ScopeTag): ScopeTagValue {
    return getScopeTagValue(tag);
  }

  private get kind(): 'variable' | 'function' {
    return symbolKindToString(this.symbol.kind) as 'variable' | 'function';
  }

  public getKindModifier(): ScopeTag {
    const kind = this.kind;
    switch (kind) {
      case 'variable':
        return ScopeModifier.variableCommand(this.currentNode);
      case 'function':
        return ScopeModifier.functionCommand(this.currentNode, this.symbol);
    }
  }

  private getScopeTypeFromUri(): ScopeTag {
    // const uri: DocumentUri = this.symbol.uri;
    const uriParts = this.symbol.uri.split('/');
    const functionUriName = uriParts.at(-1)?.split('.')?.at(0) || uriParts.at(-1);
    const parentFunction = findParent(this.parentNode, (n) => n.type === 'function_definition');

    if (uriParts?.at(-2) && uriParts.at(-2)?.includes('functions')) {
      if (functionUriName === this.symbol.name) {
        return 'global';
      }
      if (this.parentNode.type === 'function_definition') {
        return 'function';
      }
      return 'local';
    } else if (uriParts?.at(-1) === 'config.fish' || uriParts.at(-2) === 'conf.d') {
      if (this.parentNode.type === 'function_definition') {
        if (ScopeModifier.functionWithFlag(this.parentNode)) {
          return 'function';
        }
        return 'local';
      }
      return 'global';
    }
    if (parentFunction) {
      return 'function';
    }
    return 'local';
  }

  /** TODO: test working state */
  public contains(node: SyntaxNode): boolean {
    for (const child of this.getNodes()) {
      if (containsRange(getRange(child), getRange(node))) {
        return true;
      }
    }
    return false;
  }

  get isCallable(): boolean {
    return this.symbol.kind === SymbolKind.Function;
  }

  get isGlobal(): boolean {
    return this.tag === 'global' || this.tag === 'universal';
  }

  private setExcluded() {
    const parentFunctions = this.symbol.parentNode.descendantsOfType('function_definition');
    for (const parentFunction of parentFunctions) {
      if (parentFunction.equals(this.parentNode)) {
        continue;
      }
      if (ScopeModifier.functionWithFlag(parentFunction, this.symbol)) {
        continue;
      }
      this.excludedNodes.push(parentFunction);
    }

    // switch (this.kind) {
    //   case 'variable':
    //     this.excludedNodes.push(this.currentNode);
    //     // if (parentSymbol && this.symbol.parent && this.symbol.parent.getAllChildren()) {
    //     //   this.excludedNodes.push(
    //     //     ...parentSymbol.getAllChildren()
    //     //       .filter((s: FishDocumentSymbol) => s.name === this.symbol.name && s.scope.tagValue !== this.tagValue)
    //     //       .map((s: FishDocumentSymbol) => s.parentNode));
    //     // }
    //     break;
    //   case 'function':
    //     this.excludedNodes.push(this.currentNode);
    //     break;
    // }
    /** todo: add all children functions that need to be excluded */
    // parentSymbol?.getAllChildren().forEach((s: FishDocumentSymbol) => {
    //   if (s.kind === SymbolKind.Function) {
    //
    //   }
    //   if (s.name === this.symbol.name && s.scope.tagValue !== this.tagValue) {
    //     this.excludedNodes.push(s.parentNode);
    //   }
    // })
  }

  public getNodes(): SyntaxNode[] {
    const parentSymbol = this.symbol.parent;
    switch (this.kind) {
      case 'variable':
        this.excludedNodes.push(this.currentNode);
        if (parentSymbol && this.symbol.parent && this.symbol.parent.getAllChildren()) {
          this.excludedNodes.push(
            ...parentSymbol.getAllChildren()
              .filter((s: FishDocumentSymbol) => s.name === this.symbol.name && s.scope.tagValue !== this.tagValue)
              .map((s: FishDocumentSymbol) => s.parentNode));
        }
        break;
      case 'function':
        this.excludedNodes.push(this.currentNode);
        break;
    }

    return getChildNodes(this.parentNode)
      .filter(n => !this.excludedNodes.some(s => containsRange(getRange(s), getRange(n))));
  }
  // while(queue.length) {
  //   const current: SyntaxNode | undefined = queue.shift();
  //   if (!current) {
  //     continue;
  //   }
  //   if (current.type === 'function_definition' && !ScopeModifier.functionWithFlag(current)) {
  //     continue;
  //   }
  //   if (current.equals(this.node)) continue;
  //   if (current && current.children) {
  //     queue.unshift(...current.children);
  //   }
  // }
  // return result;
  // }

  // getEncapsulatedNodes(): SyntaxNode[] {
  //   const result: SyntaxNode[] = [];
  //   const innerScopeSet = new Set(this.innerScope());
  //
  //   for (const outerNode of this.outerScope()) {
  //     if (!this.isNodeOrChildInInnerScope(outerNode, innerScopeSet)) {
  //       result.push(this.getCondensedNode(outerNode, innerScopeSet));
  //     }
  //   }
  //
  //   return result;
  // }
  //
  // private isNodeOrChildInInnerScope(node: SyntaxNode, innerScopeSet: Set<SyntaxNode>): boolean {
  //   if (innerScopeSet.has(node)) {
  //     return true;
  //   }
  //
  //   if (!node) return false;
  //   if (!node?.children || node.children.length === 0) {
  //     return false;
  //   }
  //
  //   for (const child of node.children as SyntaxNode[]) {
  //     if (this.isNodeOrChildInInnerScope(child, innerScopeSet)) {
  //       return true;
  //     }
  //   }
  //
  //   return false;
  // }
  //
  // // TODO: fix the children from the encapsulation method
  // private getCondensedNode(node: SyntaxNode, innerScopeSet: Set<SyntaxNode>): SyntaxNode {
  //   const condensedChildren: SyntaxNode[] = [];
  //
  //   for (const child of node.children) {
  //     if (!this.isNodeOrChildInInnerScope(child, innerScopeSet)) {
  //       condensedChildren.push(this.getCondensedNode(child, innerScopeSet));
  //     }
  //   }
  //
  //   // Create a new node with the same properties as the original, but with condensed children
  //   return {
  //     ...node,
  //     children: condensedChildren, // TODO: causes error when trying to access children
  //   };
  // }

  /**
   * TODO: ___test parent resolution is correct___
   *
   * @see deprecated method in ./scope.ts file, for OLD implementation/behavior
   *
   * ---
   * _note:_ end is not logged because of the condensing we do above
   */
  // public toString(): string {
  //   return Array.from(Object.values({
  //     tag: this.tag,
  //     // uri: this.uri,
  //     // node: `${this.node.type} - ${this.node.text.slice(0, 10)} - ${this.node.toString().slice(0, 15)}`,
  //     // parent: `${this.parent.type} - ${this.parent.text.slice(0, 10)} - ${this.parent.toString().slice(0, 15)}`,
  //     // symbol: `${this.symbol.name} - ${symbolKindToString(this.symbol.kind)}`,
  //     encapsulatedNodes: this.getEncapsulatedNodes().map((n: SyntaxNode) => {
  //       const start = n.startPosition;
  //       // const end = n.endPosition;
  //       const { line, character } = pointToPosition(start);
  //       // const { line: endLine = -1, character: endCharacter = -1 } = pointToPosition(end);
  //
  //       return '(' + Object.values({ line, character }).join(',') + ')';
  //     }).join(' - '),
  //   })).join(' | ').toString();
  // }

  public toObject() {
    return {
      tag: this.tag,
      name: this.symbol.name,
      parentNode: getRangeString(getRange(this.parentNode)),
      currentNode: getRangeString(getRange(this.currentNode)),
    };
  }

  public toString(): string {
    const nodeStr = getRangeString(getRange(this.currentNode));
    const parentStr = getRangeString(getRange(this.parentNode));
    const tagStr = String("'" + this.tag + "'").padEnd(10);
    const nameStr = String("'" + this.symbol.name + "'").padEnd(9);
    return `{ tag: ${tagStr}, name: ${nameStr}, ranges: {${nodeStr}, ${parentStr}}, }`;
  }
}

function getRangeString(
  range: {
    start: { line: number; character: number; };
    end: { line: number; character: number; };
  },
): string {
  const getPaddedRange = (r: { line: number; character: number; }) => {
    return `(${r.line.toString()},${r.character.toString()})`;
  };
  return `[${getPaddedRange(range.start).padStart(7)}, ${getPaddedRange(range.end).padEnd(7)}]`;
}

function findParent(n: SyntaxNode, fn: (n: SyntaxNode) => boolean): SyntaxNode | null {
  let current = n.parent;
  while (current) {
    if (fn(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
* Get the scope modifier for a variable when various shell options could edit the scope
*
* ---
*
* Use one of the following functions to determine the scope of a variable:
*
* ```typescript
*
* ScopeModifier.variableCommand(node); // 'local' | 'function' | 'global' | 'universal'
*
* ScopeModifier.functionCommand(node); // 'local' | 'function' | 'global' | 'universal'
* ```
*
* ---
*
*  Both functions return a _\`scope.tag\`_ for the variable node.
*
*/
namespace ScopeModifier {

  /**
   * ```typescript
   * // EXAMPLE USAGE //
   * // Assume the current node in both examples is 'foo' //
   *
   * // GLOBAL SCOPE //
   * // node.parent.text === 'set -gx foo bar' //
   * ScopeModifier.variableCommand(node);      // 'global'
   *
   * // LOCAL SCOPE //
   * // node.parent.text === 'read --local foo' //
   * ScopeModifier.variableCommand(node);       // 'local'
   * ```
   * ___
   *
   * Deterimines the scope of a variable command.
   *
   * Notice that the _\`node.parent.children\`_ are fieldNames of  _\`argument\`_.
   *
   * @param node - A _leaf_ node, with a _parent_ command name of _\`set\`_ or _\`read\`_
   *
   * @returns The _\`scope.tag\`_ of the variable node
   */
  export function variableCommand(node: SyntaxNode): ScopeTag {
    const args: SyntaxNode[] = node.parent?.childrenForFieldName('argument') || [];
    for (const n of args) {
      switch (true) {
        case NodeTypes.isMatchingOption(n, { shortOption: '-l', longOption: '--local' }):
          return 'local';
        case NodeTypes.isMatchingOption(n, { shortOption: '-f', longOption: '--function' }):
          return 'function';
        case NodeTypes.isMatchingOption(n, { shortOption: '-g', longOption: '--global' }):
          return 'global';
        case NodeTypes.isMatchingOption(n, { shortOption: '-U', longOption: '--universal' }):
          return 'universal';
      }
    }
    return 'local';
  }

  /**
   * ```typescript
   * // EXAMPLE USAGE //
   * // Assume the current node in both examples is 'foo' //
   *
   * // GLOBAL SCOPE //
   * // node.parent.text === 'function bar --inherit-variable foo' //
   * ScopeModifier.functionCommand(node);      // 'global'
   *
   * // LOCAL SCOPE //
   * // node.parent.text === 'function bar --argument-names foo' //
   * ScopeModifier.functionCommand(node);       // 'local'
   * ```
   * ___
   *
   * Deterimines the scope of a variable symbol.
   *
   * Notice that the _\`node.parent.children\`_ are fieldNames of  _\`option\`_.
   *
   * @param node - A _leaf_ node, with a _parent_ command name of _\`function _ --flag leaf\`_
   *
   * @returns The _\`scope.tag\`_ of the variable node
   */
  export function functionCommand(node: SyntaxNode, symbol: FishDocumentSymbol): ScopeTag {
    const args: SyntaxNode[] = node.parent?.childrenForFieldName('option') || [] as SyntaxNode[];
    let lastArg: SyntaxNode | null = null;

    for (const arg of args) {
      if (NodeTypes.isOption(arg)) {
        lastArg = arg;
        continue;
      }
      if (arg.equals(node)) break;
    }

    if (lastArg) {
      switch (true) {
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-V', longOption: '--inherit-variable' }):
          return symbol.parentNode.type === 'function_definition' ? 'function' : 'global';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-a', longOption: '--argument-names' }):
          return 'local';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-v', longOption: '--on-variable' }):
          return 'global';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-S', longOption: '--no-scope-shadowing' }):
          // return 'inherit';
          return symbol.parentNode.type === 'function_definition' ? 'function' : 'global';
        default:
          return 'local';
      }
    }

    return 'local';
  }

  export function functionWithFlag(node: SyntaxNode, symbol?: FishDocumentSymbol): boolean {
    const args: SyntaxNode[] = node.childrenForFieldName('option') || [] as SyntaxNode[];
    let lastArg: SyntaxNode | null = null;

    for (const arg of args) {
      if (NodeTypes.isOption(arg)) {
        lastArg = arg;
        continue;
      }
      if (arg.equals(node)) break;
    }

    if (lastArg) {
      switch (true) {
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-V', longOption: '--inherit-variable' }):
          return lastArg.nextSibling ?.text === symbol?.name;
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-S', longOption: '--no-scope-shadowing' }):
          return true;
        default:
          return false;
      }
    }
  }

  /**
   *
   * for inheriting the parent scope of a variable on a function flag modifier
   *
   * ---
   *
   * ```fish
   * function func --inherit-variable foo
   * ```
   *
   * ---
   *
   * @param node - A _leaf_ node, with a _parent_ command name of _\`function _ --flag leaf\`_
   *
   * @param tag - The _\`scope.tag\`_ of the variable node
   *
   * @returns The _\`scope.tag\`_ of the variable node
   */
  export function findVariableFunctionFlagInheritParent(node: SyntaxNode, tag: ScopeTag): {
    tag: ScopeTag;
    node: SyntaxNode;
  } {
    if (tag === 'inherit' && node.parent) {
      const scopeNode = findParent(node.parent, (n) => {
        return n.type === 'function_definition' || n.type === 'program';
      })!;
      if (scopeNode.type === 'function_definition') {
        tag = 'function';
      }
      return { tag, node: scopeNode };
    }
    if (tag === 'local' && node.parent) {
      const scopeNode = findParent(node.parent, (n) => {
        return n.type === 'function_definition' || n.type === 'program';
      })!;
      // if (scopeNode.type === 'function_definition') {
      //   tag = 'function';
      // }
      return { tag, node: scopeNode };
    }
    return { tag, node };
  }
}