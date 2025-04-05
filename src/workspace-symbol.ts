import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { Position, Location, Range, SymbolKind, TextEdit, DocumentUri, WorkspaceEdit, RenameFile } from 'vscode-languageserver';
import { getChildNodes, getRange } from './utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { isCommandName, isCommandWithName } from './utils/node-types';
import { FishSymbol, findLocalLocations, findMatchingLocations } from './parsing/symbol';
import { containsRange, precedesRange } from './utils/tree-sitter';
import { getGlobalArgparseLocations } from './parsing/argparse';

export function canRenamePosition(analyzer: Analyzer, document: LspDocument, position: Position): boolean {
  return !!analyzer.findDocumentSymbol(document, position);
}

export type RenameSymbolType = 'local' | 'global';

export function getRenameSymbolType(analyzer: Analyzer, document: LspDocument, position: Position): RenameSymbolType {
  const symbol = analyzer.findDocumentSymbol(document, position);
  if (!symbol) {
    return 'local';
  }

  if (symbol.scope.scopeTag === 'global' || symbol.scope.scopeTag === 'universal') {
    return 'global';
  }
  return 'local';
}

export type RenameChanges = {
  [uri: DocumentUri]: TextEdit[];
};

function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
  const equalRanges = (a: Range, b: Range) => {
    return (
      a.start.line === b.start.line &&
      a.start.character === b.start.character &&
      a.end.line === b.end.line &&
      a.end.character === b.end.character
    );
  };
  let flagName = '';
  if (matchName.startsWith('_flag_')) {
    flagName = matchName.slice(6);
  }
  const matchingNames = nodes.filter(node => {
    if (matchName.startsWith('_flag_')) {
      return node.parent && isCommandWithName(node.parent, 'argparse') && node.text.split('/').find(t => t === flagName.slice(6));
    }
    return node.text === matchName;
  });
  const uniqueRanges: Range[] = [];
  matchingNames.forEach(node => {
    const range = getRange(node);
    if (uniqueRanges.some(u => equalRanges(u, range))) {
      return;
    }
    uniqueRanges.push(range);
  });
  return uniqueRanges.map(range => Location.create(uri, range));
}

function findGlobalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
  const locations: Location[] = [];
  const symbol = analyzer.findDocumentSymbol(document, position);
  if (!symbol) return [];
  const uris = analyzer.cache.uris();
  for (const uri of uris) {
    const doc = analyzer.getDocument(uri)!;
    if (!doc.isAutoloadedUri()) {
      continue;
    }
    const rootNode = analyzer.getRootNode(doc)!;
    const newSymbols = analyzer.getFlatDocumentSymbols(doc.uri);
    if (document.uri === doc.uri) {
      const newLocations = findLocalLocations(symbol, newSymbols);
      locations.push(...newLocations);
      continue;
    }
    const newLocations = findMatchingLocations(symbol, newSymbols, doc, rootNode);
    locations.push(...newLocations);
  }
  // handle alias
  // const hasDefinition = locations.some(l => l.uri === symbol.uri && equalRanges(symbol.selectionRange, l.range));
  // if (symbol.fishKind === 'ALIAS' && !hasDefinition) {
  //   locations.push(Location.create(symbol.uri, symbol.selectionRange));
  // }
  return locations;
}

export function getRenameLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
  if (!canRenamePosition(analyzer, document, position)) {
    return [];
  }
  const renameScope = getRenameSymbolType(analyzer, document, position);
  // TODO _flag_ support
  if (renameScope === 'local') {
    // const localLocations = findLocalLocations(analyzer, document, position);
    // const symbols = getSymbols(analyzer, document, position);
    // const symbolInRange = symbols.find(s => FishDocumentSymbol.));

    const allSymbols = analyzer.getFlatDocumentSymbols(document.uri);
    const findSymbol = analyzer.findDocumentSymbol(document, position);
    if (!findSymbol) {
      return [];
    }
    return findLocalLocations(findSymbol, allSymbols);
  } else if (renameScope === 'global') {
    return findGlobalLocations(analyzer, document, position);
  } else {
    return [];
  }
}

export function getReferenceLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return [];
  const symbol = analyzer.getDefinition(document, position);

  // create the locations array, and add location links for the `_flag_*` nodes from argparse commands
  const result: Location[] = [];
  if (symbol && symbol.fishKind === 'ARGPARSE') {
    result.push(...getGlobalArgparseLocations(analyzer, document, symbol));
  }
  if (symbol) {
    const doc = analyzer.getDocument(symbol.uri)!;
    const { scopeTag } = symbol.scope;
    switch (scopeTag) {
      case 'global':
      case 'universal':
        result.push(...findGlobalLocations(analyzer, doc, symbol.selectionRange.start));
        break;
      case 'local':
      default:
        result.push(...findLocalLocations(symbol, analyzer.getFlatDocumentSymbols(doc.uri)));
        break;
    }
  }
  if (isCommandName(node)) {
    const uris = analyzer.cache.uris();
    const locations: Location[] = [];
    for (const uri of uris) {
      const doc = analyzer.getDocument(uri)!;
      const rootNode = analyzer.getRootNode(doc)!;
      const nodes = getChildNodes(rootNode).filter(n => isCommandName(n));
      const newLocations = findLocations(uri, nodes, node.text);
      locations.push(...newLocations);
    }
    return locations;
  }
  return result;
}

export function getRenameFiles(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): RenameFile[] | null {
  const renameFiles: RenameFile[] = [];
  const symbol = analyzer.findDocumentSymbol(document, position);
  if (!symbol) {
    return null;
  }
  if (symbol.kind !== SymbolKind.Function) {
    return null;
  }
  if (symbol.isSymbolImmutable()) {
    return null;
  }
  if (symbol.scope.scopeTag === 'global') {
    analyzer.getExistingAutoloadedFiles(symbol).forEach(uri => {
      const newUri = uri.replace(symbol.name, newName);
      renameFiles.push(RenameFile.create(uri, newUri));
    });
  }
  return renameFiles;
}

export function getRenameWorkspaceEdit(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): WorkspaceEdit | null {
  // const locations = getRenameLocations(analyzer, document, position);
  const locations = getReferenceLocations(analyzer, document, position);
  if (!locations || locations.length === 0) {
    return null;
  }
  const changes: {[uri: string]: TextEdit[];} = {};
  const symbol = analyzer.getDefinition(document, position);
  if (symbol?.fishKind === 'ALIAS') {
    const edits = changes[symbol.uri] || [];
    edits.push(TextEdit.replace(symbol.selectionRange, newName));
  }
  // convert locations to changes TextDocumentEdit
  for (const location of locations) {
    const uri = location.uri;
    const edits = changes[uri] || [];
    edits.push(TextEdit.replace(location.range, newName));
    changes[uri] = edits;
  }

  // add rename files
  // const documentChanges: RenameFile[] | null = getRenameFiles(analyzer, document, position, newName);
  // if (documentChanges && documentChanges.length > 0) {
  //   // const docChanges = changes[document.uri] || [];
  //   // const identifier = OptionalVersionedTextDocumentIdentifier.create(document.uri, document.version);
  //   // return { documentChanges: [
  //   //   TextDocumentEdit.create(identifier, docChanges),
  //   //   ...documentChanges
  //   // ]}
  //   return { changes, documentChanges };
  // }

  return { changes };
}

export function findDefinitionSymbols(analyzer: Analyzer, document: LspDocument, position: Position): FishSymbol[] {
  const symbols: FishSymbol[] = [];
  const localSymbols = analyzer.getFlatDocumentSymbols(document.uri);
  const toFind = analyzer.wordAtPoint(document.uri, position.line, position.character);
  const nodeToFind = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!toFind || !nodeToFind) return [];

  const localSymbol = localSymbols.find((s) => {
    return s.name === toFind && containsRange(s.selectionRange, getRange(analyzer.nodeAtPoint(document.uri, position.line, position.character)!));
  });
  if (localSymbol) {
    symbols.push(localSymbol);
  } else {
    const toAdd: FishSymbol[] = localSymbols.filter((s) => {
      const variableBefore = s.kind === SymbolKind.Variable ? precedesRange(s.selectionRange, getRange(nodeToFind)) : true;
      return (
        s.name === toFind
        && containsRange(
          getRange(s.scope.scopeNode),
          getRange(nodeToFind),
        )
        && variableBefore
      );
    });
    symbols.push(...toAdd);
  }
  if (!symbols.length) {
    symbols.push(...analyzer.globalSymbols.find(toFind));
  }
  return symbols;
}
