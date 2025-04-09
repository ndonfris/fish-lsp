import { Location, Position, SymbolKind } from 'vscode-languageserver';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { isCommandWithName, isCompleteCommandName, isMatchingOption, isOption } from './utils/node-types';
import { getRange } from './utils/tree-sitter';
import { FishSymbol } from './parsing/symbol';
import { isCompletionDefinition } from './parsing/complete';
import { Option } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';

/**
 * get all the references for a symbol, including the symbol's definition
 * @param analyzer the analyzer
 * @param document the document
 * @param position the position of the symbol
 * @return the locations of the symbol
 */
export function getReferences(
  analyzer: Analyzer,
  document: LspDocument,
  position: Position,
): Location[] {
  const locations: Location[] = [];

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

/**
 * bi-directional jump to either definition or completion definition
 * @param analyzer the analyzer
 * @param document the document
 * @param position the position of the symbol
 * @return the locations of the symbol, should be a lower number of locations than getReferences
 */
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
  locations.push(symbol.toLocation());
  return locations;
}

/**
 * find all the symbol locations for a normal symbol (not an `argparse` flag)
 */
function findSymbolLocations(
  analyzer: Analyzer,
  symbol: FishSymbol,
): Location[] {
  const locations: Location[] = [];
  if (symbol.kind !== SymbolKind.Function && symbol.kind !== SymbolKind.Variable) return [];
  const matchingNodes = analyzer.findNodes((n, document) => {
    // check if the node is a local symbol
    if (symbol.isLocal() && document!.uri === symbol.uri) {
      return symbol.scopeContainsNode(n) && n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    if (symbol.isGlobal()) {
      // get all the local symbols for the current document, and remove any node that is redefined in the local scope
      const localSymbols = analyzer.cache.getFlatDocumentSymbols(document!.uri)
        .filter(s => s.name === symbol.name && s.isLocal());
      if (localSymbols.length > 0 && localSymbols.some(s => s.scopeContainsNode(n))) {
        return false;
      }
      // remove `complete ... -s opt -l opt` entries for variables
      if (symbol.kind === SymbolKind.Variable && n.parent) {
        const isCompletion = isCompletionDefinition(n.parent);
        if (isCompletion) return false;
      }
      // remove `complete ... -l cmdname` entries, keep `complete -c cmdname` for functions
      if (symbol.kind === SymbolKind.Function && isCompleteCommandName(n)) {
        return n.text === symbol.name && !symbol.focusedNode.equals(n);
      } else if (symbol.kind === SymbolKind.Function && n.parent && isCommandWithName(n.parent, 'complete')) {
        return false;
      }
      // remove non command name entries for functions
      // if (symbol.kind === SymbolKind.Function && n.parent && isCommandWithName(n.parent, 'command', 'type', 'builtin', 'functions')) {
      //   return n.text === symbol.name && !symbol.focusedNode.equals(n);
      // }
      if (symbol.kind === SymbolKind.Function && !isCommandWithName(n, symbol.name)) {
        return false;
      }
      return n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    return false;
  });
  // create the new locations
  for (const { uri, nodes } of matchingNodes) {
    for (const node of nodes) {
      const range = getRange(node);
      locations.push(Location.create(uri, range));
    }
  }
  return locations;
}

/**
 * Handle finding the locations of an argparse flag, including any completion definition
 * or usage of the flag itself.
 */
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
