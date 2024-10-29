import { FishSymbol } from './symbol.test';
import { SymbolKind, Range, Location } from 'vscode-languageserver';
import * as Locations from '../src/utils/locations';
import { SyntaxNode } from 'web-tree-sitter';

// export function getCallableRanges(currentSymbol: FishSymbol): Range[] {
//   // Early returns for invalid symbols
//   if (!currentSymbol.node || !currentSymbol.parentNode) {
//     return [];
//   }
//
//   const ranges: Range[] = [];
//   const currentScope = currentSymbol.getParentScope();
//   if (!currentScope) return ranges;
//
//   // Get the range where the current symbol is defined
//   const currentScopeRange = Locations.Range.fromNode(currentScope);
//   const symbolDefinitionRange = Locations.Range.fromNode(currentSymbol.node);
//
//   // Function to check if a range is after the current symbol's definition
//   const isAfterDefinition = (range: Range): boolean => {
//     return (
//       range.start.line > symbolDefinitionRange.start.line ||
//       range.start.line === symbolDefinitionRange.start.line &&
//         range.start.character >= symbolDefinitionRange.start.character
//     );
//   };
//
//   // Get all symbols in the current scope and its children
//   const getAllSymbolsInScope = (symbol: FishSymbol): FishSymbol[] => {
//     const symbols: FishSymbol[] = [];
//     const queue = [symbol];
//
//     while (queue.length > 0) {
//       const current = queue.shift()!;
//       symbols.push(current);
//       queue.push(...current.children);
//     }
//
//     return symbols;
//   };
//
//   const scopeSymbols = getAllSymbolsInScope(currentSymbol.parent || currentSymbol);
//
//   // Filter symbols based on name and scope rules
//   const matchingSymbols = scopeSymbols.filter(symbol => {
//     // Skip if not the same name
//     if (symbol.name !== currentSymbol.name) return false;
//
//     // Skip if it's the current symbol
//     if (symbol.equals(currentSymbol)) return false;
//
//     // Handle function symbol specific rules
//     if (currentSymbol.isFunction()) {
//       const symbolRange = Locations.Range.fromNode(symbol.node);
//       return !Locations.Range.equals(symbolRange, currentSymbol.selectionRange);
//     }
//
//     // Handle variable symbol specific rules
//     if (currentSymbol.isVariable()) {
//       if (symbol.isFunction()) {
//         const functionInfo = symbol.functionInfo;
//         if (!functionInfo) return false;
//
//         // Check if the function allows scope shadowing or inherits the variable
//         return (
//           functionInfo.noScopeShadowing ||
//           functionInfo.inheritVariable.some(v => v.name === currentSymbol.name)
//         );
//       }
//
//       // Only include ranges that come after the current symbol's definition
//       return isAfterDefinition(Locations.Range.fromNode(symbol.node));
//     }
//
//     return true;
//   });
//
//   // Convert matching symbols to ranges
//   matchingSymbols.forEach(symbol => {
//     const range = Locations.Range.fromNode(symbol.node);
//
//     // For variables, only include ranges that come after the definition
//     if (currentSymbol.isVariable() && !isAfterDefinition(range)) {
//       return;
//     }
//
//     ranges.push(range);
//   });
//
//   return ranges;
// }

/**
 * remove the functions without --no-scope-shadowing or --inherit-variable
 * @param matchSymbol the symbol to search for
 * @param symbol the symbol to check if it should be excluded
 * @returns true if the symbol should be excluded
 */
function isExcludeFunction(matchSymbol: FishSymbol, symbol: FishSymbol): boolean {
  if (!symbol.isFunction()) return false;
  return symbol.isFunction() && !(
    symbol.functionInfo?.noScopeShadowing ||
    symbol.functionInfo?.inheritVariable.some(v => v.name === matchSymbol.name)
  );
}

/**
 * remove the variable that equals the matchSymbol but is not in the same scope
 * @param matchSymbol the symbol to search for
 * @param symbol the symbol to check if it should be excluded (search in)
 * @returns true if the symbol should be excluded
 */
function isExcludeVariable(matchSymbol: FishSymbol, symbol: FishSymbol): boolean {
  // if (!symbol.isVariable()) return false;
  const children = symbol.parent.allChildren.filter(child => child.name === matchSymbol.name);
  if (children.length === 0) return false;
  return children.some(child => !child.getParentScope().equals(matchSymbol.getParentScope()));
  // return symbol.isVariable() && symbol.allChildren.some(child => {
  //   return child.name === matchSymbol.name && !child.getParentScope().equals(matchSymbol.getParentScope());
  // });
}

function getRemovableFunctionRanges(matchSymbol: FishSymbol, possibleRemove: FishSymbol): Range[] {
  const result: Range[] = [];
  for (const child of possibleRemove.allChildren) {
    if (
      child.isFunction()
      && !(
        child.functionInfo?.noScopeShadowing ||
        child.functionInfo?.inheritVariable.some(v => v.name === matchSymbol.name)
      )
    ) {
      result.push(child.range);
    }
  }
  return result;
}

function getRemovableLocalVariableRanges(matchSymbol: FishSymbol, possibleRemove: FishSymbol): Range[] {
  const result: Range[] = [];
  for (const child of possibleRemove.allChildren) {
    if (child.name === matchSymbol.name) {
      const parentScopeNode = child.getParentScope();
      const scopeRange = Locations.Range.fromNode(parentScopeNode);
      if (
        !parentScopeNode.equals(matchSymbol.getParentScope()) &&
        !result.some(r => Locations.Range.equals(r, scopeRange))
      ) {
        result.push(scopeRange);
      }
    }
  }
  return result;
}

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
  return symbol.parent?.range;
}

/**
 * TODO:
 *   - [ ] DO WE NEED TO REMOVE SYMBOLS WITH DIFFERENT MODIFIERS
 *   - [ ] DO WE NEED TO CONSIDER GLOBAL && UNIVERSAL MODIFIERS
 *   - [ ] DECIDE IF THIS IS LOCAL ONLY OR INCLUDES GLOBAL RANGES
 *   - [x] REMOVE VARIABLES REFERENCED BEFORE DEFINITION
 *   - [ ] REMOVE `console.log()` STATEMENTS
 * ---
 * @param symbol the symbol to search in
 * @returns the ranges that the symbol is referring to
 */
export function getCallableRanges2(symbol: FishSymbol): Range[] {
  // Skip if missing required nodes
  if (!symbol.node || !symbol.parentNode) return [];
  // Get parent scope and define ranges
  const parentScope = symbol.getParentScope();
  if (!parentScope) return [];

  // TODO: try to create a function (or, a single loop) which combines these two functions
  // to avoid matches that are in both resulting arrays
  const excludeFunctions = getRemovableFunctionRanges(symbol, symbol.parent);
  const excludeVariables = getRemovableLocalVariableRanges(symbol, symbol.parent);

  console.log(
    'exclude children in parent scope',
    symbol.name,
    symbol.range.start.line,
    symbol.range.start.character,
    symbol.range.end.line,
    symbol.range.end.character,
  );
  console.log('variables:');
  for (const v of excludeVariables) {
    console.log('    ', v.start.line, v.start.character, v.end.line, v.end.character);
  }
  console.log('functions:');
  for (const f of excludeFunctions) {
    console.log('    ', f.start.line, f.start.character, f.end.line, f.end.character);
  }
  console.log();

  const excludeChildren = [
    ...excludeVariables,
    ...excludeFunctions,
  ];

  let ranges: Range[] = [];
  ranges.push(createParentRange(symbol));
  for (const excludeRange of excludeChildren) {
    ranges = removeRange(ranges, excludeRange);
  }
  return ranges;
  // const excludeChildren = symbol.parent.allChildren
  //   .filter(c => isExcludeFunction(symbol, c) || isExcludeVariable(symbol, c));
  // get children to exclude in parent scope
  // const excludeChildren = symbol.parent.children
  //   // remove the functions without --no-scope-shadowing or --inherit-variable
  //   .filter(c => {
  //     return (
  //       c.isFunction() && !(
  //         c.functionInfo?.noScopeShadowing ||
  //         c.functionInfo?.inheritVariable.some(v => v.name === symbol.name)
  //       )
  //     );
  //   })
  //   // remove the ranges that contain a new definition of the variable, BUT
  //   // outside/not-inside of the current scope.
  //   .filter(c => {
  //     if (symbol.isVariable() && c.allChildren.some(child => {
  //       return child.name === symbol.name && !child.getParentScope().equals(symbol.getParentScope());
  //     })) {
  //       return true;
  //     }
  //     return true;
  //   });

  // console.log('exclude children in parent scope', symbol.name);
  // for (const c of excludeChildren) {
  //   console.log('    ', c.name, c.range.start.line, c.range.end.line);
  // }
  // console.log();
  // return excludeChildren.map(c => Locations.Range.fromNode(c.node));
  // const scopeRange = Locations.Range.fromNode(parentScope);
  // const defRange = Locations.Range.fromNode(symbol.node);
  // const ranges: Range[] = [];
  //
  // // Handle function case - use full scope except current function range
  // if (symbol.isFunction()) {
  //   ranges.push(symbol.parent.range);
  //   return removeRange(ranges, symbol.range);
  // }
  //
  // // Handle variable case
  // if (symbol.isVariable()) {
  //   // Get all symbols in parent scope
  //   const siblings = symbol.parent?.children || [];
}

export function getCallableRanges(symbol: FishSymbol): Range[] {
  let ranges: Range[] = [];
  const excludedRanges: Range[] = getRemovableRanges(symbol, symbol.parent);
  ranges.push(createParentRange(symbol)); // TODO: try just passing the symbol, to the removeRange function
  // ranges = removeRange(ranges, symbol.range);
  for (const excludeRange of excludedRanges) {
    ranges = removeRange(ranges, excludeRange);
  }
  return ranges;
}

// /**
//  * Removes a target range from a list of ranges, potentially splitting existing ranges
//  */
// function removeRange(ranges: Range[], targetRange: Range): Range[] {
//   const result: Range[] = [];
//
//   for (const range of ranges) {
//     // Case 1: Target completely after this range - keep range unchanged
//     if (range.end.line < targetRange.start.line ||
//        range.end.line === targetRange.start.line && range.end.character <= targetRange.start.character) {
//       result.push(range);
//       continue;
//     }
//
//     // Case 2: Target completely before this range - keep range unchanged
//     if (targetRange.end.line < range.start.line ||
//        targetRange.end.line === range.start.line && targetRange.end.character <= range.start.character) {
//       result.push(range);
//       continue;
//     }
//
//     // Case 3: Need to split into before and after ranges
//
//     // Add "before" range if it exists
//     if (range.start.line < targetRange.start.line ||
//        range.start.line === targetRange.start.line && range.start.character < targetRange.start.character) {
//       result.push({
//         start: range.start,
//         end: targetRange.start,
//       });
//     }
//
//     // Add "after" range if it exists
//     if (range.end.line > targetRange.end.line ||
//        range.end.line === targetRange.end.line && range.end.character > targetRange.end.character) {
//       result.push({
//         start: targetRange.end,
//         end: range.end,
//       });
//     }
//   }
//
//   return result;
// };

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
