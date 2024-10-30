import * as LSP from 'vscode-languageserver';
import { SymbolKind, Range, Location } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { setLogger } from './logger-setup';
import { initializeParser } from '../src/parser';
import * as Locations from '../src/utils/locations';
import { flattenNested } from '../src/utils/flatten';
import { buildScopedSymbol, FishSymbol } from '../src/utils/symbol';
import { getCallableRanges, getCallableRanges2, rangesToNodes, removeRange } from './scope';
import { createParentRange, RangeList } from '../src/utils/scope';
import { getChildNodes } from '../src/utils/tree-sitter';

type HashSyntaxNodeKey = `${LSP.DocumentUri} ${SyntaxNode['id']} ${string}`;
const HashSyntaxNode = (uri: LSP.DocumentUri, parentNode: SyntaxNode, node: SyntaxNode): HashSyntaxNodeKey => `${uri} ${parentNode.id} ${node.text}`;

export function logFishsymbols(syms: FishSymbol[], indent: string = '') {
  const symbolKindStr = (s: FishSymbol | null) => s.kind === SymbolKind.Null ? '' : s.kind === SymbolKind.Variable ? '' : 'ƒ';
  const getNameKindStr = (s: FishSymbol | null) => `${symbolKindStr(s)} ${s?.name.trim() || 'root'}`;
  const getNodeStr = (n: SyntaxNode | null) => `${n?.type || 'null'} | ${n?.text.split('\n').at(0)?.slice(0, 15) || 'null'}`;
  for (const s of syms) {
    const strMain = new String(indent + getNameKindStr(s)).padEnd(25);
    const strParent = getNameKindStr(s.parent).padEnd(15);
    const modifier = s.modifier.padEnd(10);
    const strRange = Locations.Range.toString(s.range).padEnd(15, ' ') + Locations.Range.toString(s.selectionRange).padEnd(15);
    // const strNode = getNodeStr(s.node).padEnd(40, '.');
    // const strParentNode = getNodeStr(s.parentNode).padEnd(15);
    // eslint-disable-next-line no-console
    console.log(strMain + strParent + modifier + strRange);
    // console.log(strMain + strParent + modifier + strRange + strNode + strParentNode);
    // console.log(strMain + modifier + strRange + strNode + strParentNode);
    logFishsymbols(s.children, indent + ' '.repeat(4));
  }
}

function buildUniqueMapOfSymbols(symbols: FishSymbol[]): Map<string, FishSymbol[]> {
  const resultMap: Map<string, FishSymbol[]> = new Map<string, FishSymbol[]>();
  for (const symbol of symbols) {
    const key = HashSyntaxNode(symbol.uri, symbol.getParentScope(), symbol.node);
    // if (!resultMap.has(key)) resultMap.set(key, []);
    const arr = resultMap.get(key) || [];
    resultMap.set(key, [...arr, symbol]);
  }
  return resultMap;
}

const rangeStr = (n: SyntaxNode) => Locations.Range.fromNodeToString(n);

function logNode(node: SyntaxNode) {
  // const rangeStr = Locations.Range.fromNodeToString(node);
  // const parent = findParentNonNull(node, (n) => isType(n, 'command', 'function_definition', 'for_statement', 'program'))!;
  // if (parent) {
  //   console.log(node.type, '|', node.text, '|', rangeStr, '|', parent?.type, '|', parent?.text);
  //   return;
  // }
  console.log('   ', node.type, '|', node.text, '|', rangeStr);
}

function findSearchableRanges(symbol: FishSymbol): Range[] {
  const ranges: Range[] = [];
  const rangeList = new RangeList(createParentRange(symbol));
  for (const child of symbol.parent.allChildren) {
    if (child.name === symbol.name) {
      const parentScopeNode = child.getParentScope();
      const scopeRange = Locations.Range.fromNode(parentScopeNode);
      if (!parentScopeNode.equals(symbol.getParentScope())) {
        rangeList.remove(scopeRange);
      }
    }
  }
  rangeList.add(symbol.selectionRange);
  return rangeList.toArray();
}

// function findSearchableRanges(symbol: FishSymbol): Range[] {
//   // const result: Range[] = [];
//
//   // const rangeList = new RangeList(Locations.Range.fromNode(symbol.getParentScope()));
//   const rangeList = new RangeList(createParentRange(symbol));
//
//   const isFunctionInheritingSymbol = (sym: FishSymbol, child: FishSymbol) => {
//     return !!child.functionInfo!.noScopeShadowing ||
//       !!child.functionInfo!.inheritVariable.some(v => v.name === sym.name);
//   };
//
//   if (symbol.isFunction()) {
//     if (symbol.parent.isFunction()) {
//       rangeList.remove({start: symbol.parent.range.start, end: symbol.range.end})
//       symbol.parent?.allChildren
//         .filter(c => c.isFunction() && !c.functionInfo?.noScopeShadowing)
//         .forEach(c => rangeList.remove(c.range));
//
//     } else {
//       for (const child of symbol.parent.allChildren) {
//         if (child.isFunction() && !child.parent.isFunction() && !child.functionInfo?.noScopeShadowing) {
//           rangeList.remove(child.range);
//         }
//       }
//     }
//   }
//
//   if (symbol.isVariable()) {
//     const includedRanges: Range[] = [];
//     for (const child of symbol.parent.allChildren) {
//       if (Locations.Range.isBefore(child.range, symbol.range)) continue;
//       if (child.name === symbol.name) {
//         if (child.parent.isFunction() && isFunctionInheritingSymbol(symbol, child)) {
//           includedRanges.push(child.parent.range);
//         }
//         const parentScopeNode = child.getParentScope();
//         const scopeRange = Locations.Range.fromNode(parentScopeNode);
//         if ()
//         if (!parentScopeNode.equals(symbol.getParentScope())) {
//           rangeList.remove(scopeRange);
//         }
//       }
//     }
//     if (symbol.parent.isFunction() && symbol.parent.functionInfo?.noScopeShadowing) {
//       rangeList.remove(symbol.parent.range);
//     }
//   }
//   for (const child of symbol.parent.allChildren) {
//     if (
//       child.isFunction()
//       // && !(
//       //   child.functionInfo?.noScopeShadowing ||
//       //   child.functionInfo?.inheritVariable.some(v => v.name === symbol.name)
//       // )
//     ) {
//       if (
//         Locations.Range.isBefore(symbol.selectionRange, child.selectionRange)
//           && isFunctionInheritingSymbol(symbol, child)
//       ) {
//       }
//       const parentScopeNode = child.getParentScope();
//       const scopeRange = Locations.Range.fromNode(parentScopeNode);
//       rangeList.remove(child.range);
//       continue;
//     }
//     // variable
//     if (child.name === symbol.name) {
//       const parentScopeNode = child.getParentScope();
//       const scopeRange = Locations.Range.fromNode(parentScopeNode);
//
//       // const isMatchingModifiers =
//       //   child.isGlobalScope() && symbol.isGlobalScope() ||
//       //   child.isLocalScope() && symbol.isLocalScope();
//
//       // if (
//       //   !isMatchingModifiers
//       //   && !result.some(r => Locations.Range.equals(r, scopeRange))) {
//       //   rangeList.remove(scopeRange);
//       //   continue;
//       // }
//
//       // if (
//       //   !parentScopeNode.equals(symbol.getParentScope()) &&
//       //   !result.some(r => Locations.Range.equals(r, scopeRange))
//       // ) {
//       if (!parentScopeNode.equals(symbol.getParentScope())) {
//         rangeList.remove(scopeRange);
//         continue;
//       }
//     }
//   }
//   rangeList.add(symbol.selectionRange);
//   return rangeList.toArray();
// }

function findNodesInRanges(ranges: Range[], root: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (const child of getChildNodes(root)) {
    if (ranges.some(r => Locations.Range.containsRange(r, Locations.Range.fromNode(child)))) {
      result.push(child);
    }
  }
  return result;
}
/**
 * Checks if a symbol is in an autoloaded function file
 */
function isInAutoloadedFile(symbol: FishSymbol): boolean {
  return symbol.uri.includes('/functions/') ||
    symbol.uri.includes('\\functions\\');
}

/**
 * Finds functions that inherit a specific variable name
 */
function findInheritingFunctions(symbol: FishSymbol): FishSymbol[] {
  // Only proceed if this is a variable
  if (!symbol.isVariable()) {
    return [];
  }

  // Get all function symbols in the same scope
  const programScope = symbol.getParentScope();
  if (!programScope) return [];

  // Find all functions that inherit this variable
  const inheritingFunctions: FishSymbol[] = [];

  // Recursively search through symbol tree
  function searchForInheritingFunctions(currentSymbol: FishSymbol) {
    if (currentSymbol.isFunction() &&
      currentSymbol.functionInfo?.inheritVariable.some(v => v.name === symbol.name)) {
      inheritingFunctions.push(currentSymbol);
    }

    for (const child of currentSymbol.children) {
      searchForInheritingFunctions(child);
    }
  }

  // Start search from the program scope
  const rootSymbol = symbol.parent || symbol;
  searchForInheritingFunctions(rootSymbol);

  return inheritingFunctions;
}

/**
 * Gets all ranges where a symbol can be called/referenced
 */
export function getCallableRanges(symbol: FishSymbol): Range[] {
  const ranges: Range[] = [symbol.selectionRange];

  if (!symbol.parentNode || !symbol) {
    return ranges;
  }

  // Get base ranges based on normal scoping rules
  const baseRanges = getBaseCallableRanges(symbol);
  ranges.push(...baseRanges);

  // Handle variable inheritance
  if (symbol.isVariable()) {
    const inheritingFunctions = findInheritingFunctions(symbol);

    for (const func of inheritingFunctions) {
      // Only include function's range if it's defined after the variable
      if (symbol.selectionRange.end.line < func.selectionRange.start.line) {
        ranges.push(func.range);
      }
    }
  }

  return ranges;
}

/**
 * Gets the base callable ranges without considering inheritance
 */
function getBaseCallableRanges(symbol: FishSymbol): Range[] {
  const ranges: Range[] = [];

  function collectChildRanges(currentSymbol: FishSymbol): void {
    if (!currentSymbol.isFunction() || currentSymbol !== symbol) {
      ranges.push(currentSymbol.range);
    }

    for (const child of currentSymbol.children) {
      if (shouldSkipChild(symbol, child)) {
        continue;
      }

      if (symbol.isLocalScope() && !isInLocalScope(symbol, child)) {
        continue;
      }

      collectChildRanges(child);
    }
  }

  if (symbol.isFunction()) {
    // Handle nested function definitions
    if (symbol.parent?.isFunction()) {
      const parentFunctionRange = symbol.parent.range;
      ranges.push({
        start: {
          line: symbol.range.end.line,
          character: 0,
        },
        end: parentFunctionRange.end,
      });
      return ranges;
    }

    // Handle top-level functions
    if (isInAutoloadedFile(symbol)) {
      const fileScope = symbol.getParentScopeRange();
      if (fileScope) {
        ranges.push(
          {
            start: fileScope.start,
            end: symbol.range.start,
          },
          {
            start: symbol.range.end,
            end: fileScope.end,
          },
        );
      }
    } else if (symbol.functionInfo?.isAutoLoad) {
      const programScope = symbol.getParentScopeRange();
      if (programScope) {
        ranges.push(
          {
            start: programScope.start,
            end: symbol.range.start,
          },
          {
            start: symbol.range.end,
            end: programScope.end,
          },
        );
      }
    } else {
      const programScope = symbol.getParentScopeRange();
      if (programScope) {
        ranges.push({
          start: {
            line: symbol.range.end.line,
            character: symbol.range.end.character,
          },
          end: programScope.end,
        });
      }
    }
  } else {
    switch (symbol.modifier) {
      case 'UNIVERSAL':
        ranges.push(symbol.getParentScopeRange());
        break;

      case 'GLOBAL':
        collectChildRanges(symbol);
        break;

      case 'FUNCTION':
      case 'LOCAL':
        ranges.push(symbol.getParentScopeRange());
        break;
    }
  }

  return ranges;
}

/**
 * Determines if a child symbol should be skipped when collecting ranges
 */
function shouldSkipChild(symbol: FishSymbol, child: FishSymbol): boolean {
  if (child.name === symbol.name) {
    return true;
  }

  if (child.isFunction() &&
    !child.functionInfo?.noScopeShadowing &&
    symbol.isGlobalScope()) {
    return true;
  }

  if (symbol.isFunction() && isInFunctionRange(symbol.range, child.range)) {
    return true;
  }

  return false;
}

/**
 * Checks if one range is completely contained within another
 */
function isInFunctionRange(outer: Range, inner: Range): boolean {
  return outer.start.line <= inner.start.line &&
    outer.end.line >= inner.end.line;
}

/**
 * Checks if a symbol is within the local scope of another symbol
 */
function isInLocalScope(symbol: FishSymbol, other: FishSymbol): boolean {
  const symbolScope = symbol.getParentScopeRange();
  const otherScope = other.getParentScopeRange();

  if (!symbolScope || !otherScope) {
    return false;
  }

  return symbolScope.start.line <= otherScope.start.line &&
    symbolScope.end.line >= otherScope.end.line;
}

// /**
//  * Checks if a symbol is in an autoloaded function file
//  */
// function isInAutoloadedFile(symbol: FishSymbol): boolean {
//   return symbol.uri.includes('/functions/') ||
//     symbol.uri.includes('\\functions\\');
// }
//
// /**
//  * Gets all ranges where a symbol can be called/referenced, taking into account
//  * scope rules and symbol visibility.
//  *
//  * @param symbol The FishSymbol to find callable ranges for
//  * @returns Array of Ranges where the symbol can be called
//  */
// export function getCallableRanges(symbol: FishSymbol): Range[] {
//   const ranges: Range[] = [];
//
//   // Base case: if no parent node or symbol, return empty array
//   if (!symbol.parentNode || !symbol) {
//     return ranges;
//   }
//
//   // Helper function to recursively collect ranges from child symbols
//   function collectChildRanges(currentSymbol: FishSymbol): void {
//     // Skip the current symbol's own range if it's a function (no recursion)
//     if (!currentSymbol.isFunction() || currentSymbol !== symbol) {
//       ranges.push(currentSymbol.range);
//     }
//
//     // Recursively process children based on scope rules
//     for (const child of currentSymbol.children) {
//       // Skip processing if child scope shouldn't have access
//       if (shouldSkipChild(symbol, child)) {
//         continue;
//       }
//
//       // For local variables, only include ranges within their block scope
//       if (symbol.isLocalScope() && !isInLocalScope(symbol, child)) {
//         continue;
//       }
//
//       collectChildRanges(child);
//     }
//   }
//
//   if (symbol.isFunction()) {
//     // Handle nested function definitions
//     if (symbol.parent?.isFunction()) {
//       // Nested function - only callable within parent function after definition
//       const parentFunctionRange = symbol.parent.range;
//       ranges.push({
//         start: {
//           line: symbol.range.end.line,
//           character: symbol.range.end.line,
//         },
//         end: parentFunctionRange.end,
//       });
//       return ranges;
//     }
//
//     // Handle top-level functions
//     if (isInAutoloadedFile(symbol)) {
//       // Functions in autoload directory
//       const fileScope = symbol.getParentScope();
//       if (fileScope) {
//         // Callable throughout file except within itself
//         const fileRange = Locations.Range.fromNode(fileScope);
//         const beforeFunction = {
//           start: fileRange.start,
//           end: symbol.range.start,
//         };
//         const afterFunction = {
//           start: symbol.range.end,
//           end: fileRange.end,
//         };
//         ranges.push(beforeFunction, afterFunction);
//       }
//     } else if (symbol.functionInfo?.isAutoLoad) {
//       // Global autoloaded function
//       const programNode = symbol.getParentScope();
//       if (programNode) {
//         const programScope = Locations.Range.fromNode(programNode);
//         // Callable everywhere except within itself
//         const beforeFunction = {
//           start: programScope.start,
//           end: symbol.range.start,
//         };
//         const afterFunction = {
//           start: symbol.range.end,
//           end: programScope.end,
//         };
//         ranges.push(beforeFunction, afterFunction);
//       }
//     } else {
//       // Regular function - only callable after definition
//       const programNode = symbol.getParentScope();
//       if (programNode) {
//         const programScope = Locations.Range.fromNode(programNode);
//         ranges.push({
//           start: {
//             line: symbol.range.end.line,
//             character: symbol.range.end.line,
//           },
//           end: programScope.end,
//         });
//       }
//     }
//   } else {
//     // Handle non-function symbols
//     switch (symbol.modifier) {
//       case 'UNIVERSAL':
//         ranges.push(Locations.Range.fromNode(symbol.getParentScope()));
//         break;
//
//       case 'GLOBAL':
//         collectChildRanges(symbol);
//         break;
//
//       case 'FUNCTION':
//       case 'LOCAL':
//         ranges.push(Locations.Range.fromNode(symbol.getParentScope()));
//         break;
//     }
//   }
//
//   return ranges;
// }
//
// /**
//  * Determines if a child symbol should be skipped when collecting ranges
//  */
// function shouldSkipChild(symbol: FishSymbol, child: FishSymbol): boolean {
//   // Skip if child shadows the symbol name
//   if (child.name === symbol.name) {
//     return true;
//   }
//
//   // Skip if child is in a function that shadows scope (unless noScopeShadowing is true)
//   if (child.isFunction() &&
//     !child.functionInfo?.noScopeShadowing &&
//     symbol.isGlobalScope()) {
//     return true;
//   }
//
//   // Skip if we're inside the function's own definition (prevent recursion)
//   if (symbol.isFunction() && isInFunctionRange(symbol.range, child.range)) {
//     return true;
//   }
//
//   return false;
// }
//
// /**
//  * Checks if one range is completely contained within another
//  */
// function isInFunctionRange(outer: Range, inner: Range): boolean {
//   return outer.start.line <= inner.start.line &&
//     outer.end.line >= inner.end.line;
// }
//
// /**
//  * Checks if a symbol is within the local scope of another symbol
//  */
// function isInLocalScope(symbol: FishSymbol, other: FishSymbol): boolean {
//   const symbolScope = symbol.getParentScope();
//   const otherScope = other.getParentScope();
//
//   if (!symbolScope || !otherScope) {
//     return false;
//   }
//
//   const symbolRange = Locations.Range.fromNode(symbolScope);
//   const otherRange = Locations.Range.fromNode(otherScope);
//
//   return symbolRange.start.line <= otherRange.start.line &&
//     symbolRange.end.line >= otherRange.end.line;
// }

function findReferenceNodes(root: SyntaxNode, symbols: FishSymbol[]) {
  const map: Map<FishSymbol, SyntaxNode[]> = new Map();
  for (const symbol of symbols) {
    const searchableRanges = findSearchableRanges(symbol);
    // const references: SyntaxNode[] = rangesToNodes(searchableRanges, root)
    const references: SyntaxNode[] = findNodesInRanges(searchableRanges, root)
      .filter(n => {
        if (symbol.isArgparseFlag() && Locations.Range.equals(Locations.Range.fromNode(n), symbol.range)) return true;
        return n.text === symbol.name && ['word', 'variable_name'].includes(n.type);
      });
    map.set(symbol, references);
  }
  return map;
}

describe('symbol test suite', () => {
  setLogger();

  let parser: Parser;

  beforeEach(async () => {
    parser = await initializeParser();
  });

  it('test_1', () => {
    const tree = parser.parse(`
set --local x

function foo
    argparse 'h/help' 'n/name' -- $argv
    or return

    echo inside foo: $argv
    echo inside foo: $x
    read --delimiter '=' --function read_a read_b read_c read_d read_e
    function inside_foo -a inside_foo_a inside_foo_b inside_foo_c inside_foo_d \\
        --description 'this function is inside foo' \\
        --inherit-variable read_a
        echo inside inside_foo: $argv
        echo inside_foo_a: $inside_foo_a
        echo inside_foo_b: $inside_foo_b
        echo inside_foo_c: $inside_foo_c
        echo inside_foo_d: $inside_foo_d
    end

    inside_foo $foo_a $foo_b $foo_c $foo_d

    echo foo_a: $foo_a
    echo foo_b: $foo_b
    echo foo_c: $foo_c
    echo foo_d: $foo_d
end

function bar -a bar_a bar_b bar_c bar_d
    echo inside bar: $argv
    echo bar_a: $bar_a
    echo bar_b: $bar_b
    echo bar_c: $bar_c
    echo bar_d: $bar_d
    set --local bool_1 'neither 1'
    if true 
        set --local bool_1 'true 1'
    else
        set --local bool_1 'false 1'
    end
    echo bool_1: $bool_1
    function inside_bar_with_bool_1 --inherit-variable bool_1
        echo inside_bar_with_bool_1: $bool_1
    end
    inside_bar_with_bool_1

    function inside_bar_without_bool_1
        echo inside_bar_without_bool_1: $bool_1
    end
    inside_bar_without_bool_1
end

set --global --export global_y_var 'y'
echo a==b==c | read -d == -l a b c
echo d==e==f | read --delimiter '==' --function d e f
echo g==h==i | read --delimiter='==' --array g
echo 'j k l' | read --delimiter=' ' --array z

for i in (seq 1 10)
    echo $i
end

set i (math $i + 1);

foo
`);
    expect(tree.rootNode).not.toBeNull();
    const root = tree.rootNode;
    const uri = 'file:///home/user/.config/fish/config.fish';
    const symbols = buildScopedSymbol(tree.rootNode, uri);
    // for (const symbol of flattenNested(...symbols)) {
    //   console.log(symbol.kindString, '|', symbol.name);
    //   console.log('    ', Locations.Range.toString(symbol.selectionRange));
    //   console.log('    ', Locations.Range.toString(symbol.range));
    //   console.log('-'.repeat(40));
    //   console.log('    ', findSearchableRanges(symbol).map(Locations.Range.toString).join('\n     ').trimEnd());
    //   console.log();
    //   // if (symbol.isFunction()) {
    //   // }
    // }

    // logFishsymbols(symbols);

    // for (const symbol of flattenNested(...symbols)) {
    //   console.log(symbol.name);
    // }
    const foo = flattenNested(...symbols).find(s => s.name === 'foo');
    expect(foo).not.toBeNull();
    expect(foo?.functionInfo).not.toBeNull();
    // TODO: do something with foo since its refs count is 2
    //       `bar` is zero

    const inside_foo = flattenNested(...symbols).find(s => s.name === 'inside_foo');
    expect(inside_foo).not.toBeNull();
    expect(inside_foo?.functionInfo).not.toBeNull();
    expect(inside_foo?.functionInfo?.isAutoLoad).toBeFalsy();
    // console.log('printing functionInfo "inside_foo"');
    // if (inside_foo) {
    //   console.log(inside_foo.functionInfo);
    // }
    const bar = flattenNested(...symbols).find(s => s.name === 'bar');
    expect(bar).not.toBeNull();
    expect(bar?.functionInfo).not.toBeNull();
    expect(bar?.functionInfo?.isAutoLoad).toBeTruthy();
    // console.log('printing functionInfo "bar"');
    // if (bar) {
    //   console.log(bar.functionInfo);
    // }
    // const all_bools = flattenNested(...symbols).filter(s => s.name === 'bool_1');
    const resultMap = buildUniqueMapOfSymbols(flattenNested(...symbols));
    // resultMap.forEach((value, _) => {
    //   console.log(value[0].name, value.length);
    //   console.log(value.map(s => s.name).join(', '));
    //   console.log('    ', value.map(v => Locations.Range.toString(v.selectionRange)));
    //   for (const v of value) {
    //     console.log('    ', findSearchableRanges(v).map(Locations.Range.toString).join('\n     ').trimEnd());
    //   }
    // });
    //const uniqSymbols: FishSymbol[] = [];
    //resultMap.forEach((valueSymbols, _) => {
    //  const first = valueSymbols.at(0);
    //  let value = first;
    //  if (first.isArgparseFlag()) {
    //    value = valueSymbols.filter(s => s.isArgparseFlag()).sort((a, b) => b.name.length - a.name.length).at(0)!;
    //  }
    //  uniqSymbols.push(value);
    //});
    //findReferences(root, uniqSymbols);
    //resultMap.forEach((valueSymbols, _) => {
    //  for (const value of valueSymbols) {
    //    console.log(value.kindString, value.name);
    //    console.log('    ', Locations.Range.toString(value.selectionRange));
    //    console.log('    ', Locations.Range.toString(value.range));
    //    console.log('-'.repeat(40));
    //  }
    //});
    const bool = flattenNested(...symbols).find(s => s.name === 'bool_1')!;
    const bools: SyntaxNode[] = [];
    const bool_ranges = getCallableRanges(bool);
    for (const n of rangesToNodes(bool_ranges, root)) {
      if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
      if (n.text === 'bool_1') bools.push(n);
    }
    // expect(bools.length).toBe(4);

    const table: { name: string; kind: string; range: string; callable: string; }[] = [];
    flattenNested(...symbols)
      .forEach(s => {
        table.push({
          name: s.name,
          kind: s.kindString,
          range: Locations.Range.toString(s.range),
          callable: getCallableRanges(s).map(c => Locations.Range.toString(c)).join(),
        });
        console.log('='.repeat(40));
        const parentScope = s.getParentScope();
        console.log(s.name, Locations.Range.toString(s.selectionRange), Locations.Range.toString(s.range));
        console.log(parentScope.text.split('\n')[0]!, Locations.Range.fromNodeToString(parentScope));
        console.log('='.repeat(40));
      });
    console.table(table);
    //// for (const b of bools) {
    ////   console.log(b.text, b.type, Locations.Range.fromNodeToString(b));
    //// }
    //// console.log('bool_ranges', bool_ranges.length);
    const inside_foo_refs: SyntaxNode[] = [];
    const inside_foo_ranges = getCallableRanges(inside_foo);
    for (const n of rangesToNodes(inside_foo_ranges, root)) {
      if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
      // if (n.text === 'inside_foo') logNode(n);
      if (n.text === 'inside_foo') inside_foo_refs.push(n);
    }
    expect(inside_foo_refs.length).toBe(1);
    const refs = findReferenceNodes(root, flattenNested(...symbols));
    refs.forEach((v, k) => {
      if (k.name === 'bool_1') {
        console.log(k.parent?.kindString, k.parent?.name, rangeStr(k.parent.node!));
        console.log('==='.repeat(10));
        console.log(k.kindString, k.name, v.length, Locations.Range.toString(k.selectionRange));
        // console.log('    ', rangeStr(k.node));
        console.log('    ', v.map(rangeStr).join('\n     '));
        console.log('___');
        console.log('searchable');
        // const searchableRanges = findSearchableRanges(k);
        const searchableRanges = getCallableRanges(k);
        console.log('    ', searchableRanges.map(Locations.Range.toString).join('\n     ').trimEnd());
        console.log('__________________________________________\n\n');
      }
    });
    expect(true).toBeTruthy();
  });

  it('process for loop', () => {
    const tree = parser.parse(`
for i in (seq 1 10)
    echo $i
end`,
    );
    const root = tree.rootNode;
    const for_loop = root.descendantsOfType('for_statement').pop();
    if (!for_loop) fail();
    // console.log(for_loop.text, for_loop.type, for_loop.toString());
    expect(for_loop).not.toBeNull();
    expect(for_loop.firstNamedChild.text).toBe('i');
    expect(for_loop.firstNamedChild.type).toBe('variable_name');
    // console.log('fnc', for_loop?.firstNamedChild?.text, for_loop?.firstNamedChild?.type);
  });
});