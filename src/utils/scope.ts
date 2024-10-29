import { FishSymbol } from './symbol';
import { Range } from 'vscode-languageserver';
import * as Locations from './locations';
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
function createParentRange(symbol: FishSymbol): Range {
  if (symbol.isVariable() && symbol.isLocalScope()) {
    const parentScopeNode = symbol.getParentScope();
    const parentScopeRange = Locations.Range.fromNode(parentScopeNode);
    return {
      start: {
        line: symbol.range.start.line,
        character: symbol.range.start.character,
      },
      end: {
        line: parentScopeRange.end.line,
        character: parentScopeRange.end.character,
      },
    };
  }
  if (symbol.isFunction() && symbol.parent?.isFunction()) {
    return {
      start: {
        line: symbol.range.end.line,
        character: symbol.range.end.character,
      },
      end: {
        line: symbol.parent.range.end.line,
        character: symbol.parent.range.end.character,
      },
    };
  }
  return symbol.parent?.range || symbol.range;
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
