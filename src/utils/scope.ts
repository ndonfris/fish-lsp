import { FishSymbol } from './symbol';
import { Range } from 'vscode-languageserver';
import * as Locations from './locations';
import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';

function getRemovableRanges(matchSymbol: FishSymbol, possibleRemove: FishSymbol): Range[] {
  const result: Range[] = [];
  for (const child of possibleRemove.allChildren) {
    // function
    if (
      child.isFunction()
      && !(
        child.functionInfo?.noScopeShadowing ||
        child.functionInfo?.inheritVariable.some(v => v.name === matchSymbol.name)
      )
      && !result.some(s => Locations.Range.equals(s, child.range))
    ) {
      result.push(child.range);
      continue;
    }
    // variable
    if (child.name === matchSymbol.name) {
      const parentScopeNode = child.getParentScope();
      const scopeRange = Locations.Range.fromNode(parentScopeNode);
      if (
        !parentScopeNode.equals(matchSymbol.getParentScope()) &&
        !result.some(r => Locations.Range.equals(r, scopeRange))
      ) {
        result.push(scopeRange);
        continue;
      }
    }
  }
  return result;
}

/**
 * handles creating parent range for callable ranges, handling special cases
 * including:
 *    1. variable in local scope - removes the parent scope before the definition
 *    2. function in function - removes any call to a function before the definition
 *    3. handles the default case of just using the parent range
 * @param symbol the symbol to create the parent range for
 * @returns the range for the local references of a symbol
 */
export function createParentRange(symbol: FishSymbol): Range {
  //if (symbol.isVariable() && symbol.isLocalScope()) {
  //  const parentScopeNode = symbol.getParentScope();
  //  const parentScopeRange = Locations.Range.fromNode(parentScopeNode);
  //  return {
  //    start: {
  //      line: symbol.range.start.line,
  //      character: symbol.range.start.character,
  //    },
  //    end: {
  //      line: parentScopeRange.end.line,
  //      character: parentScopeRange.end.character,
  //    },
  //  };
  //}
  //if (symbol.isFunction() && symbol.parent?.isFunction()) {
  //  return {
  //    start: {
  //      line: symbol.range.end.line,
  //      character: symbol.range.end.character,
  //    },
  //    end: {
  //      line: symbol.parent.range.end.line,
  //      character: symbol.parent.range.end.character,
  //    },
  //  };
  //}
  //return symbol.parent!.range || Locations.Range.fromNode(symbol.getParentScope());
  const parent = symbol.parent!;
  let { start, end } = parent.range;
  if (symbol.isVariable()) {
    if (parent.isFunction()) {
      if (
        parent.functionInfo!.argumentNames.some(v => v.equals(symbol))
        || parent.functionInfo!.inheritVariable.some(v => v.equals(symbol))
      ) {
        return parent.range;
      }
      start = symbol.range.start;
      return { start, end };
    }
  }
  if (symbol.isFunction() && parent.isFunction()) {
    start = symbol.range.end;
    return { start, end };
  }
  return parent.range;
}

export function getCallableRanges(symbol: FishSymbol): Range[] {
  let ranges: Range[] = [];
  const excludedRanges: Range[] = getRemovableRanges(symbol, symbol.parent!);
  ranges.push(createParentRange(symbol));
  // ranges = removeRange(ranges, symbol.range);
  for (const excludeRange of excludedRanges) {
    ranges = removeRange(ranges, excludeRange);
  }
  return ranges;
}

/**
 * Get all nodes within a given range using proper TreeCursor traversal
 */
function getNodesInRange(root: SyntaxNode, range: Range): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  const cursor = root.walk();

  function visitNode() {
    const node = cursor.currentNode;

    if (Locations.Range.containsRange(range, Locations.Range.fromNode(node))) {
      nodes.push(node);
    }

    // Traverse children
    if (cursor.gotoFirstChild()) {
      do {
        visitNode();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }

  visitNode();
  return nodes;
}
// function getNodesInRange(root: SyntaxNode, range: Range): SyntaxNode[] {
//   const nodes: SyntaxNode[] = [];
//   const cursor = root.walk();
//
//   while (cursor.gotoNextSibling()) {
//     const node = cursor.currentNode;
//     const nodeRange = Locations.Range.fromNode(node);
//
//     if (nodeRange.start.line >= range.start.line &&
//         nodeRange.end.line <= range.end.line) {
//       nodes.push(node);
//     }
//   }
//
//   return nodes;
// }

/**
  * Convert a list of ranges to a list of nodes that fall within those ranges
  */
export function rangesToNodes(ranges: Range[], root: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  ranges.forEach(range => {
    nodes.push(...getNodesInRange(root, range));
  });
  return nodes;
}

/**
  * Creates a new Array of Ranges that excludes a specific range
  * If the excluded range is fully contained within a range, it splits that range into two
  *
  * @param ranges The input array of Ranges
  * @param excludeRange The Range to exclude
  * @returns Array of Ranges with the excluded range removed
  */
export function removeRange(ranges: Range[], excludeRange: Range): Range[] {
  const result: Range[] = [];

  for (const range of ranges) {
    // Skip if range is  exactly the same as excludeRange
    if (Locations.Range.equals(range, excludeRange)) {
      continue;
    }

    // If excludeRange is fully contained within the current range
    if (range.start.line <= excludeRange.start.line && range.end.line >= excludeRange.end.line) {
      // Add range before excludeRange if it exists
      if (range.start.line < excludeRange.start.line ||
        range.start.line === excludeRange.start.line && range.start.character < excludeRange.start.character) {
        result.push({
          start: range.start,
          end: {
            line: excludeRange.start.line,
            character: excludeRange.start.character,
          },
        });
      }

      // Add range after excludeRange if it exists
      if (range.end.line > excludeRange.end.line ||
        range.end.line === excludeRange.end.line && range.end.character > excludeRange.end.character) {
        result.push({
          start: {
            line: excludeRange.end.line,
            character: excludeRange.end.character,
          },
          end: range.end,
        });
      }
    } else {
      // Range doesn't overlap with excludeRange, keep it as is
      result.push(range);
    }
  }

  return result;
}

// export class RangeList {
//   private ranges: Range[];
//
//   constructor(initialRange: Range) {
//     this.ranges = [initialRange];
//   }
//
//   /**
//    * Add ranges to the list
//    */
//   public add(...newRanges: Range[]): void {
//     for (const range of newRanges) {
//       // Only add if it doesn't overlap with existing ranges
//       if (!this.ranges.some(r => this.overlaps(r, range))) {
//         this.ranges.push(range);
//       }
//     }
//     // this.sort();
//   }
//
//   /**
//    * Remove ranges from the list
//    */
//   public remove(...rangesToRemove: Range[]): void {
//     for (const removeRange of rangesToRemove) {
//       this.ranges = this.ranges.flatMap(existingRange => {
//         // If ranges don't overlap, keep existing range as is
//         if (!this.overlaps(existingRange, removeRange)) {
//           return [existingRange];
//         }
//
//         // Split the range if necessary
//         const results: Range[] = [];
//
//         // Add part before the removal range
//         if (this.isBefore(existingRange.start, removeRange.start)) {
//           results.push({
//             start: existingRange.start,
//             end: removeRange.start,
//           });
//         }
//
//         // Add part after the removal range
//         if (this.isBefore(removeRange.end, existingRange.end)) {
//           results.push({
//             start: removeRange.end,
//             end: existingRange.end,
//           });
//         }
//
//         return results;
//       });
//     }
//     // this.sort();
//   }
//
//   /**
//    * Get current ranges
//    */
//   public getRanges(): Range[] {
//     return [...this.ranges];
//   }
//
//   private overlaps(a: Range, b: Range): boolean {
//     return !this.isBefore(a.end, b.start) && !this.isBefore(b.end, a.start);
//   }
//
//   private isBefore(a: Position, b: Position): boolean {
//     return a.line < b.line || a.line === b.line && a.character < b.character;
//   }
//
//   // private sort(): void {
//   //   this.ranges.sort((a, b) =>
//   //     a.start.line !== b.start.line
//   //       ? a.start.line - b.start.line
//   //       : a.start.character - b.start.character,
//   //   );
//   // }
// }
export class RangeList {
  private ranges: LSP.Range[];

  constructor(initialRange: LSP.Range) {
    this.ranges = [initialRange];
  }

  /**
   * Add a range to the list
   * If it overlaps with existing ranges, it will be merged
   */
  public add(range: LSP.Range): void {
    // Don't add empty ranges
    if (Locations.Range.isEmpty(range)) return;

    // Check if range already exists
    for (const existing of this.ranges) {
      if (Locations.Range.equals(existing, range)) return;
    }

    this.ranges.push(range);
    this.normalize();
  }

  /**
   * Remove a range from the list, splitting existing ranges if necessary
   * Maintains the exact behavior of the original removeRange function
   */
  public remove(excludeRange: LSP.Range): void {
    const result: LSP.Range[] = [];

    for (const range of this.ranges) {
      // Skip if range is exactly the same as excludeRange
      if (Locations.Range.equals(range, excludeRange)) {
        continue;
      }

      // If excludeRange is fully contained within the current range
      if (range.start.line <= excludeRange.start.line && range.end.line >= excludeRange.end.line) {
        // Add range before excludeRange if it exists
        if (range.start.line < excludeRange.start.line ||
          range.start.line === excludeRange.start.line && range.start.character < excludeRange.start.character) {
          result.push({
            start: range.start,
            end: {
              line: excludeRange.start.line,
              character: excludeRange.start.character,
            },
          });
        }

        // Add range after excludeRange if it exists
        if (range.end.line > excludeRange.end.line ||
          range.end.line === excludeRange.end.line && range.end.character > excludeRange.end.character) {
          result.push({
            start: {
              line: excludeRange.end.line,
              character: excludeRange.end.character,
            },
            end: range.end,
          });
        }
      } else {
        // Range doesn't overlap with excludeRange, keep it as is
        result.push(range);
      }
    }

    this.ranges = result;
  }

  /**
   * Convert the RangeList to an array of Ranges
   */
  public toArray(): LSP.Range[] {
    return [...this.ranges];
  }

  /**
   * Get the current number of ranges
   */
  public size(): number {
    return this.ranges.length;
  }

  private normalize(): void {
    // Sort ranges by start position
    this.ranges.sort((a, b) => {
      if (a.start.line !== b.start.line) {
        return a.start.line - b.start.line;
      }
      return a.start.character - b.start.character;
    });

    // Merge overlapping ranges
    const merged: LSP.Range[] = [];
    let current: LSP.Range | undefined = undefined;

    for (const range of this.ranges) {
      if (!current) {
        current = range;
        continue;
      }

      // Check if ranges overlap or are adjacent
      if (current.end.line > range.start.line ||
        current.end.line === range.start.line && current.end.character >= range.start.character) {
        // Merge ranges
        current = {
          start: current.start,
          end: {
            line: Math.max(current.end.line, range.end.line),
            character: current.end.line > range.end.line ? current.end.character :
              range.end.line > current.end.line ? range.end.character :
                Math.max(current.end.character, range.end.character),
          },
        };
      } else {
        merged.push(current);
        current = range;
      }
    }

    if (current) {
      merged.push(current);
    }

    this.ranges = merged;
  }
}