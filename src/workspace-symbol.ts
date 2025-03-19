import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { Position, Location, Range, SymbolKind, TextEdit, DocumentUri, WorkspaceEdit, RenameFile } from 'vscode-languageserver';
import { equalRanges, getChildNodes, getRange } from './utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { isCommandName, isCommandWithName } from './utils/node-types';
import { logger } from './logger';
import { FishSymbol, getLocalSymbols } from './parsing/symbol';

/**
 * Check if a range contains otherRange.
 */
export function containsRange(range: Range, otherRange: Range): boolean {
  if (otherRange.start.line < range.start.line || otherRange.end.line < range.start.line) {
    return false;
  }
  if (otherRange.start.line > range.end.line || otherRange.end.line > range.end.line) {
    return false;
  }
  if (otherRange.start.line === range.start.line && otherRange.start.character < range.start.character) {
    return false;
  }
  if (otherRange.end.line === range.end.line && otherRange.end.character > range.end.character) {
    return false;
  }
  return true;
}

export function precedesRange(before: Range, after: Range): boolean {
  if (before.start.line < after.start.line) {
    return true;
  }
  if (before.start.line === after.start.line && before.start.character < after.start.character) {
    return true;
  }
  return false;
}

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

function findLocalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
  const symbol = findDefinitionSymbols(analyzer, document, position).pop();
  if (!symbol) {
    return [];
  }
  logger.log({
    symbol: symbol.name,
    kind: symbol.kind,
    symbols: analyzer.getFlatDocumentSymbols(document.uri).filter(s => equalRanges(symbol.selectionRange, s.selectionRange)).map(r => r.name),
    isArgparse: symbol.fishKind === 'ARGPARSE',
    isArgparseFlag: symbol.name.startsWith('_flag_') && symbol.kind === SymbolKind.Variable,
  });
  if (symbol.fishKind === 'ARGPARSE' || symbol.name.startsWith('_flag_') && symbol.kind === SymbolKind.Variable) {
    const nodesToSearch = getChildNodes(symbol.scope.scopeNode).filter(node => {
      if (symbol.name === node.text) {
        return true;
      }
      // if (isCommandWithName(node, 'argparse') && node.text.split('/').find(t => t === symbol.name.slice(6))) {
      //   return true;
      // }
      return false;
    });
    const locations: Location[] = [];
    logger.log({
      nodesToSearch: nodesToSearch.map(n => n.text),
      nodes: getChildNodes(symbol.scope.scopeNode).map(n => n.text),
      selectionRange: symbol.selectionRange,
    });
    locations.push(Location.create(symbol.uri, symbol.selectionRange));
    locations.push(...nodesToSearch.map(node => {
      const newRange = getRange(node);
      const perfectedRange = {
        start: { line: newRange.start.line, character: newRange.start.character + '_flag_'.length },
        end: { line: newRange.end.line, character: newRange.end.character },
      };
      return Location.create(document.uri, perfectedRange);
    }));
    return locations;
  }
  /** TODO _flag support */
  const nodesToSearch = getChildNodes(symbol.scope.scopeNode);
  // .filter(node => {
  //   if (symbol.kind === SymbolKind.Function) {
  //     if (FishDocumentSymbol.isAlias(symbol) && !precedesRange(symbol.selectionRange, getRange(node))) {
  //       return false;
  //     }
  //     return isCommandName(node) || isFunctionDefinitionName(node) || isAliasName(node);
  //   }
  //   if (symbol.kind === SymbolKind.Variable) {
  //     return isVariable(node) || isVariableDefinitionName(node) || isCompleteFlagCommandName(node);
  //   }
  //   return false;
  // }).filter(node => {
  //   if (FishDocumentSymbol.isAlias(symbol)) {
  //     return precedesRange(symbol.selectionRange, getRange(node));
  //   }
  //   return true;
  // });
  const result = findLocations(document.uri, nodesToSearch, symbol.name);
  const hasDefinition = result.some(l => l.uri === symbol.uri && equalRanges(symbol.selectionRange, l.range));
  if (symbol.fishKind === 'ALIAS' && !hasDefinition) {
    result.push(Location.create(symbol.uri, symbol.selectionRange));
  }
  return result;
}

function removeLocalSymbols(matchSymbol: FishSymbol, nodes: SyntaxNode[], symbols: FishSymbol[]) {
  const name = matchSymbol.name;
  const matchingSymbols = getLocalSymbols(symbols.filter(symbol => symbol.name === name)).map(symbol => symbol.scope.scopeNode);
  const matchingNodes = nodes.filter(node => node.text === name);

  if (matchingSymbols.length === 0 || matchSymbol.kind === SymbolKind.Function) {
    return matchingNodes;
  }

  return matchingNodes.filter((node) => {
    if (matchingSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) {
      return false;
    }
    return true;
  });
}
function findGlobalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
  const locations: Location[] = [];
  const symbol = analyzer.findDocumentSymbol(document, position);
  if (!symbol) {
    return [];
  }
  const uris = analyzer.cache.uris();
  for (const uri of uris) {
    const doc = analyzer.getDocument(uri)!;
    if (!doc.isAutoloadedUri()) {
      continue;
    }
    const rootNode = analyzer.getRootNode(doc)!;
    const searchNodes = getChildNodes(rootNode);
    //   .filter(node => {
    //   if (symbol.kind === SymbolKind.Function) {
    //     return isCommandName(node) || isFunctionDefinitionName(node) || isAliasName(node);
    //   }
    //   if (symbol.kind === SymbolKind.Variable) {
    //     return isVariable(node) || isVariableDefinitionName(node);
    //   }
    //   return false;
    // });
    const toSearchNodes = removeLocalSymbols(symbol, searchNodes, analyzer.cache.getFlatDocumentSymbols(uri));
    const newLocations = findLocations(uri, toSearchNodes, symbol.name);
    locations.push(...newLocations);
  }
  // handle alias
  const hasDefinition = locations.some(l => l.uri === symbol.uri && equalRanges(symbol.selectionRange, l.range));
  if (symbol.fishKind === 'ALIAS' && !hasDefinition) {
    locations.push(Location.create(symbol.uri, symbol.selectionRange));
  }
  return locations;
}

// function _getSymbols(analyzer: Analyzer, document: LspDocument, position: Position): FishSymbol[] {
//   const symbol = findDefinitionSymbols(analyzer, document, position).pop();
//   if (!symbol) {
//     return [];
//   }
//   return analyzer.getFlatDocumentSymbols(document.uri).filter(s => equalRanges(symbol.selectionRange, s.selectionRange));
// }

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

    return findLocalLocations(analyzer, document, position);
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
  // TODO _flag_ support
  if (symbol) {
    const doc = analyzer.getDocument(symbol.uri)!;
    const { scopeTag } = symbol.scope;
    switch (scopeTag) {
      case 'global':
      case 'universal':
        return findGlobalLocations(analyzer, doc, symbol.selectionRange.start);
      case 'local':
      default:
        return findLocalLocations(analyzer, document, symbol.selectionRange.start);
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
  return [];
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
// export function getRenameWorkspaceEdit(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): WorkspaceEdit | null {
//   const locations = getRenameLocations(analyzer, document, position);
//   if (!locations || locations.length === 0) {
//     return null;
//   }
//   const changes: {[uri: string]: TextEdit[]} = {};
//   const symbol = analyzer.getDefinition(document, position);
//   if (FishDocumentSymbol.isAlias(symbol)) {
//     const edits = changes[symbol.uri] || [];
//     edits.push(TextEdit.replace(symbol.selectionRange, newName));
//   }
//
//   // convert locations to changes TextDocumentEdit
//   for (const location of locations) {
//     const uri = location.uri;
//     const edits = changes[uri] || [];
//     edits.push(TextEdit.replace(location.range, newName));
//     changes[uri] = edits;
//   }
//
//   // add rename files
//   const renameFiles: RenameFile[] | null = getRenameFiles(analyzer, document, position, newName);
//   // if (documentChanges && documentChanges.length > 0) {
//   //   const docChanges = changes[document.uri] || [];
//   //   const identifier = OptionalVersionedTextDocumentIdentifier.create(document.uri, document.version);
//   //   return { documentChanges: [
//   //     TextDocumentEdit.create(identifier, docChanges),
//   //     ...documentChanges
//   //   ]}
//   //   // return { changes, documentChanges };
//   // }
//     // If we have any changes, convert them to TextDocumentEdit objects
//   if (Object.keys(changes).length > 0 || (renameFiles && renameFiles.length > 0)) {
//     // Create array for all document changes (both text edits and file renames)
//     const documentChanges: (TextDocumentEdit | RenameFile)[] = [];
//
//     // Add all text edits across different files
//     for (const [uri, localEdits] of Object.entries(changes)) {
//       // For each file URI, create a TextDocumentEdit
//       // Get the document for version info if available, otherwise use null version
//       const doc = analyzer.getDocument(uri);
//       const identifier = OptionalVersionedTextDocumentIdentifier.create(
//         uri,
//         doc?.version ?? 0,
//       );
//
//       documentChanges.push(TextDocumentEdit.create(identifier, localEdits));
//     }
//
//     // Add rename files if they exist
//     if (renameFiles && renameFiles.length > 0) {
//       documentChanges.push(...renameFiles);
//     }
//
//     return { documentChanges };
//   }
//
//   return { changes };
// }
// export function getRenameWorkspaceEdit(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): WorkspaceEdit | null {
//   const locations = getRenameLocations(analyzer, document, position);
//   if (!locations || locations.length === 0) {
//     return null;
//   }
//
//   // Group edits by URI
//   const changesByUri: Map<string, TextEdit[]> = new Map();
//
//   // Process the alias symbol if applicable
//   const symbol = analyzer.getDefinition(document, position);
//   if (FishDocumentSymbol.isAlias(symbol)) {
//     const edits = changesByUri.get(symbol.uri) || [];
//     edits.push(TextEdit.replace(symbol.selectionRange, newName));
//     changesByUri.set(symbol.uri, edits);
//   }
//
//   // Convert locations to changes
//   for (const location of locations) {
//     const uri = location.uri;
//     const edits = changesByUri.get(uri) || [];
//     edits.push(TextEdit.replace(location.range, newName));
//     changesByUri.set(uri, edits);
//   }
//
//   // Get document renames if they exist
//   const renameFiles = getRenameFiles(analyzer, document, position, newName);
//
//   // Create array for all document changes with specific ordering
//   const documentChanges: (TextDocumentEdit | RenameFile)[] = [];
//
//   // ORDERING STRATEGY:
//   // 1. First apply edits to the current document
//   if (changesByUri.has(document.uri)) {
//     const edits = changesByUri.get(document.uri)!;
//     const identifier = OptionalVersionedTextDocumentIdentifier.create(
//       document.uri,
//       null
//     );
//     documentChanges.push(TextDocumentEdit.create(identifier, Array.from(edits)));
//
//     // Remove the current document from the map as we've handled it
//     changesByUri.delete(document.uri);
//   }
//
//   // 2. Then apply edits to all other documents
//   for (const [uri, edits] of changesByUri.entries()) {
//     const identifier = OptionalVersionedTextDocumentIdentifier.create(
//       uri,
//       null
//     );
//     documentChanges.push(TextDocumentEdit.create(identifier, edits));
//   }
//
//   // 3. Finally apply file renames (these should come after text edits)
//   if (renameFiles && renameFiles.length > 0) {
//     documentChanges.push(...renameFiles);
//   }
//
//   if (documentChanges.length > 0) {
//     return { documentChanges };
//   }
//
//   // Fallback to the old format if needed
//   const changes: {[uri: string]: TextEdit[]} = {};
//   for (const [uri, edits] of changesByUri.entries()) {
//     changes[uri] = edits;
//   }
//   return { changes };
// }
export function getRenameWorkspaceEdit(analyzer: Analyzer, document: LspDocument, position: Position, newName: string): WorkspaceEdit | null {
  // const locations = getRenameLocations(analyzer, document, position);
  const locations = getReferenceLocations(analyzer, document, position);
  if (!locations || locations.length === 0) {
    return null;
  }
  const changes: {[uri: string]: TextEdit[];} = {};
  const symbol = analyzer.getDefinition(document, position);
  if (symbol.fishKind === 'ALIAS') {
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
  const toFind = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!toFind) {
    return [];
  }
  const localSymbol = analyzer.findDocumentSymbol(document, position);
  if (localSymbol) {
    symbols.push(localSymbol);
  } else {
    const toAdd: FishSymbol[] = localSymbols.filter((s) => {
      const variableBefore = s.kind === SymbolKind.Variable ? precedesRange(s.selectionRange, getRange(toFind)) : true;
      return (
        s.name === toFind.text
        && containsRange(
          getRange(s.scope.scopeNode),
          getRange(toFind),
        )
        && variableBefore
      );
    });
    symbols.push(...toAdd);
  }
  if (!symbols.length) {
    symbols.push(...analyzer.globalSymbols.find(toFind.text));
  }
  return symbols;
}
