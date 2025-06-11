import { Location, Position, SymbolKind } from 'vscode-languageserver';
import { analyzer, Analyzer } from './analyze';
import { LspDocument } from './document';
import { isCommandWithName, isCompleteCommandName, isMatchingOption, isOption } from './utils/node-types';
import { getRange } from './utils/tree-sitter';
import { FishSymbol } from './parsing/symbol';
import { isCompletionCommandDefinition } from './parsing/complete';
import { Option } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations, isCompletionArgparseFlagWithCommandName } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';
import * as Locations from './utils/locations';
import { uriToReadablePath } from './utils/translation';

/**
 * get all the references for a symbol, including the symbol's definition
 * @param analyzer the analyzer
 * @param document the document
 * @param position the position of the symbol
 * @param localOnly if true, only return local references inside current document
 * @return the locations of the symbol
 */
export function getReferences(
  document: LspDocument,
  position: Position,
  localOnly = false,
): Location[] {
  const startTime = performance.now();

  const locations: Location[] = [];

  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];
  if (symbol.fishKind === 'ARGPARSE') {
    locations.push(symbol.toLocation());
    locations.push(...getArgparseLocations(analyzer, symbol, localOnly));
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places

    // logging performance
    logger.info({
      isArgparse: true,
      document: uriToReadablePath(document.uri),
      position: `${position.line}:${position.character}`,
      symbol: symbol.name,
      locations: locations.length,
      message: `getReferences() took ${duration} ms`,
    });
    return locations;
  }

  // only search for local references if the symbol is local definition
  // NOTICE: we don't do this for argparse locations cause they might not be local
  if (symbol.isLocal()) localOnly = true;

  locations.push(symbol.toLocation());
  const symbolLocations = findSymbolLocations(symbol, localOnly);
  // add unique locations
  for (const location of symbolLocations) {
    if (!locations.some(loc => Locations.Location.equals(loc, location))) {
      locations.push(location);
    }
  }

  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
  // logging performance
  logger.info({
    isArgparse: false,
    document: uriToReadablePath(document.uri),
    position: `${position.line}:${position.character}`,
    symbol: symbol.name,
    locations: locations.length,
    message: `getReferences() took ${duration} ms`,
  });

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
  document: LspDocument,
  position: Position,
): Location[] {
  const locations: Location[] = [];
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return [];
  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];
  const newLocations = getReferences(document, position)
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
  symbol: FishSymbol,
  localOnly = false,
): Location[] {
  const locations: Location[] = [];
  if (symbol.kind !== SymbolKind.Function && symbol.kind !== SymbolKind.Variable) return [];
  const locationsCallback = (n: SyntaxNode, doc: LspDocument) => {
    if (localOnly && doc.uri !== symbol.uri) return false;
    // check if the node is a local symbol
    if (symbol.isLocal() && doc!.uri === symbol.uri) {
      return symbol.scopeContainsNode(n) && n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    if (symbol.isGlobal()) {
      // get all the local symbols for the current document, and remove any node that is redefined in the local scope
      const localSymbols = analyzer.cache.getFlatDocumentSymbols(doc!.uri)
        .filter(s => s.name === symbol.name && s.isLocal());
      if (localSymbols.length > 0 && localSymbols.some(s => s.scopeContainsNode(n))) {
        return false;
      }
      // remove `complete ... -s opt -l opt` entries for variables
      if (symbol.kind === SymbolKind.Variable && n.parent) {
        const isCompletion = isCompletionCommandDefinition(n.parent);
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
      if (symbol.kind === SymbolKind.Function && n.parent && !isCommandWithName(n.parent, symbol.name) && n.parent.firstChild?.equals(n)) {
        return false;
      }
      return n.text === symbol.name && !symbol.focusedNode.equals(n);
    }
    return false;
  };
  const localDocument = analyzer.getDocument(symbol.uri);
  const matchingNodes: { uri: string; nodes: SyntaxNode[]; }[] = [];
  if (localOnly && localDocument) {
    const localNodes = analyzer.getNodes(symbol.uri)
      .filter(n => locationsCallback(n, localDocument));
    matchingNodes.push({ uri: localDocument.uri, nodes: localNodes });
  } else {
    matchingNodes.push(...analyzer.findNodes((n: SyntaxNode, doc: LspDocument) => locationsCallback(n, doc)));
  }
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
  localOnly = false,
): Location[] {
  const result: Location[] = [];
  const parentName = symbol.parent?.name
    || symbol.scopeNode.firstNamedChild?.text
    || symbol.scopeNode.text;

  const document = analyzer.getDocument(symbol.uri);
  /**
   * Ensure that our document includes all possible global completion location
   */
  if (document) {
    result.push(...getGlobalArgparseLocations(analyzer, document, symbol));
  }
  const matchingNodes = analyzer.findNodes((n, document) => {
    if (localOnly && document.uri !== symbol.uri) return false;
    // complete -c parentName -s ... -l flag-name
    if (isCompletionArgparseFlagWithCommandName(n, parentName, symbol.argparseFlagName)) {
      return true;
    }
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
  matchingNodes.forEach(({ uri, nodes }) => {
    if (!nodes) return;
    nodes.forEach(node => {
      let range = getRange(node);
      if (isOption(node)) {
        range = {
          start: {
            line: range.start.line,
            character: range.start.character + getLeadingDashCount(node),
          },
          end: {
            line: range.end.line,
            character: range.end.character + 1,
          },
        };
      }
      if (!result.some(loc => Locations.Location.equals(loc, { uri, range }))) {
        result.push(Location.create(uri, range));
      }
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
