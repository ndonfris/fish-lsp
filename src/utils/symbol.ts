import {
  DocumentSymbol,
  SymbolKind,
  // Range,
  DocumentUri,
  Position,
  Location,
  Range,
} from 'vscode-languageserver';
import { containsRange, getChildNodes, getRange, isPositionBefore, isPositionWithinRange } from './tree-sitter';
import { isVariableDefinitionName, isFunctionDefinitionName, refinedFindParentVariableDefinitionKeyword, isProgram, isCommandName } from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope, getScope } from './definition-scope';
import { MarkdownBuilder, md } from './markdown-builder';
import { symbolKindToString } from './translation';
import { PrebuiltDocumentationMap } from './snippets';
import { Analyzer } from 'src/future-analyze';
import { LspDocument } from 'src/document';

export interface FishDocumentSymbol extends DocumentSymbol {
  uri: string;
  children: FishDocumentSymbol[];
  scope: DefinitionScope;
  node: SyntaxNode;
  mdCallback: (parent: SyntaxNode) => string;
  get detail(): string;
}

function mdCallback(this: FishDocumentSymbol, parent: SyntaxNode): string {
  const found = PrebuiltDocumentationMap.findMatchingNames(this.name, 'variable', 'command')?.find(name => name.name === this.name);
  // const moreInfo = !!found ? found.description + md.newline() + md.separator() : md.separator();
  const kindStr = `(${symbolKindToString(this.kind)})`;
  return new MarkdownBuilder().fromMarkdown(
    [
      md.bold(kindStr), '-', md.italic(this.name),
    ],
    md.separator(),
    md.codeBlock('fish', parent.text),
    found
      ? md.newline() + md.separator() + md.newline() + found.description
      : '',
  ).toString();
}

function extractSymbolInfo(node: SyntaxNode): {
  shouldCreate: boolean;
  kind: SymbolKind;
  child: SyntaxNode;
  parent: SyntaxNode;

} {
  let shouldCreate = false;
  let kind: SymbolKind = SymbolKind.Null;
  let parent: SyntaxNode = node;
  let child: SyntaxNode = node;
  if (isVariableDefinitionName(child)) {
    parent = refinedFindParentVariableDefinitionKeyword(child)!.parent!;
    child = node;
    kind = SymbolKind.Variable;
    shouldCreate = !child.text.startsWith('$');
  } else if (child.firstNamedChild && isFunctionDefinitionName(child.firstNamedChild)) {
    parent = node;
    child = child.firstNamedChild!;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return { shouldCreate, kind, parent, child };
}

// export type Symbol = WorkspaceSymbol | DocumentSymbol;

// export function flattenNested<T extends { children: T[]; }>(...items: T[]): T[] {
//   return items.flatMap(item => [item, ...flattenNested(...item.children)]);
// }

export function flattenNested<T extends { children?: T[]; }>(...roots: T[]): T[] {
  const result: T[] = [];
  let index = 0;

  result.push(...roots);

  while (index < result.length) {
    const current = result[ index++ ];
    if (current?.children) result.push(...current?.children);
  }

  return result;
}

export function getFishDocumentSymbolItems(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
  const symbols: FishDocumentSymbol[] = [];
  for (const current of currentNodes) {
    const childrenSymbols = getFishDocumentSymbolItems(uri, ...current.children);
    const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);
    if (shouldCreate) {
      symbols.push({
        name: child.text,
        kind,
        uri,
        node: current,
        range: getRange(parent),
        selectionRange: getRange(child),
        scope: getScope(uri, child),
        children: childrenSymbols ?? [] as FishDocumentSymbol[],
        mdCallback,
        get detail() {
          return this.mdCallback(parent);
        },
      });
      continue;
    }
    symbols.push(...childrenSymbols);
  }
  return symbols;
}

/**
 * flat list of symbols, up to the position given (including symbols at the position)
 */
export function filterDocumentSymbolInScope(symbols: FishDocumentSymbol[], position: Position) {
  // return flattenNested(...symbols)
  //   .filter(symbol => {
  //     //   if (
  //     //     symbol.kind === SymbolKind.Function
  //     //       && symbol.node.parent
  //     //       && isProgram(symbol.node.parent)
  //     //   ) {
  //     //     return true;
  //     //   } else if (
  //     //     symbol.scope.containsPosition(position)
  //     //       && isPositionBefore(symbol.selectionRange.start, position)
  //     //   ) {
  //     //     return true;
  //     //   }
  //     //   return false;
  //     // });
  function isValidSymbol(symbol: FishDocumentSymbol): boolean {
    if (symbol.kind === SymbolKind.Function) {
      // Check if the function's parent node includes the position
      return !!symbol.node.parent && isPositionWithinRange(position, getRange(symbol.node.parent));
    }

    return (
      symbol.scope.containsPosition(position) &&
      isPositionBefore(symbol.selectionRange.start, position)
    );
  }

  function filterSymbolsRecursively(symbolsToFilter: FishDocumentSymbol[]): FishDocumentSymbol[] {
    return symbolsToFilter.flatMap(symbol => {
      const validChildren = symbol.children ? filterSymbolsRecursively(symbol.children) : [];
      return isValidSymbol(symbol) ? [ symbol, ...validChildren ] : validChildren;
    });
  }

  return filterSymbolsRecursively(symbols);
  // }
}

/**
 * unflattened workspace symbol finder
 */
export function filterWorkspaceSymbol(symbols: FishDocumentSymbol[]) {
  function filter(symbol: FishDocumentSymbol) {
    const { scopeTag } = symbol.scope;
    if (symbol.kind === SymbolKind.Function) {
      if ('global' === scopeTag) {
        return true;
      }
      // if ('local' === scopeTag && scopeNode?.parent && isProgram(scopeNode.parent)) {
      //   return true;
      // }
    } else if (symbol.kind === SymbolKind.Variable) {
      if (scopeTag === 'global' || scopeTag === 'universal') {
        return true;
      }
    }
    return false;
  }

  return flattenNested(...symbols).filter(filter);
}

// @TODO
function filterLocalSymbols(symbols: FishDocumentSymbol[]) {
  return flattenNested(...symbols)
    .filter(s => s.scope.scopeTag !== 'global' && s.scope.scopeTag !== 'universal');
}


//
//
//
// export function filterLastPerScopeSymbol(symbolArray: FishDocumentSymbol[]) {
//   const symbolTree = flattenNested(symbolArray);
//   return symbolTree
//     .filter((symbol: FishDocumentSymbol) => !symbolTree.some((s) => {
//       return (
//         s.name === symbol.name &&
//           !FishDocumentSymbol.equal(symbol, s) &&
//           FishDocumentSymbol.equalScopes(symbol, s) &&
//           FishDocumentSymbol.isBefore(symbol, s)
//       );
//     }))
//     .toArray();
// }
//


function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
  const equalRanges = (a: Range, b: Range) => {
    return (
      a.start.line === b.start.line &&
      a.start.character === b.start.character &&
      a.end.line === b.end.line &&
      a.end.character === b.end.character
    );
  };
  const matchingNames = nodes.filter(node => node.text === matchName);
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

// function findLocalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
//   const symbol = findDefinitionSymbols(analyzer, document, position).pop();
//   if (!symbol) {
//     return [];
//   }
//   const nodesToSearch = getChildNodes(symbol.scope.scopeNode);
//   return findLocations(document.uri, nodesToSearch, symbol.name);
// }
//
// function removeLocalSymbols(matchSymbol: FishDocumentSymbol, nodes: SyntaxNode[], symbols: FishDocumentSymbol[]) {
//   const name = matchSymbol.name;
//   const matchingSymbols = filterLocalSymbols(symbols.filter(symbol => symbol.name === name)).map(symbol => symbol.scope.scopeNode);
//   const matchingNodes = nodes.filter(node => node.text === name);
//
//   if (matchingSymbols.length === 0 || matchSymbol.kind === SymbolKind.Function) {
//     return matchingNodes;
//   }
//
//   return matchingNodes.filter((node) => {
//     if (matchingSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) {
//       return false;
//     }
//     return true;
//   });
// }
// function findGlobalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
//   const locations: Location[] = [];
//   const symbol = analyzer.findDocumentSymbol(document, position);
//   if (!symbol) {
//     return [];
//   }
//   const uris = analyzer.cache.uris();
//   for (const uri of uris) {
//     const doc = analyzer.getDocument(uri)!;
//     if (!doc.isAutoLoaded()) {
//       continue;
//     }
//     const rootNode = analyzer.getRootNode(doc)!;
//     const toSearchNodes = removeLocalSymbols(symbol, getChildNodes(rootNode), analyzer.cache.getFlatDocumentSymbols(uri));
//     const newLocations = findLocations(uri, toSearchNodes, symbol.name);
//     locations.push(...newLocations);
//   }
//   return locations;
// }
//
// export function getReferenceLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
//   const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
//   if (!node) return [];
//   const symbol = analyzer.getDefinition(document, position);
//   if (symbol) {
//     const doc = analyzer.getDocument(symbol.uri)!;
//     const { scopeTag } = symbol.scope;
//     switch (scopeTag) {
//       case 'global':
//       case 'universal':
//         return findGlobalLocations(analyzer, doc, symbol.selectionRange.start);
//       case 'local':
//       default:
//         return findLocalLocations(analyzer, document, symbol.selectionRange.start);
//     }
//   }
//   if (isCommandName(node)) {
//     const uris = analyzer.cache.uris();
//     const locations: Location[] = [];
//     for (const uri of uris) {
//       const doc = analyzer.getDocument(uri)!;
//       const rootNode = analyzer.getRootNode(doc)!;
//       const nodes = getChildNodes(rootNode).filter(n => isCommandName(n));
//       const newLocations = findLocations(uri, nodes, node.text);
//       locations.push(...newLocations);
//     }
//     return locations;
//   }
//   return [];
// }
//
//
// // function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
// //   const equalRanges = (a: Range, b: Range) => {
// //     return (
// //       a.start.line === b.start.line &&
// //         a.start.character === b.start.character &&
// //         a.end.line === b.end.line &&
// //         a.end.character === b.end.character
// //     );
// //   };
// //   const matchingNames = nodes.filter(node => node.text === matchName);
// //   const uniqueRanges: Range[] = [];
// //   matchingNames.forEach(node => {
// //     const range = getRange(node);
// //     if (uniqueRanges.some(u => equalRanges(u, range))) {
// //       return;
// //     }
// //     uniqueRanges.push(range);
// //   });
// //   return uniqueRanges.map(range => Location.create(uri, range));
// // }
// //
// // function filterLocalSymbols(symbols: FishDocumentSymbol[]) {
// //   return flattenNested(...symbols)
// //     .filter(s => s.scope.scopeTag !== 'global' && s.scope.scopeTag !== 'universal')
// // }
// //
// // function findLocalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
// //   const symbol = findDefinitionSymbols(analyzer, document, position).pop();
// //   if (!symbol) {
// //     return [];
// //   }
// //   const nodesToSearch = getChildNodes(symbol.scope.scopeNode);
// //   return findLocations(document.uri, nodesToSearch, symbol.name);
// // }
//
// // function removeLocalSymbols(matchSymbol: FishDocumentSymbol, nodes: SyntaxNode[], symbols: FishDocumentSymbol[]) {
// //   const name = matchSymbol.name;
// //   const matchingSymbols = filterLocalSymbols(symbols.filter(symbol => symbol.name === name)).map(symbol => symbol.scope.scopeNode);
// //   const matchingNodes = nodes.filter(node => node.text === name);
// //
// //   if (matchingSymbols.length === 0 || matchSymbol.kind === SymbolKind.Function) {
// //     return matchingNodes;
// //   }
// //
// //   return matchingNodes.filter((node) => {
// //     if (matchingSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) {
// //       return false;
// //     }
// //     return true;
// //   });
// // }
// // function findGlobalLocations(analyzer: Analyzer, document: LspDocument, position: Position): Location[] {
// //   const locations: Location[] = [];
// //   const symbol = analyzer.findDocumentSymbol(document, position);
// //   if (!symbol) {
// //     return [];
// //   }
// //   const uris = Object(analyzer.cached).uris();
// //   for (const uri of uris) {
// //     const doc = analyzer.getDocument(uri)!;
// //     if (!doc.isAutoLoaded()) {
// //       continue;
// //     }
// //     const { root } = analyzer.cached.get(doc.uri)!;
// //     const toSearchNodes = removeLocalSymbols(symbol, getChildNodes(root), analyzer.getFlatSymbols(uri));
// //     const newLocations = findLocations(uri, toSearchNodes, symbol.name);
// //     locations.push(...newLocations);
// //   }
// //   return locations;
// // }
// //
// //


export function getGlobalSyntaxNodesInDocument(nodes: SyntaxNode[], symbols: FishDocumentSymbol[]) {

  // const flatSymbols = flattenNested(...symbols)
  //   .filter(s => s.scope.scopeTag !== 'global')
  //
  // return nodes.filter(n => !flatSymbols.some(range => containsRange(range, getRange(n))));
  return nodes.filter(n => !symbols.some(symbol => containsRange(getRange(symbol.scope.scopeNode), getRange(n)) && symbol.name === n.text));

}