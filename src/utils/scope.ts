import { DocumentUri, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types';
import { FishDocumentSymbol, SymbolName } from './new-symbol';
import { flattenNested } from './flatten';

/* type mapping for ScopeTags */
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

export class Scope {
  /**
   * the ranges that are valid in the scope
   */
  public spans: Range[];
  constructor(
    public tag: ScopeTag,
    public node: SyntaxNode,

  ) {
    this.spans = this.initializeSpans();
  }

  /**
   * Initialize the _\`TextSpan\`_ object with the ranges from the _\`SyntaxNode\`_
   */
  private initializeSpans(): Range[] {
    return this.getTextSpanRanges(this.node);
  }

  /**
   * Get the _\`scope.tag\`_ numeric value for comparing
   * @returns The numeric value of the _\`scope.tag\`_
   */
  getTagValue(): ScopeTagValue {
    return ScopeTag[this.tag];
  }

  /**
   * @param tag - The _\`scope.tag\`_ for the new scope
   * @param node - The _\`SyntaxNode\`_ for the new scope
   * @returns A new _\`Scope\`_ object
   */
  static create(tag: ScopeTag, node: SyntaxNode): Scope {
    return new Scope(tag, node);
  }

  /**
   * Incrementally remove a range from the span
   * @param rangeToRemove - The range to remove from the span
   */
  removeSpan(rangeToRemove: Range): void {
    const updatedRanges: Range[] = [];

    for (const range of this.spans) {
      if (this.rangeOverlaps(range, rangeToRemove)) {
        // Split the range if necessary
        if (range.start.line < rangeToRemove.start.line ||
          range.start.line === rangeToRemove.start.line && range.start.character < rangeToRemove.start.character) {
          updatedRanges.push({
            start: range.start,
            end: {
              line: rangeToRemove.start.line,
              character: rangeToRemove.start.character,
            },
          });
        }

        if (range.end.line > rangeToRemove.end.line ||
          range.end.line === rangeToRemove.end.line && range.end.character > rangeToRemove.end.character) {
          updatedRanges.push({
            start: {
              line: rangeToRemove.end.line,
              character: rangeToRemove.end.character,
            },
            end: range.end,
          });
        }
      } else {
        updatedRanges.push(range);
      }
    }
    this.spans = updatedRanges;
  }

  /**
   * Build a _\`TextSpan\`_ object from the _\`Scope\`_ object
   * @param node - The _\`SyntaxNode\`_ for the new scope
   * @returns A new _\`TextSpan\`_ object
   */
  private getTextSpanRanges(node: SyntaxNode): Range[] {
    const ranges: Range[] = [];
    let currentStart = node.startPosition;

    const collectRanges = (child: SyntaxNode) => {
      if (
        child.type === 'function_definition' &&
        child.childrenForFieldName('option')
          .none((n) => {
            return NodeTypes.isMatchingOption(n, { shortOption: '-S', longOption: '--no-scope-shadowing' }) ||
              NodeTypes.isMatchingOption(n, { shortOption: '-V', longOption: '--inherit-variable' });
          })
      ) {
        if (child.startPosition.row > currentStart.row ||
          child.startPosition.row === currentStart.row && child.startPosition.column > currentStart.column) {
          ranges.push({
            start: { line: currentStart.row, character: currentStart.column },
            end: { line: child.startPosition.row, character: child.startPosition.column },
          });
        }
        currentStart = child.endPosition;
      } else {
        for (let i = 0; i < child.childCount; i++) {
          collectRanges(child.child(i)!);
        }
      }
    };

    for (let i = 0; i < node.childCount; i++) {
      collectRanges(node.child(i)!);
    }

    if (currentStart.row < node.endPosition.row ||
      currentStart.row === node.endPosition.row && currentStart.column < node.endPosition.column) {
      ranges.push({
        start: { line: currentStart.row, character: currentStart.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
      });
    }

    return ranges;
  }

  containsInTextSpan(currentRange: Range): boolean {
    for (const range of this.spans) {
      if (this.rangeContains(range, currentRange) && !this.rangesEqual(range, currentRange)) {
        return true;
      }
    }
    return false;
  }

  private rangeContains(outer: Range, inner: Range): boolean {
    if (outer.start.line > inner.start.line || outer.end.line < inner.end.line) {
      return false;
    }
    if (outer.start.line === inner.start.line && outer.start.character > inner.start.character) {
      return false;
    }
    if (outer.end.line === inner.end.line && outer.end.character < inner.end.character) {
      return false;
    }
    return true;
  }

  private rangesEqual(a: Range, b: Range): boolean {
    return (
      a.start.line === b.start.line &&
      a.start.character === b.start.character &&
      a.end.line === b.end.line &&
      a.end.character === b.end.character
    );
  }

  private rangeOverlaps(a: Range, b: Range): boolean {
    return !(a.end.line < b.start.line ||
      a.end.line === b.start.line && a.end.character <= b.start.character ||
      b.end.line < a.start.line ||
      b.end.line === a.start.line && b.end.character <= a.start.character);
  }

  toString() {
    const ranges: string[] = [];
    let index = 0;
    for (const range of this.spans) {
      ranges.push('{' + `${index}, ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}` + '}');
      index++;
    }
    return `${this.tag}: ${ranges.join(',')}`;
  }
}

export function getNodeScopeType(node: SyntaxNode) {
  if (NodeTypes.isFunctionDefinitionName(node)) {
    return 'function';
  }
  if (NodeTypes.isVariableDefinitionName(node)) {
    return 'variable';
  }
  return 'unknown';
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
 * @param uri - The _\`DocumentUri\`_ of the current document
 * @param node - The _\`SyntaxNode\`_ of the current node
 * @returns The _\`scope.tag\`_ of the current node for a _\'function_definition\'_
 */
function getFunctionScopeType(uri: DocumentUri, node: SyntaxNode) {
  const uriParts = uri.split('/');
  const functionUriName = uriParts.at(-1)?.split('.')?.at(0) || uriParts.at(-1);
  const pFunction = findParent(node, (n) => n.type === 'function_definition');

  if (uriParts?.at(-2) && uriParts.at(-2)?.includes('functions')) {
    if (functionUriName === node.text) {
      return 'global';
    }
    if (pFunction) {
      return 'function';
    }
    return 'local';
  } else if (uriParts?.at(-1) === 'config.fish' || uriParts.at(-2) === 'conf.d') {
    if (node.parent && findParent(node.parent, (n) => n.type === 'function_definition')) {
      return 'function';
    }
    return 'global';
  }
  if (pFunction) {
    return 'function';
  }
  return 'local';
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
export namespace ScopeModifier {

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
  export function functionCommand(node: SyntaxNode): ScopeTag {
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
          return 'inherit';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-a', longOption: '--argument-names' }):
          return 'local';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-v', longOption: '--on-variable' }):
          return 'global';
        case NodeTypes.isMatchingOption(lastArg, { shortOption: '-S', longOption: '--no-scope-shadowing' }):
          return 'inherit';
        default:
          return 'local';
      }
    }

    return 'local';
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
      const scopeNode = findParent(node, (n) => {
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

export function getScope(documentUri: DocumentUri, node: SyntaxNode, text: SymbolName): Scope {
  const nodeType = getNodeScopeType(node);
  let scopeTag: ScopeTag = 'local';

  let scopeNode = findParent(node, (n) => {
    return n.type === 'function_definition' || n.type === 'program';
  }) || node.parent || node;

  if (text === 'argv') {
    return Scope.create('local', scopeNode);
  }

  if (nodeType === 'function') {
    scopeTag = getFunctionScopeType(documentUri, node);
  } else if (nodeType === 'variable') {
    if (node.parent) {
      if (node.parent.type === 'function_definition') {
        scopeTag = ScopeModifier.functionCommand(node);
        const result = ScopeModifier.findVariableFunctionFlagInheritParent(node, scopeTag);
        scopeTag = result.tag;
        scopeNode = result.node;
      } else if (node.parent.type === 'for_statement') {
        scopeTag = 'local';
      } else if (NodeTypes.isCommandWithName(node.parent, 'argparse')) {
        scopeTag = 'local';
      } else if (NodeTypes.isCommandWithName(node.parent, 'read')) {
        scopeTag = ScopeModifier.variableCommand(node);
      } else if (NodeTypes.isCommandWithName(node.parent, 'set')) {
        scopeTag = ScopeModifier.variableCommand(node);
      }
    }
  }

  return Scope.create(scopeTag, scopeNode);
}

// export function getTextSpanRanges(node: SyntaxNode): Range[] {
//   const ranges: Range[] = [];
//   let currentStart = node.startPosition;
//
//   function collectRanges(child: SyntaxNode) {
//     if (
//       child.type === 'function_definition' &&
//       child.childrenForFieldName('option')
//         .none((n) => {
//           return NodeTypes.isMatchingOption(n, { shortOption: '-S', longOption: '--no-scope-shadowing' })
//             || NodeTypes.isMatchingOption(n, { shortOption: '-V', longOption: '--inherit-variable' });
//         })
//     ) {
//       // If we encounter a function_definition, add the range up to this point
//       if (child.startPosition.row > currentStart.row ||
//         child.startPosition.row === currentStart.row && child.startPosition.column > currentStart.column) {
//         ranges.push({
//           start: { line: currentStart.row, character: currentStart.column },
//           end: { line: child.startPosition.row, character: child.startPosition.column },
//         });
//       }
//       // Update the currentStart to be after this function_definition
//       currentStart = child.endPosition;
//     } else {
//       // Recursively collect ranges for non-function_definition nodes
//       for (let i = 0; i < child.childCount; i++) {
//         collectRanges(child.child(i)!);
//       }
//     }
//   }
//
//   // Start the recursive collection
//   for (let i = 0; i < node.childCount; i++) {
//     collectRanges(node.child(i)!);
//   }
//
//   // Add the final range if there's any remaining
//   if (currentStart.row < node.endPosition.row ||
//     currentStart.row === node.endPosition.row && currentStart.column < node.endPosition.column) {
//     ranges.push({
//       start: { line: currentStart.row, character: currentStart.column },
//       end: { line: node.endPosition.row, character: node.endPosition.column },
//     });
//   }
//
//   return ranges;
// }

/**
 * Get the global scope of a document with a specific match string to remove smaller scopes
 *  @param root - The _root_ node of the document
 *  @param symbols - An array of _\`FishDocumentSymbol\`_ objects, _non-flattened_
 *  @param matchString - The string to match and remove from the global scope (symbols with this name)
 *  @returns global scope from rootNode with all smaller scoped matchString removed
 */
export function getGlobalDocumentScope(root: SyntaxNode, symbols: FishDocumentSymbol[], matchString: string): Scope {
  const rootScope = Scope.create('global', root);

  const matches: FishDocumentSymbol[] = flattenNested(...symbols)
    .filter((s: FishDocumentSymbol) => s.name === matchString && s.scope.getTagValue() < ScopeTag.global);

  matches.forEach(s => {
    rootScope.removeSpan(s.range);
  });

  return rootScope;
}

export function checkSymbolScopeContainsRange(s1: string, s2: string, symbol1: FishDocumentSymbol, symbol2: FishDocumentSymbol) {
  return {
    outer: s1,
    inner: s2,
    contains: symbol1.scope.containsInTextSpan(symbol2.selectionRange) ? '✅' : '❌',
    outerScope: symbol1.scope.toString(),
    innerScope: symbol2.scope.toString(),
  };
}