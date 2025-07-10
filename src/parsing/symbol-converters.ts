import { DocumentSymbol, WorkspaceSymbol, Location, FoldingRange, FoldingRangeKind, MarkupContent, MarkupKind, Hover, DocumentUri } from 'vscode-languageserver';
import { FishSymbol } from './symbol';

// === INTERNAL HELPER FUNCTIONS (not exported) ===
export namespace SymbolConverters {
  // Internal helper to check if symbol should be included as document symbol
  const shouldIncludeAsDocumentSymbol = (symbol: FishSymbol): boolean => {
    switch (true) {
      case symbol.fishKind === 'FUNCTION_EVENT':
        return false; // Emitted events are not included as document symbols
      default:
        return true;
    }
  };

  // Internal helper to process children for document symbols
  const processDocumentSymbolChildren = (symbol: FishSymbol): DocumentSymbol[] => {
    const visitedChildren: DocumentSymbol[] = [];

    for (const child of symbol.children) {
      if (!shouldIncludeAsDocumentSymbol(child)) continue;

      const newChild = symbolToDocumentSymbol(child);
      if (newChild) {
        visitedChildren.push(newChild);
      }
    }

    return visitedChildren;
  };

  // Internal helper to create markup content
  const createMarkupContent = (symbol: FishSymbol): MarkupContent => {
    return {
      kind: MarkupKind.Markdown,
      value: symbol.detail,
    };
  };

  // === PUBLIC API FUNCTIONS (exported) ===

  // Convert symbol to WorkspaceSymbol
  export const symbolToWorkspaceSymbol = (symbol: FishSymbol): WorkspaceSymbol => {
    return WorkspaceSymbol.create(
      symbol.name,
      symbol.kind,
      symbol.uri,
      symbol.selectionRange,
    );
  };

  // Convert symbol to DocumentSymbol
  export const symbolToDocumentSymbol = (symbol: FishSymbol): DocumentSymbol | undefined => {
    if (!shouldIncludeAsDocumentSymbol(symbol)) {
      return undefined;
    }

    const children = processDocumentSymbolChildren(symbol);

    return DocumentSymbol.create(
      symbol.name,
      symbol.detail,
      symbol.kind,
      symbol.range,
      symbol.selectionRange,
      children,
    );
  };

  // Convert symbol to Location
  export const symbolToLocation = (symbol: FishSymbol): Location => {
    return Location.create(
      symbol.uri,
      symbol.selectionRange,
    );
  };

  // Convert symbol to Position
  export const symbolToPosition = (symbol: FishSymbol): { line: number; character: number; } => {
    return {
      line: symbol.selectionRange.start.line,
      character: symbol.selectionRange.start.character,
    };
  };

  // Convert symbol to FoldingRange
  export const symbolToFoldingRange = (symbol: FishSymbol): FoldingRange => {
    return {
      startLine: symbol.range.start.line,
      endLine: symbol.range.end.line,
      startCharacter: symbol.range.start.character,
      endCharacter: symbol.range.end.character,
      collapsedText: symbol.name,
      kind: FoldingRangeKind.Region,
    };
  };

  // Convert symbol to MarkupContent
  export const symbolToMarkupContent = (symbol: FishSymbol): MarkupContent => {
    return createMarkupContent(symbol);
  };

  // Convert symbol to Hover (with optional current URI for range inclusion)
  export const symbolToHover = (symbol: FishSymbol, currentUri: DocumentUri = ''): Hover => {
    return {
      contents: createMarkupContent(symbol),
      range: currentUri === symbol.uri ? symbol.selectionRange : undefined,
    };
  };

  export const copySymbol = (symbol: FishSymbol): FishSymbol => {
    return new FishSymbol({
      name: symbol.name,
      detail: symbol.detail,
      document: symbol.document,
      uri: symbol.uri,
      fishKind: symbol.fishKind,
      node: symbol.node,
      focusedNode: symbol.focusedNode,
      scope: symbol.scope,
      range: symbol.range,
      selectionRange: symbol.selectionRange,
      children: symbol.children.map(copySymbol), // NOT Recursive but probably should be
    });
  };

  export const symbolToString = (symbol: FishSymbol): string => {
    return JSON.stringify({
      name: symbol.name,
      kind: symbol.kind,
      uri: symbol.uri,
      scope: symbol.scope.scopeTag,
      detail: symbol.detail,
      range: symbol.range,
      selectionRange: symbol.selectionRange,
      aliasedNames: symbol.aliasedNames,
      children: symbol.children.map(child => child.name),
    }, null, 2);
  };

}

