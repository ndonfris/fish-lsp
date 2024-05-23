import { SymbolKind, Range, Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { isCommandName } from './utils/node-types';
import { getChildNodes, getRange } from './utils/tree-sitter';
import { containsRange } from './workspace-symbol';

interface FishCallHierarchyItem {
  name: string;
  kind: SymbolKind;
  detail: string;
  uri: string;
  range: Range;
  selectionRange: Range;
}

export namespace FishCallHierarchyItem {
  export function create(name: string, kind: SymbolKind, detail: string, uri: string, range: Range, selectionRange: Range) {
    return {
      name,
      kind,
      detail,
      uri,
      range,
      selectionRange,
    };
  }
}

export function getCallers(analyzer: Analyzer, document: LspDocument, position: Position): FishCallHierarchyItem[] {
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) {
    return [];
  }
  const allCallers: FishCallHierarchyItem[] = [];

  const allUris = analyzer.cache.uris();
  for (const uri of allUris) {
    const document = analyzer.getDocument(uri);
    const rootNode = analyzer.cache.getRootNode(uri);
    if (!document || !rootNode) {
      continue;
    }
    const callers = getCallerForDocument(document, rootNode, node.text);
    allCallers.push(...callers);
  }
  return allCallers;
}

export function getCallerForDocument(document: LspDocument, rootNode: SyntaxNode, callName: string): FishCallHierarchyItem[] {
  const nodes = getChildNodes(rootNode);
  const callers: FishCallHierarchyItem[] = [];
  for (const node of nodes) {
    if (isCommandName(node) && node.text === callName) {
      const parent = node.parent!;
      const name = node.text;
      const kind = SymbolKind.Function;
      const detail = node.parent!.text;
      const uri = document.uri;
      const range = getRange(parent);
      const selectionRange = getRange(node);
      callers.push(FishCallHierarchyItem.create(name, kind, detail, uri, range, selectionRange));
    }
  }
  return callers;
}

export function getCallees(analyzer: Analyzer, document: LspDocument, position: Position): FishCallHierarchyItem[] {
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) {
    return [];
  }

  const symbol = analyzer.findDocumentSymbol(document, position);
  if (!symbol) {
    return [];
  }
  const doc = analyzer.getDocument(symbol.uri)!;
  const rootNode = analyzer.cache.getRootNode(symbol.uri)!;
  const callees: FishCallHierarchyItem[] = [];

  for (const node of getChildNodes(rootNode)) {
    if (!containsRange(symbol.range, getRange(node))) {
      continue;
    }
    if (isCommandName(node)) {
      const parent = node.parent!;
      const name = node.text;
      const kind = SymbolKind.Function;
      const detail = node.parent!.text;
      const uri = symbol.uri;
      const range = getRange(parent);
      const selectionRange = getRange(node);
      callees.push(
        FishCallHierarchyItem.create(
          name,
          kind,
          detail,
          uri,
          range,
          selectionRange,
        ),
      );
    }
  }
  return callees;
}
