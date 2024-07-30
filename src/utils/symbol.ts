
import { SyntaxNode } from 'web-tree-sitter';
import {
  SymbolKind,
  Range,
  DocumentSymbol,
  WorkspaceSymbol,
  Location,
} from 'vscode-languageserver';
import * as NodeTypes from './node-types';
import { getRange, getNodeText } from './tree-sitter';
import { toSymbolKind } from './translation';

export type SymbolItemType = 'Definition' | 'Scope' | 'Unknown';

export interface SymbolItem {
  name: string;
  type: SymbolItemType;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: SymbolItem[];
  location?: Location;
}

export function getSymbolType(node: SyntaxNode): SymbolItemType {
  if (NodeTypes.isFunctionDefinitionName(node) || NodeTypes.isVariableDefinitionName(node)) {
    return 'Definition';
  }
  if (NodeTypes.isScope(node) || NodeTypes.IsCommandSubstitution(node)) {
    return 'Scope';
  }
  return 'Unknown';
}

export function findAllSymbolItems(
  node: SyntaxNode,
  uri: string,
): SymbolItem[] {
  const symbols: SymbolItem[] = [];

  function traverse(currentNode: SyntaxNode, parent: SymbolItem | null = null): SymbolItem[] {
    const symbolType = getSymbolType(currentNode);
    const filters = symbolType.includes(symbolType);
    const range = getRange(currentNode);

    const symbol: SymbolItem = {
      name: getNodeText(currentNode),
      type: symbolType,
      kind: toSymbolKind(currentNode),
      range: range,
      selectionRange: range || null,
      children: [],
      location: {
        uri: uri,
        range: range,
      },
    };

    const childSymbols: SymbolItem[] = [];

    for (const child of currentNode.children) {
      childSymbols.push(...traverse(child, filters ? symbol : parent));
    }

    if (filters) {
      symbol.children = childSymbols;
      if (parent) {
        parent.children?.push(symbol);
      } else {
        symbols.push(symbol);
      }
      return [symbol];
    } else {
      return childSymbols;
    }
  }

  traverse(node);
  return symbols;
}

export function symbolItemToDocumentSymbol(item: SymbolItem): DocumentSymbol {
  return {
    name: item.name,
    kind: item.kind,
    range: item.range,
    selectionRange: item.selectionRange,
    children: item.children?.map(symbolItemToDocumentSymbol),
  };
}

export function symbolItemToWorkspaceSymbol(item: SymbolItem): WorkspaceSymbol {
  return {
    name: item.name,
    kind: item.kind,
    location: item.location!,
  };
}

export function findDocumentSymbols(node: SyntaxNode, uri: string): DocumentSymbol[] {
  const symbolItems = findAllSymbolItems(node, uri);
  return symbolItems.map(symbolItemToDocumentSymbol);
}

export function findWorkspaceSymbols(node: SyntaxNode, uri: string): WorkspaceSymbol[] {
  const symbolItems = findAllSymbolItems(node, uri);
  return symbolItems.flatMap(item => flattenSymbolItemToWorkspaceSymbols(item, uri));
}

function flattenSymbolItemToWorkspaceSymbols(item: SymbolItem, uri: string): WorkspaceSymbol[] {
  const result: WorkspaceSymbol[] = [symbolItemToWorkspaceSymbol(item)];
  if (item.children) {
    for (const child of item.children) {
      result.push(...flattenSymbolItemToWorkspaceSymbols(child, uri));
    }
  }
  return result;
}
