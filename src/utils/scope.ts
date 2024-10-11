import { DocumentUri, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types';
import { FishDocumentSymbol, SymbolName } from './new-symbol';
import { flattenNested } from './flatten';
import { getChildNodes, getRange } from './tree-sitter';

/**
 * TODO:
 *   • DEPRECATED in favor of new-scope.ts
 *   • Similar feature set, with different design choices
 *   • Overall, the new-scope.ts is more robust and simpler to use.
 *
 *       ------------------------------------------------------------------
 *          [ FUTURE ] new-scope.ts       VS.       scope.ts [ OLD ]
 *       ------------------------------------------------------------------
 *       - removes the need for introducing a new text-span `Range[]`
 *         object to represent each scope, our new-scope will be able to
 *         directly provide the nodes included in the Range[] object
 *         for any given scope.
 *       - implements get/set methods for using the scope object in a
 *         more friendly manor.
 *       - directly has access to the important information that causes
 *         Scope's to vary in the first place.
 *       - removes edge cases which scope.ts required back patching (via
 *         methods like `fixSpan`), to semi-correctly handle different
 *         scopes
 *       - exports less identifiers, which negates minute details which
 *         cause confusion among potential maintainers.
 */

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

export function getScopeTagValue(tag: ScopeTag): ScopeTagValue {
  return ScopeTag[tag];
}

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

  get tagValue(): ScopeTagValue {
    return ScopeTag[this.tag];
  }

  /**
   * Get the _\`scope.tag\`_ numeric value for comparing
   * @returns The numeric value of the _\`scope.tag\`_
   */
  getTagValue(): ScopeTagValue {
    return ScopeTag[this.tag];
  }

  static tagValue(tag: ScopeTag): ScopeTagValue {
    return ScopeTag[tag];
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

  // private fixGlobalRanges(...s: FishDocumentSymbol[]) {
  //   const global = flattenNested(...s).find((sym) => sym.scope.tag === 'global');
  //   s.forEach((sym) => {
  //     if (sym.scope.tag !== 'global') {
  //       global.scope.removeSpan(sym.range);
  //     }
  //   });
  //   }
  // }

  fixSpan(...symbols: FishDocumentSymbol[]): void {
    const globalSymbols = symbols.filter(symbol => symbol.scope.tag === 'global');

    for (const symbol of globalSymbols) {
      const symbolRange = symbol.range;

      // Check if the symbol's range overlaps with any existing spans
      const overlappingSpans = this.spans.filter(span => this.rangeOverlaps(span, symbolRange));

      if (overlappingSpans.length === 0) {
        // If there's no overlap, simply add the new range
        this.spans.push(symbolRange);
      } else {
        // If there's overlap, we need to merge the ranges
        const newSpans: Range[] = [];

        for (const span of this.spans) {
          if (this.rangeOverlaps(span, symbolRange)) {
            // Merge the overlapping spans
            newSpans.push(this.mergeRanges(span, symbolRange));
          } else {
            newSpans.push(span);
          }
        }

        this.spans = newSpans;
      }
    }

    // Sort the spans to ensure they're in order
    this.spans.sort((a, b) => {
      if (a.start.line !== b.start.line) {
        return a.start.line - b.start.line;
      }
      return a.start.character - b.start.character;
    });

    // Merge any adjacent or overlapping spans
    this.spans = this.mergeAdjacentSpans(this.spans);
  }

  private mergeRanges(range1: Range, range2: Range): Range {
    return {
      start: {
        line: Math.min(range1.start.line, range2.start.line),
        character: range1.start.line < range2.start.line ? range1.start.character :
          range1.start.line > range2.start.line ? range2.start.character :
            Math.min(range1.start.character, range2.start.character),
      },
      end: {
        line: Math.max(range1.end.line, range2.end.line),
        character: range1.end.line > range2.end.line ? range1.end.character :
          range1.end.line < range2.end.line ? range2.end.character :
            Math.max(range1.end.character, range2.end.character),
      },
    };
  }

  private mergeAdjacentSpans(spans: ReadonlyArray<Range>): Range[] {
    if (spans.length <= 1) return [...spans];

    const mergedSpans: Range[] = [];
    let currentSpan: Range | undefined = spans[0];

    for (let i = 1; i < spans.length; i++) {
      const nextSpan = spans[i];

      if (currentSpan && nextSpan) {
        if (this.rangeOverlaps(currentSpan, nextSpan) || this.rangesAdjacent(currentSpan, nextSpan)) {
          currentSpan = this.mergeRanges(currentSpan, nextSpan);
        } else {
          mergedSpans.push(currentSpan);
          currentSpan = nextSpan;
        }
      } else if (nextSpan) {
        currentSpan = nextSpan;
      }
    }

    if (currentSpan) {
      mergedSpans.push(currentSpan);
    }

    return mergedSpans;
  }

  private rangesAdjacent(range1: Range, range2: Range): boolean {
    return range1.end.line === range2.start.line && range1.end.character === range2.start.character ||
      range2.end.line === range1.start.line && range2.end.character === range1.start.character;
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
    scopeTag = getFunctionScopeType(documentUri, node.parent!);
    scopeNode = findParent(node as SyntaxNode, (n) => {
      return n.type === 'program';
    }) as SyntaxNode;
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

  /* remove the span if we're inside a function, so that there is no recursive collisions */
  const result = Scope.create(scopeTag, scopeNode);
  if (nodeType === 'function' && node.parent!.type === 'program') {
    result.removeSpan(getRange(node.parent!));
  }
  return result;
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
    .filter((s: FishDocumentSymbol) => s.name === matchString && s.scope.tagValue <= 2);

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

export function getNodesInScope(scope: Scope) {
  const result: SyntaxNode[] = [];
  for (const child of getChildNodes(scope.node)) {
    if (scope.containsInTextSpan(getRange(child))) {
      result.push(child);
    }
  }
  return result;
}

//
// import { Range } from 'vscode-languageserver';
// import { SyntaxNode } from 'web-tree-sitter';
//
// export const ScopeTag = {
//   local: 0,
//   inherit: 1,
//   function: 2,
//   global: 3,
//   universal: 4,
// } as const;
//
// export type ScopeTag = keyof typeof ScopeTag;
// export type ScopeTagValue = typeof ScopeTag[ScopeTag];
//
// export class Scope {
//   public spans: Range[];
//
//   constructor(
//     public tag: ScopeTag,
//     public node: SyntaxNode,
//     private options: {
//       getTextSpanRanges?: (node: SyntaxNode) => Range[];
//       isExcludedFunction?: (node: SyntaxNode) => boolean;
//     } = {}
//   ) {
//     this.spans = this.initializeSpans();
//   }
//
//   private initializeSpans(): Range[] {
//     return this.options.getTextSpanRanges
//       ? this.options.getTextSpanRanges(this.node)
//       : this.defaultGetTextSpanRanges(this.node);
//   }
//
//   getTagValue(): ScopeTagValue {
//     return ScopeTag[this.tag];
//   }
//
//   static create(tag: ScopeTag, node: SyntaxNode, options?: Scope['options']): Scope {
//     return new Scope(tag, node, options);
//   }
//
//   removeSpan(rangeToRemove: Range): void {
//     this.spans = this.spans.flatMap(range => 
//       this.splitRange(range, rangeToRemove)
//     ).filter(range => !this.isEmptyRange(range));
//   }
//
//   private splitRange(range: Range, rangeToRemove: Range): Range[] {
//     if (!this.rangeOverlaps(range, rangeToRemove)) {
//       return [range];
//     }
//
//     const result: Range[] = [];
//
//     if (this.isBeforeRange(range.start, rangeToRemove.start)) {
//       result.push({
//         start: range.start,
//         end: { ...rangeToRemove.start }
//       });
//     }
//
//     if (this.isBeforeRange(rangeToRemove.end, range.end)) {
//       result.push({
//         start: { ...rangeToRemove.end },
//         end: range.end
//       });
//     }
//
//     return result;
//   }
//
//   fixSpan(...symbols: { scope: Scope, range: Range }[]): void {
//     const globalSymbols = symbols.filter(symbol => symbol.scope.tag === 'global');
//
//     this.spans = this.mergeRanges([
//       ...this.spans,
//       ...globalSymbols.map(symbol => symbol.range)
//     ]);
//   }
//
//   private mergeRanges(ranges: Range[]): Range[] {
//     const sortedRanges = ranges.sort((a, b) => 
//       a.start.line - b.start.line || a.start.character - b.start.character
//     );
//
//     const mergedRanges: Range[] = [];
//     let currentRange = sortedRanges[0];
//
//     for (const range of sortedRanges.slice(1)) {
//       if (this.rangeOverlaps(currentRange, range) || this.rangesAdjacent(currentRange, range)) {
//         currentRange = this.mergeRange(currentRange, range);
//       } else {
//         mergedRanges.push(currentRange);
//         currentRange = range;
//       }
//     }
//
//     mergedRanges.push(currentRange);
//     return mergedRanges;
//   }
//
//   containsInTextSpan(currentRange: Range): boolean {
//     return this.spans.some(range => 
//       this.rangeContains(range, currentRange) && !this.rangesEqual(range, currentRange)
//     );
//   }
//
//   toString(): string {
//     return `${this.tag}: ${this.spans.map((range, index) =>
//       `{${index}, ${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}}`
//     ).join(',')}`;
//   }
//
//   private defaultGetTextSpanRanges(node: SyntaxNode): Range[] {
//     const ranges: Range[] = [];
//     let currentStart = node.startPosition;
//
//     const collectRanges = (child: SyntaxNode) => {
//       if (
//         child.type === 'function_definition' &&
//         this.options.isExcludedFunction &&
//         this.options.isExcludedFunction(child)
//       ) {
//         if (this.isBeforeRange(currentStart, child.startPosition)) {
//           ranges.push(this.createRange(currentStart, child.startPosition));
//         }
//         currentStart = child.endPosition;
//       } else {
//         child.children.forEach(collectRanges);
//       }
//     };
//
//     node.children.forEach(collectRanges);
//
//     if (this.isBeforeRange(currentStart, node.endPosition)) {
//       ranges.push(this.createRange(currentStart, node.endPosition));
//     }
//
//     return ranges;
//   }
//
//   // Helper methods for range operations
//   private rangeContains(outer: Range, inner: Range): boolean {
//     return !this.isBeforeRange(inner.start, outer.start) && !this.isBeforeRange(outer.end, inner.end);
//   }
//
//   private rangesEqual(a: Range, b: Range): boolean {
//     return this.positionsEqual(a.start, b.start) && this.positionsEqual(a.end, b.end);
//   }
//
//   private rangeOverlaps(a: Range, b: Range): boolean {
//     return !this.isBeforeRange(a.end, b.start) && !this.isBeforeRange(b.end, a.start);
//   }
//
//   private rangesAdjacent(a: Range, b: Range): boolean {
//     return this.positionsEqual(a.end, b.start) || this.positionsEqual(b.end, a.start);
//   }
//
//   private mergeRange(a: Range, b: Range): Range {
//     return {
//       start: this.isBeforeRange(a.start, b.start) ? a.start : b.start,
//       end: this.isBeforeRange(a.end, b.end) ? b.end : a.end
//     };
//   }
//
//   private isBeforeRange(a: { line: number, character: number }, b: { line: number, character: number }): boolean {
//     return a.line < b.line || (a.line === b.line && a.character < b.character);
//   }
//
//   private positionsEqual(a: { line: number, character: number }, b: { line: number, character: number }): boolean {
//     return a.line === b.line && a.character === b.character;
//   }
//
//   private createRange(start: { row: number, column: number }, end: { row: number, column: number }): Range {
//     return {
//       start: { line: start.row, character: start.column },
//       end: { line: end.row, character: end.column }
//     };
//   }
//
//   private isEmptyRange(range: Range): boolean {
//     return this.positionsEqual(range.start, range.end);
//   }
// }
