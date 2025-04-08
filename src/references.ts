import { Location, Position, SymbolKind } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { isCommandWithName, isMatchingOption, isOption } from './utils/node-types';
// import { getGlobalArgparseLocations } from './parsing/argparse';
// import { SyntaxNode } from 'web-tree-sitter';
import { getRange } from './utils/tree-sitter';
import { FishSymbol } from './parsing/symbol';
import { isCompletionDefinition } from './parsing/complete';
import { Option } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';

export function getReferences(
  analyzer: Analyzer,
  document: LspDocument,
  position: Position,
): Location[] {
  const locations: Location[] = [];
  // const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  // if (!node) return [];

  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];
  if (symbol.fishKind === 'ARGPARSE') {
    locations.push(symbol.toLocation());
    locations.push(...getArgparseLocations(analyzer, symbol));
    return locations;
  }
  locations.push(symbol.toLocation());
  locations.push(...findSymbolLocations(analyzer, symbol));
  return locations;
}
// handle argparse reference where we ask for references on a
// `some_func --flag` and we have a definition symbol for `--flag`
// if (isOption(node)) {
//   const parentCommand = node.parent?.firstNamedChild;
//   const analyzeCommandSymbol = analyzer.findSymbol(sym =>
//     sym.node.parent?.firstNamedChild === parentCommand
//     && sym.fishKind === 'ARGPARSE'
//     && sym.argparseFlagName === node.text
//   );
//   if (analyzeCommandSymbol) {
//     locations.push(...getGlobalArgparseLocations(analyzer, document, analyzeCommandSymbol));
//   }
//   const matchingNodes = analyzer.findNodes((node: SyntaxNode) => {
//     if (node.parent && isCommandWithName(node.parent, parentCommand!.text)) {
//       return node.text === analyzeCommandSymbol?.argparseFlag;
//     }
//     return false;
//   });
//   matchingNodes.forEach(({ uri, nodes }) =>
//     locations.push(...nodes.map(node => Location.create(uri, getRange(node))))
//   );
//   return locations;
// }

// if (symbol.fishKind === 'FUNCTION') {
//   locations.push(symbol.toLocation());
//   locations.push(...findSymbolLocations(analyzer, symbol));
//   return locations;
// }
// if (symbol.fishKind === 'VARIABLE') {
// if (symbol.isGlobal()) {
//   const globalNodes = analyzer.findNodes((node: SyntaxNode, document) => {
//     const localSymbols = analyzer.cache.getFlatDocumentSymbols(document!.uri)
//       .filter(s => s.name === symbol.name && s.isLocal());
//     if (localSymbols.length > 0 && localSymbols.some(s => s.containsNode(node))) {
//       return false
//     }
//     return node.text === symbol.name;
//
//   });
//   globalNodes.forEach(({ uri, nodes }) =>
//     locations.push(...nodes.map(node => Location.create(uri, getRange(node))))
//   );
// }
//   return locations;
// }

// const symbol = analyzer.findDocumentSymbol(document, position);
// if (!symbol) return [];
// const references = analyzer.getReferences(document, symbol);
// for (const reference of references) {
//   const range = reference.range;
//   const uri = reference.uri;
//   locations.push(Location.create(uri, range));
// }
export function implementationLocation(
  analyzer: Analyzer,
  document: LspDocument,
  position: Position,
): Location[] {
  const locations: Location[] = [];
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return [];
  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];
  const newLocations = getReferences(analyzer, document, position)
    .filter(location => location.uri !== document.uri);

  if (newLocations.some(s => s.uri === symbol.uri)) {
    locations.push(symbol.toLocation());
    return locations;
  }
  if (newLocations.some(s => s.uri.includes('completions/'))) {
    locations.push(newLocations.find(s => s.uri.includes('completions/'))!);
    return locations;
  }
  // if (newLocations.some(s => s.uri.includes('functions/'))) {
  //   locations.push(newLocations.find(s => s.uri.includes('functions/'))!);
  //   return locations;
  // }

  // if (symbol.kind === SymbolKind.Function) {
  //   locations.push(symbol.toLocation());
  //   locations.push(...findSymbolLocations(analyzer, symbol));
  //   return locations;
  // }
  locations.push(symbol.toLocation());
  // locations.push(...findSymbolLocations(analyzer, symbol));
  return locations;
}

function findSymbolLocations(
  analyzer: Analyzer,
  symbol: FishSymbol,
): Location[] {
  const locations: Location[] = [];
  if (symbol.kind !== SymbolKind.Function && symbol.kind !== SymbolKind.Variable) return [];
  const matchingNodes = analyzer.findNodes((n, document) => {
    if (symbol.isLocal() && document!.uri === symbol.uri) {
      return symbol.scopeContainsNode(n) && n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    if (symbol.isGlobal()) {
      const localSymbols = analyzer.cache.getFlatDocumentSymbols(document!.uri)
        .filter(s => s.name === symbol.name && s.isLocal());
      if (localSymbols.length > 0 && localSymbols.some(s => s.scopeContainsNode(n))) {
        return false;
      }
      if (symbol.kind === SymbolKind.Variable && n.parent) {
        const isCompletion = isCompletionDefinition(n.parent);
        if (isCompletion) return false;
      }
      return n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    return false;
  });
  for (const { uri, nodes } of matchingNodes) {
    for (const node of nodes) {
      const range = getRange(node);
      locations.push(Location.create(uri, range));
    }
  }
  return locations;
}

export function getArgparseLocations(
  analyzer: Analyzer,
  symbol: FishSymbol,
): Location[] {
  const result: Location[] = [];
  // if (symbol.fishKind !== 'ARGPARSE') return [];
  logger.log('checking argparse locations for ', symbol.name);
  const parentName = symbol.parent!.name || symbol.scopeNode.firstNamedChild!.text!;
  logger.log('parentName: ', parentName);
  const document = analyzer.getDocument(symbol.uri);
  if (document) {
    result.push(...getGlobalArgparseLocations(analyzer, document, symbol));
  }
  const matchingNodes = analyzer.findNodes((n, document) => {
    // complete -c parentName -s ... -l flag-name
    // if (
    //   isCompletionDefinitionWithName(n, parentName, document)
    //   && n.text === symbol.argparseFlagName
    // ) {
    //   return true;
    // }
    // parentName --flag-name
    if (
      n.parent
      && isCommandWithName(n.parent, parentName)
      && isOption(n)
      && isMatchingOption(n, Option.fromRaw(symbol?.argparseFlag))
    ) {
      return true;
    }
    // _flag_name in scope
    if (
      document.uri === symbol.uri
      && symbol.scopeContainsNode(n)
      && n.text === symbol.name
    ) {
      return true;
    }
    return false;
  });
  logger.log('found matches: ', matchingNodes.length);
  matchingNodes.forEach(({ uri, nodes }) => {
    if (!nodes) return;
    nodes.forEach(node => {
      let range = getRange(node);
      if (isOption(node)) {
        range = {
          start: {
            line: range.start.line,
            character: range.start.character + getLeadingDashCount(node) + 1,
          },
          end: {
            line: range.end.line,
            character: range.end.character + 1,
          },
        };
      }
      result.push(Location.create(uri, range));
    });
  });
  return result;
}

export function getLeadingDashCount(node: SyntaxNode): number {
  if (!node || !node.text) return 0;

  const text = node.text;
  let count = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '-') {
      count++;
    } else {
      break;
    }
  }

  return count;
}
