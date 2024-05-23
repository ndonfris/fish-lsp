
import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, Position, Location, MarkupContent, FoldingRange, FoldingRangeKind, CallHierarchyOutgoingCall } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition, isVariableDefinitionName, refinedFindParentVariableDefinitionKeyword } from './utils/node-types';
//import { findVariableDefinitionOptions } from './utils/options';
import { DocumentSymbolDetail } from './utils/symbol-documentation-builder';
import { pathToRelativeFunctionName } from './utils/translation';
import { getNodeAtRange, getRange, isPositionAfter, isPositionWithinRange, pointToPosition, positionToPoint } from './utils/tree-sitter';
import { ScopeTag, DefinitionScope, getScope } from './utils/definition-scope';
import { GenericTree } from './utils/generic-tree';
import { FishCompletionItem } from './utils/completion/types';
import { enrichToCodeBlockMarkdown } from './documentation';

// add some form of tags to the symbol so that we can extend the symbol with more information
// current implementation is WIP inside file : ./utils/options.ts
export interface FishDocumentSymbol extends DocumentSymbol {
  name: string;
  uri: string;
  text: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  scope: DefinitionScope;
  children: FishDocumentSymbol[];
}

export namespace FishDocumentSymbol {
  /**
     * Creates a new symbol information literal.
     *
     * @param name The name of the symbol.
     * @param uri The documentUri of the symbol.
     * @param text The text in the symbol scope.
     * @param detail The detail of the symbol. (Markdown included inside 'range')
     * @param kind The kind of the symbol.
     * @param range The enclosing range of the symbol.
     * @param selectionRange The selectionRange of the symbol.
     * @param children Children of the symbol.
     */
  export function create(name: string, uri: string, text: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range, scope: DefinitionScope, children: FishDocumentSymbol[]): FishDocumentSymbol {
    return {
      name,
      uri,
      text,
      detail,
      kind,
      range,
      selectionRange,
      scope,
      children,
    } as FishDocumentSymbol;
  }

  export function copy(symbol: FishDocumentSymbol, newChildren: FishDocumentSymbol[] = []): FishDocumentSymbol {
    return create(
      symbol.name,
      symbol.uri,
      symbol.text,
      symbol.detail,
      symbol.kind,
      symbol.range,
      symbol.selectionRange,
      symbol.scope,
      newChildren,
    );
  }

  export function equal(a: FishDocumentSymbol, b: FishDocumentSymbol): boolean {
    return (
      a.name === b.name &&
            a.uri === b.uri &&
            a.range.start.character === b.range.start.character &&
            a.range.start.line === b.range.start.line &&
            a.range.end.character === b.range.end.character &&
            a.range.end.line === b.range.end.line &&
            a.selectionRange.start.character === b.selectionRange.start.character &&
            a.selectionRange.start.line === b.selectionRange.start.line &&
            a.selectionRange.end.line === b.selectionRange.end.line &&
            a.selectionRange.end.character === b.selectionRange.end.character
    );
  }

  export function toWorkspaceSymbol(symbol: FishDocumentSymbol): WorkspaceSymbol {
    return WorkspaceSymbol.create(
      symbol.name,
      symbol.kind,
      symbol.uri,
      symbol.range,
    );
  }

  export function toLocation(symbol: FishDocumentSymbol): Location {
    return Location.create(
      symbol.uri,
      symbol.selectionRange,
    );
  }

  export function logString(symbol: FishDocumentSymbol): string {
    const symbolIcon = symbol.kind === SymbolKind.Function ? '  ' : '  ';
    return `${symbolIcon}${symbol.name}   ::::  ${symbol.scope.scopeTag}`;
  }

  export function flattenArray(symbols: FishDocumentSymbol[]) : FishDocumentSymbol[] {
    function* flattenGenerator(symbols: FishDocumentSymbol[]): Generator<FishDocumentSymbol> {
      for (const symbol of symbols) {
        yield symbol;
        yield* flattenGenerator(symbol.children);
      }
    }
    return [...flattenGenerator(symbols)];
  }

  export function equalScopes(a: FishDocumentSymbol, b: FishDocumentSymbol): boolean {
    if (a.scope.scopeNode && b.scope.scopeNode) {
      if ([a.scope.scopeTag, b.scope.scopeTag].includes('inherit')) {
        return a.scope.scopeNode.equals(b.scope.scopeNode);
      } else if (
        ['global', 'universal'].includes(a.scope.scopeTag) &&
                ['global', 'universal'].includes(b.scope.scopeTag)
      ) {
        return true;
      }
      return a.scope.scopeTag === b.scope.scopeTag &&
                a.scope.scopeNode.equals(b.scope.scopeNode);
    }
    return false;
  }

  /*
     * the first symbol is before the second symbol
     */
  export function isBefore(first: FishDocumentSymbol, second: FishDocumentSymbol): boolean {
    return first.range.start.line < second.range.start.line;
  }

  /*
     * the first symbol is after the second symbol
     */
  export function isAfter(first: FishDocumentSymbol, second: FishDocumentSymbol): boolean {
    return first.range.start.line > second.range.start.line;
  }

  export function getSyntaxNode(root: SyntaxNode, symbol: FishDocumentSymbol): SyntaxNode | null {
    return getNodeAtRange(root, symbol.range);
  }

  export function toTree(symbols: FishDocumentSymbol[]) {
    return new GenericTree<FishDocumentSymbol>(symbols);
  }

  export function debug(symbol: FishDocumentSymbol) {
    const positionString = (pos: Position) => `(line: ${pos.line}, char: ${pos.character})`;
    const rangeString = (n: SyntaxNode) => {
      const range = getRange(n);
      return `${positionString(range.start)} --- ${positionString(range.end)}`;
    };

    const scopeNodeLines = symbol.scope.scopeNode.text.split('\n');
    return {
      name: symbol.name,
      range: positionString(symbol.range.start) + ' --- ' + positionString(symbol.range.end),
      selectionRange: positionString(symbol.selectionRange.start) + ' --- ' + positionString(symbol.selectionRange.end),
      text: symbol.text.split('\n').length > 1
        ? symbol.text + '...'
        : symbol.text,
      scope: {
        scopeTag: symbol.scope.scopeTag,
        scopeNode: {
          text: scopeNodeLines[0] + '...',
          type: symbol.scope.scopeNode.type,
          range: rangeString(symbol.scope.scopeNode),
        },
      },
      type: symbol.kind === SymbolKind.Function ? 'function' : 'variable',
      uri: symbol.uri,
    };
  }

  export function toFoldingRange(symbol: FishDocumentSymbol): FoldingRange {
    return {
      startLine: symbol.range.start.line,
      endLine: symbol.range.end.line,
      collapsedText: symbol.name,
    };
    //return FoldingRange.create(
    //    symbol.range.start.line,
    //    symbol.range.end.line,
    //    symbol.range.start.character,
    //    symbol.range.end.character,
    //    FoldingRangeKind.Region,
    //    symbol.name
    //)
  }

  //export function toGlobalCompletion(symbol: FishDocumentSymbol, data: FishCompletionData): FishCompletionItem {
  //    const kind = symbol.kind === SymbolKind.Function ? FishCompletionItemKind.GLOBAL_FUNCTION : FishCompletionItemKind.GLOBAL_VARIABLE;
  //    const detail: MarkupContent = {kind: 'markdown', value: symbol.detail}
  //    return createCompletionItem(symbol.name, kind, detail, data)
  //}
  //
  //export function toLocalCompletion(symbol: FishDocumentSymbol, data: FishCompletionData): FishCompletionItem {
  //    const kind = symbol.kind === SymbolKind.Function
  //        ? isGlobalSymbol(symbol) ? FishCompletionItemKind.USER_FUNCTION : FishCompletionItemKind.LOCAL_FUNCTION
  //        : isGlobalSymbol(symbol) ? FishCompletionItemKind.GLOBAL_VARIABLE : FishCompletionItemKind.LOCAL_VARIABLE;
  //    const detail: MarkupContent = {kind: 'markdown', value: symbol.detail}
  //    return createCompletionItem(symbol.name, kind, detail, data)
  //}

  export type MockSymbol = {
    name: string;
    scope: ScopeTag;
    range: Range;
  };

  export function toMock(symbol: FishDocumentSymbol): MockSymbol {
    const { name, scope, range } = symbol;
    return {
      name,
      scope: scope.scopeTag,
      range,
    };
  }

  export function createMock(name: string, scope: ScopeTag, range: Range): MockSymbol {
    return {
      name,
      scope,
      range,
    };
  }
}

/**
 * Checks if a FishDocumentSymbol's state, should NOT be changeable.
 * Renaming a FishDocumentSymbol across the entire workspace, shouldn't
 * be possible for internal symbols (seen in '/usr/share/fish/**.fish').
 */
export function symbolIsImmutable(symbol: FishDocumentSymbol): boolean {
  const { uri, scope } = symbol;
  return uri.startsWith('/usr/share/fish/') || scope.scopeTag === 'universal';
}

export function isGlobalSymbol(symbol: FishDocumentSymbol): boolean {
  return symbol.scope.scopeTag === 'global';
}

export function isUniversalSymbol(symbol: FishDocumentSymbol): boolean {
  return symbol.scope.scopeTag === 'universal';
}

export function filterGlobalSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
  return FishDocumentSymbol
    .toTree(symbols)
    .toFlatArray()
    .filter((symbol) => symbol.scope.scopeTag === 'global');
}

export function filterLocalSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
  return FishDocumentSymbol
    .toTree(symbols)
    .toFlatArray()
    .filter((symbol) => symbol.scope.scopeTag !== 'global' && symbol.scope.scopeTag !== 'universal');
}

export function filterLastPerScopeSymbol(symbolArray: FishDocumentSymbol[]) {
  const symbolTree: GenericTree<FishDocumentSymbol> = new GenericTree(symbolArray);
  const flatArray: FishDocumentSymbol[] = symbolTree.toFlatArray();
  return symbolTree
    .filterToTree((symbol: FishDocumentSymbol) => !flatArray.some((s) => {
      return (
        s.name === symbol.name &&
                !FishDocumentSymbol.equal(symbol, s) &&
                FishDocumentSymbol.equalScopes(symbol, s) &&
                FishDocumentSymbol.isBefore(symbol, s)
      );
    }))
    .toArray();
}

const compareSymbolToPosition = (symbol: FishDocumentSymbol, position: Position) => {
  const compareHelper = (symbol: FishDocumentSymbol, position: Position) => {
    const { scope } = symbol;
    if (['global', 'universal'].includes(scope.scopeTag)) {
      return true;
    }
    return scope.containsPosition(position);
  };

  return symbol.kind === SymbolKind.Function
    ? compareHelper(symbol, position)
    : symbol.scope.containsPosition(position)
           && isPositionAfter(symbol.selectionRange.end, position);
};

export function findSymbolsForCompletion(symbols: FishDocumentSymbol[], position: Position): FishDocumentSymbol[] {
  const symbolTree = new GenericTree<FishDocumentSymbol>(symbols);
  const possibleDuplicates = symbolTree
    .filterToTree((symbol: FishDocumentSymbol) => compareSymbolToPosition(symbol, position))
    .toFlatArray()
    .reverse();
  const uniqueSymbolsArray: FishDocumentSymbol[] = [];
  for (const symbol of possibleDuplicates) {
    if (uniqueSymbolsArray.some((s) => s.name === symbol.name)) {
      continue;
    }
    uniqueSymbolsArray.push(symbol);
  }
  return uniqueSymbolsArray;
}

/**
 * finds all symbols (variables and function that have been defined)
 */
export function findSymbolReferences(symbols: FishDocumentSymbol[], matchSymbol: FishDocumentSymbol): FishDocumentSymbol[] {
  return new GenericTree<FishDocumentSymbol>(symbols)
    .filterToTree((symbol: FishDocumentSymbol) => {
      //if (symbol.scope.scopeTag === 'global' ) return true;
      return matchSymbol.name === symbol.name
                && FishDocumentSymbol.equalScopes(matchSymbol, symbol);
    })
    .toFlatArray();
}

export function findLastDefinition(symbols: FishDocumentSymbol[], matchNode: SyntaxNode) {
  const symbolTree = new GenericTree<FishDocumentSymbol>(symbols);
  const symbolFunctionCompare = (symbol: FishDocumentSymbol, matchNode: SyntaxNode) => {
    const matchPosition = pointToPosition(matchNode.startPosition);
    const { name, kind, scope } = symbol;
    return name === matchNode.text
                && compareSymbolToPosition(symbol, matchPosition);
  };
  return symbolTree
    .filterToTree((symbol: FishDocumentSymbol) => symbolFunctionCompare(symbol, matchNode))
    .toFlatArray()
    .pop();
}

/**
 * TreeSitter definition nodes in fish shell rely on commands, and thus create trees that
 * need specific traversals per command. Creates a standard object of properties to be
 * deconstructed into a FishDocumentSymbol. Where parent is the root most node of the
 * entire command to create a symbol. Child is the identifier of the symbol.
 *
 * See fish below:
 * ---------------------------------------------------------------------------------------
 * set -gx FOO BAR; # FOO is a variable we globally define and export
 * ---------------------------------------------------------------------------------------
 * Child is just the identifier `$FOO`
 * Parent is the entire string `set -gx FOO BAR;` for the command
 */
export function definitionSymbolHandler(node: SyntaxNode): {
  shouldCreate: boolean;
  kind: SymbolKind;
  child: SyntaxNode;
  parent: SyntaxNode;
} {
  let shouldCreate = false;
  let [child, parent] = [node, node.parent || node];
  let kind: SymbolKind = SymbolKind.Null;
  if (isVariableDefinitionName(node)) {
    parent = refinedFindParentVariableDefinitionKeyword(node)!.parent!;
    kind = SymbolKind.Variable;
    shouldCreate = true;
    if (node.text.startsWith('$')) {
      shouldCreate = false;
    }
  } else if (node.firstNamedChild && isFunctionDefinitionName(node.firstNamedChild)) {
    parent = node;
    child = node.firstNamedChild!;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return {
    shouldCreate,
    kind,
    child,
    parent,
  };
}

/**
 * Creates all FishDocumentSymbols in a file
 * @param {string} uri - path to the file
 * @param {SyntaxNode[]} currentNodes - root node(s) to traverse for definitions
 * @returns {FishDocumentSymbol[]} - all defined FishDocumentSymbol's in file
 */
export function getFishDocumentSymbols(uri: string, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
  const symbols: FishDocumentSymbol[] = [];
  for (const node of currentNodes) {
    const childrenSymbols = getFishDocumentSymbols(uri, ...node.children);
    const { shouldCreate, kind, child, parent } = definitionSymbolHandler(node);
    if (shouldCreate) {
      symbols.push(
        FishDocumentSymbol.create(
          child.text,
          uri,
          parent.text,
          DocumentSymbolDetail.create(child.text, uri, kind, child),
          kind,
          getRange(parent),
          getRange(child),
          getScope(uri, child),
          childrenSymbols,
        ),
      );
      continue;
    }
    symbols.push(...childrenSymbols);
  }
  return symbols;
}
