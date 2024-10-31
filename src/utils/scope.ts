import { FishSymbol } from './symbol';
import { Position, Range } from 'vscode-languageserver';
import * as Locations from './locations';
// import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isAutoloadedFunctionPath } from './translation';

/**
 * Creates an Array of unique ranges that are reachable from the symbol definition
 *
 * A RangeList includes:
 * - the definition location (symbol.selectionRange) in the resulting list.
 * - any ranges that are reachable from the symbol definition.
 *
 * To determine reference count, the resulting list will need to be filtered for
 * unused local definitions.
 *
 * @param symbol the symbol to create the ranges from
 * @returns the local ranges of reference locations for a symbol
 */
export function getCallableRanges(symbol: FishSymbol): Range[] {
  const list = new RangesList();
  const parentScopeRange = symbol.getParentScopeRange();
  if (symbol.isFunction()) {
    // autoloaded function or autoloaded private function which are callable throughout
    // entire file. `symbol.range` is removed to prevent recursion in the case of
    // using these ranges for completion
    if (symbol.parent?.isRoot() && isAutoloadedFunctionPath(symbol.uri)) {
      list.addRange(symbol.parent.range);
      list.removeRange(symbol.range);
      list.addRange(symbol.selectionRange);
      return list.getRanges();
    }
    // Regular local functions are only callable after their definition
    if (symbol.parent?.isRoot() && !isAutoloadedFunctionPath(symbol.uri)) {
      list.addRange({
        start: symbol.range.start,
        end: parentScopeRange.end,
      });
      list.removeRange(symbol.range);
      list.addRange(symbol.selectionRange);
      return list.getRanges();
    }
    // Nested function - only callable within parent function after definition
    if (symbol.parent?.isFunction()) {
      list.addRange(symbol.parent.range);
      list.removeRange({
        start: symbol.parent.range.start,
        end: symbol.range.end,
      });
      list.addRange(symbol.selectionRange);
      symbol.parent?.allChildren
        .filter(c => {
          return Locations.Range.isAfter(c.range, symbol.range)
            && c.isFunction();
        }).forEach(s => {
          list.removeRange(s.range);
        });
      return list.getRanges();
    }
  }
  if (symbol.isVariable()) {
    // Both local and global variables are only accessible after definition
    // NOTE: This might change depending on further testing! symbol.isLocalScope() || symbol.isGlobalScope()
    list.addRange({
      start: symbol.selectionRange.start,
      end: parentScopeRange.end,
    });
    list.addRange(symbol.selectionRange);

    /** remove all Symbols before the symbol definition */
    const parentChildrenAfter = symbol.parent!.allChildren
      .filter(c =>
        Locations.Range.containsRange(parentScopeRange, c.range)
        && Locations.Range.isAfter(c.range, symbol.selectionRange),
      );

    /** overrideSkip is used to ensure we don't remove certain function ranges */
    const overrideSkip: Range[] = [];

    for (const child of parentChildrenAfter) {
      if (child.isFunction()) {
        if (
          child.functionInfo?.inheritVariable.some(v => v.name === symbol.name)
          || child.functionInfo?.noScopeShadowing
        ) {
          list.addRange(child.range);
          overrideSkip.push(
            ...child.allChildren
              .filter(c => c.isVariable()
                && c.name === symbol.name
                && c.modifier === 'FUNCTION',
              ).map(c => c.range),
          );
          continue;
        }

        list.removeRange(child.range);
        continue;
      }

      /** remove redefined symbols with different scope (notice `overrideSkip`) */
      const childScopeRange = child.getParentScopeRange();
      if (
        child.isVariable()
        && child.name === symbol.name
        && !Locations.Range.equals(childScopeRange, parentScopeRange)
        && !overrideSkip.some(r => Locations.Range.equals(r, child.range))
      ) {
        list.removeRange(childScopeRange);
      }
    }
    return list.getRanges();
  }
  return list.getRanges();
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

export class RangesList {
  private ranges: Range[] = [];

  constructor(initialRange?: Range) {
    if (initialRange) {
      this.ranges.push(initialRange);
    }
  }

  /**
   * Checks if a position is within a range
   */
  private isPositionInRange(position: Position, range: Range): boolean {
    const afterStart =
      position.line > range.start.line ||
      position.line === range.start.line && position.character >= range.start.character
      ;
    const beforeEnd =
      position.line < range.end.line ||
      position.line === range.end.line && position.character <= range.end.character
      ;
    return afterStart && beforeEnd;
  }

  /**
   * Checks if two ranges overlap
   */
  private doRangesOverlap(range1: Range, range2: Range): boolean {
    return (
      this.isPositionInRange(range1.start, range2) ||
      this.isPositionInRange(range1.end, range2) ||
      this.isPositionInRange(range2.start, range1) ||
      this.isPositionInRange(range2.end, range1)
    );
  }

  /**
   * Compares two positions
   * Returns negative if pos1 < pos2, 0 if equal, positive if pos1 > pos2
   */
  private comparePositions(pos1: Position, pos2: Position): number {
    if (pos1.line !== pos2.line) {
      return pos1.line - pos2.line;
    }
    return pos1.character - pos2.character;
  }

  /**
   * Gets the index where a range should be inserted to maintain order
   */
  private getInsertIndex(range: Range): number {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.comparePositions(range.start, this.ranges[i]!.start) <= 0) {
        return i;
      }
    }
    return this.ranges.length;
  }

  /**
   * Adds a range to the list, maintaining order
   */
  public addRange(range: Range): void {
    const insertIndex = this.getInsertIndex(range);

    // Check for overlaps with existing ranges
    const overlappingRanges = this.ranges.filter(r => this.doRangesOverlap(r, range));
    if (overlappingRanges.length > 0) {
      // Merge overlapping ranges
      const mergedRange: Range = {
        start: overlappingRanges.reduce(
          (min, r) => this.comparePositions(min, r.start) <= 0 ? min : r.start,
          range.start,
        ),
        end: overlappingRanges.reduce(
          (max, r) => this.comparePositions(max, r.end) >= 0 ? max : r.end,
          range.end,
        ),
      };

      // Remove all overlapping ranges
      this.ranges = this.ranges.filter(r => !overlappingRanges.includes(r));

      // Insert merged range
      this.ranges.splice(this.getInsertIndex(mergedRange), 0, mergedRange);
    } else {
      // No overlaps, just insert the new range
      this.ranges.splice(insertIndex, 0, range);
    }
  }

  /**
   * Removes a range from the list, splitting existing ranges if necessary
   */
  public removeRange(range: Range): void {
    const newRanges: Range[] = [];

    for (const existing of this.ranges) {
      if (!this.doRangesOverlap(existing, range)) {
        // Keep non-overlapping ranges unchanged
        newRanges.push(existing);
        continue;
      }

      // Handle range splitting
      if (this.comparePositions(existing.start, range.start) < 0) {
        // Add portion before removal
        newRanges.push({
          start: existing.start,
          end: range.start,
        });
      }

      if (this.comparePositions(range.end, existing.end) < 0) {
        // Add portion after removal
        newRanges.push({
          start: range.end,
          end: existing.end,
        });
      }
    }

    this.ranges = newRanges.sort((a, b) =>
      this.comparePositions(a.start, b.start),
    );
  }

  /**
   * Returns all current ranges
   */
  public getRanges(): Range[] {
    return [...this.ranges];
  }

  /**
   * Checks if a position is contained in any range
   */
  public isPositionInAnyRange(position: Position): boolean {
    return this.ranges.some(range => this.isPositionInRange(position, range));
  }

  /**
   * Gets the containing range for a position, if any
   */
  public getContainingRange(position: Position): Range | undefined {
    return this.ranges.find(range => this.isPositionInRange(position, range));
  }
}