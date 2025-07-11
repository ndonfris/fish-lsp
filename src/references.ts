import { DocumentUri, Location, Position, Range, WorkDoneProgressReporter } from 'vscode-languageserver';
import { analyzer } from './analyze';
import { LspDocument } from './document';
import { findParentCommand, findParentFunction, isCommandName, isCommandWithName, isMatchingOption, isOption, isProgram, isString } from './utils/node-types';
import { containsNode, getChildNodes, getRange } from './utils/tree-sitter';
import { filterFirstPerScopeSymbol, FishSymbol } from './parsing/symbol';
import { isMatchingOptionOrOptionValue, Option } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';
import * as Locations from './utils/locations';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { uriToReadablePath } from './utils/translation';
import { FishAlias, isAliasDefinitionValue } from './parsing/alias';
import { extractCommandLocations, extractCommands, extractMatchingCommandLocations } from './parsing/nested-strings';
import { isEmittedEventDefinitionName } from './parsing/emit';

// ┌──────────────────────────────────┐
// │ file handles 3 main operations:  │
// │   • getReferences()              │
// │   • allUnusedLocalReferences()   │
// │   • getImplementations()         │
// └──────────────────────────────────┘

/**
 * Options for the getReferences function
 */
export type ReferenceOptions = {
  // don't include the definition of the symbol itself
  excludeDefinition?: boolean;
  // only check local references inside the current document
  localOnly?: boolean;
  // stop searching after the first match
  firstMatch?: boolean;
  // search in all workspaces, default is to search only the current workspace
  allWorkspaces?: boolean;
  // only consider matches in the specified files
  onlyInFiles?: ('conf.d' | 'functions' | 'config' | 'completions')[];
  // log performance, show timing of the function
  logPerformance?: boolean;
  // enable logging for the function
  loggingEnabled?: boolean;

  reporter?: WorkDoneProgressReporter; // callback to report the number of references found
};

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
  opts: ReferenceOptions = {
    excludeDefinition: false,
    localOnly: false,
    firstMatch: false,
    allWorkspaces: false,
    onlyInFiles: [],
    logPerformance: true,
    loggingEnabled: false,
    reporter: undefined,
  },
): Location[] {
  const results: Location[] = [];
  const logCallback = logWrapper(document, position, opts);

  // Get the Definition Symbol of the current position, if there isn't one
  // we can't find any references
  const definitionSymbol = analyzer.getDefinition(document, position);
  if (!definitionSymbol) {
    logCallback(
      `No definition symbol found for position ${JSON.stringify(position)} in document ${document.uri}`,
      'warning',
    );
    return [];
  }

  // include the definition symbol itself
  if (!opts.excludeDefinition) results.push(definitionSymbol.toLocation());

  // if the symbol is local, we only search in the current document
  if (isSymbolLocalToDocument(definitionSymbol)) opts.localOnly = true;

  // create a list of al documents we will search for references
  const documentsToSearch: LspDocument[] = getDocumentsToSearch(document, logCallback, opts);

  // analyze the CompletionSymbol's and add their locations to result array
  // this is separate from the search operation because analysis lazy loads
  // completion documents (completion files are skipped during the initial workspace load)
  if (definitionSymbol.isArgparse() || definitionSymbol.isFunction()) {
    results.push(...getGlobalArgparseLocations(definitionSymbol.document, definitionSymbol));
  }
  if (
    definitionSymbol.isFunction()
    && definitionSymbol.hasEventHook()
    && definitionSymbol.document.isAutoloaded()
  ) {
    results.push(...analyzer.findSymbols((d, _) => {
      if (d.isEmittedEvent() && d.name === definitionSymbol.name) {
        return true;
      }
      return false;
    }).map(d => d.toLocation()));
  }

  // convert the documentsToSearch to a Set for O(1) lookups
  const searchableDocumentsUris = new Set<string>(documentsToSearch.map(doc => doc.uri));
  const searchableDocuments = new Set<LspDocument>(documentsToSearch.filter(doc => searchableDocumentsUris.has(doc.uri)));

  // dictionary where we will store the references found, used to build the results
  const matchingNodes: { [document: DocumentUri]: SyntaxNode[]; } = {};

  // boolean to control stopping our search when opts.firstMatch is true
  let shouldExitEarly = false;

  // utils for reporting progress during large searches of references
  let reporting = false;
  const reporter = opts.reporter;

  // if we have a reporter, we will report the progress of the search
  if (opts.reporter && searchableDocuments.size > 500) {
    reporter?.begin('[fish-lsp] finding references', 0, 'Finding references...', true);
    reporting = true;
  }

  let index = 0;
  // search the valid documents for references and store matches to build after
  // we have collected all valid matches for the requested options
  for (const doc of searchableDocuments) {
    const prog = Math.ceil((index + 1) / searchableDocuments.size * 100);
    if (reporting) {
      reporter?.report(prog);
    }
    index += 1;

    if (!workspaceManager.current?.contains(doc.uri)) {
      continue;
    }

    // const getFilteredSymbols = () => {
    //   if (definitionSymbol.isVariable() && !definitionSymbol.isArgparse()) {
    //     // if the symbol is a variable, we only want to find references in the current document
    //     return analyzer.getFlatDocumentSymbols(doc.uri)
    //       .filter(
    //         s => s.isLocal()
    //         && !s.equals(definitionSymbol)
    //         && !definitionSymbol.equalScopes(s)
    //         // && !s.parent?.equals(definitionSymbol?.parent || definitionSymbol)
    //         && s.name === definitionSymbol.name
    //         && s.kind === definitionSymbol.kind,
    //       );
    //   }
    //   if (doc.uri === definitionSymbol.uri) return [];
    //   return analyzer.getFlatDocumentSymbols(doc.uri)
    //     .filter(s =>
    //       s.isLocal()
    //       && s.name === definitionSymbol.name
    //       && s.kind === definitionSymbol.kind
    //       && !s.equals(definitionSymbol),
    //     );
    // };

    const filteredSymbols = getFilteredLocalSymbols(definitionSymbol, doc);

    const root = analyzer.getRootNode(doc.uri);
    if (!root) {
      logCallback(`No root node found for document ${doc.uri}`, 'warning');
      continue;
    }
    const matchableNodes = getChildNodesOptimized(definitionSymbol, doc);

    for (const node of matchableNodes) {
      // skip nodes that are redefinitions of the symbol in the local scope
      if (filteredSymbols && filteredSymbols.some(s => s.containsNode(node) || s.scopeNode.equals(node) || s.scopeContainsNode(node))) {
        continue;
      }
      // store matches in the matchingNodes dictionary
      if (definitionSymbol.isReference(doc, node, true)) {
        const currentDocumentsNodes = matchingNodes[doc.uri] ?? [];
        currentDocumentsNodes.push(node);
        matchingNodes[doc.uri] = currentDocumentsNodes;
        if (opts.firstMatch) {
          shouldExitEarly = true; // stop searching after the first match
          break;
        }
      }
    }
    if (shouldExitEarly) break;
  }

  // now convert the matching nodes to locations
  for (const [uri, nodes] of Object.entries(matchingNodes)) {
    for (const node of nodes) {
      const locations = getLocationWrapper(definitionSymbol, node, uri)
        .filter(loc => !results.some(location => Locations.Location.equals(loc, location)));
      results.push(...locations);
    }
  }

  // log the results, if logging option is enabled
  const docShorthand = `${workspaceManager.current?.name}`;
  const count = results.length;
  const name = definitionSymbol.name;
  logCallback(
    `Found ${count} references for symbol '${name}' in document '${docShorthand}'`,
    'info',
  );

  if (reporting) reporter?.done();

  const sorter = locationSorter(definitionSymbol);
  return results.sort(sorter);
}

/**
 * Returns all unused local references in the current document.
 */
export function allUnusedLocalReferences(document: LspDocument): FishSymbol[] {
  // const allSymbols = analyzer.getFlatDocumentSymbols(document.uri);

  const symbols = filterFirstPerScopeSymbol(document).filter(s =>
    s.isLocal()
    && s.name !== 'argv'
    && !s.isEventHook(),
  );

  if (!symbols) return [];

  const usedSymbols: FishSymbol[] = [];
  const unusedSymbols: FishSymbol[] = [];

  for (const symbol of symbols) {
    // const localSymbols = symbol.parent?.children.filter(c =>
    //   c.name === symbol.name
    //   && !c.equals(symbol)
    //   && c.kind === symbol.kind
    //   && !symbol.containsScope(c),
    // );
    const localSymbols = getFilteredLocalSymbols(symbol, document);

    let found = false;
    const root = analyzer.getRootNode(document.uri);
    if (!root) {
      logger.warning(`No root node found for document ${document.uri}`);
      continue;
    }
    for (const node of getChildNodes(root)) {
      // skip nodes that are redefinitions of the symbol in the local scope
      if (localSymbols?.some(c => c.scopeContainsNode(node))) {
        continue;
      }
      if (symbol.isReference(document, node, true)) {
        found = true;
        usedSymbols.push(symbol);
        break;
      }
    }
    if (!found) unusedSymbols.push(symbol);
  }

  // Confirm that the unused symbols are not referenced by any used symbols for edge cases
  // where names don't match, but the symbols are meant to overlap in usage:
  //
  // `argparse h/help`/`_flag_h`/`_flag_help`/`complete -s h -l help`
  // `function event_handler --on-event my_event`/`emit my_event # usage of event_handler`
  //
  const finalUnusedSymbols = unusedSymbols.filter(symbol => {
    if (symbol.isArgparse() && usedSymbols.some(s => s.equalArgparse(symbol))) {
      return false;
    }
    if (symbol.hasEventHook()) {
      if (symbol.isGlobal()) return false;
      if (
        symbol.isLocal()
        && symbol.children.some(c => c.fishKind === 'FUNCTION_EVENT' && usedSymbols.some(s => s.isEmittedEvent() && c.name === s.name))
      ) {
        return false;
      }
      // for a function that should be treated locally, but a event that is emitted globally in another doc
      if (symbol.document.isAutoloaded() && symbol.isFunction() && symbol.hasEventHook()) {
        const eventsEmitted = symbol.children.filter(c => c.isEventHook());
        for (const event of eventsEmitted) {
          if (analyzer.findNode(n => isEmittedEventDefinitionName(n) && n.text === event.name)) {
            return false;
          }
        }
      }
    }
    return true;
  });
  logger.debug({
    usage: 'finalUnusedLocalReferences',
    finalUnusedSymbols: finalUnusedSymbols.map(s => s.name),
  });

  return finalUnusedSymbols;
}

/**
 * bi-directional jump to either definition or completion definition
 * @param analyzer the analyzer
 * @param document the document
 * @param position the position of the symbol
 * @return the locations of the symbol, should be a lower number of locations than getReferences
 */
export function getImplementation(
  document: LspDocument,
  position: Position,
): Location[] {
  const locations: Location[] = [];
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return [];
  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];
  if (symbol.isEmittedEvent()) {
    const result = analyzer.findSymbol((s, _) =>
      s.isEventHook() && s.name === symbol.name,
    )?.toLocation();
    if (result) {
      locations.push(result);
      return locations;
    }
  }
  if (symbol.isEventHook()) {
    const result = analyzer.findSymbol((s, _) =>
      s.isEmittedEvent() && s.name === symbol.name,
    )?.toLocation();
    if (result) {
      locations.push(result);
      return locations;
    }
  }

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
 * Returns the location of a node, based on the symbol.
 * Handles special cases where a reference might be part of a larger token from tree-sitter.
 *
 * For example, in argparse switches, we want to return the location of the flag name which
 * might include a short flag and a long flag like:
 *
 * ```fish
 * argparse h/help -- $argv # we might want 'h' or 'help' specifically, fish tokenizes the 'h/help' together
 * ```
 *
 * @param symbol the definition symbol for which we are searching for references
 * @param node the tree-sitter node that matches the symbol
 * @param uri the document URI of the node (for global symbols, the URI might not match the symbol's URI)
 * @return an array of locations for the node, most commonly a single item is returned in the array
 */
function getLocationWrapper(symbol: FishSymbol, node: SyntaxNode, uri: DocumentUri): Location[] {
  let range = getRange(node);
  // for argparse flags, we want the range of the flag name, not the whole option
  if (symbol.fishKind === 'ARGPARSE' && isOption(node)) {
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
    return [Location.create(uri, range)];
  }
  if (isAliasDefinitionValue(node)) {
    const parent = findParentCommand(node);
    if (!parent) return [];

    const info = FishAlias.getInfo(parent);
    if (!info) return [];

    const aliasRange = extractCommandRangeFromAliasValue(node, symbol.name);
    if (aliasRange) {
      range = aliasRange;
    }
    return [Location.create(uri, range)];
  }
  if (NestedSyntaxNodeWithReferences.isBindCall(symbol, node)) {
    return extractMatchingCommandLocations(symbol, node, uri);
  }
  if (NestedSyntaxNodeWithReferences.isCompleteConditionCall(symbol, node)) {
    return extractMatchingCommandLocations(symbol, node, uri);
  }
  if (symbol.isFunction() && (isString(node) || isOption(node))) {
    return extractCommandLocations(node, uri)
      .filter(loc => loc.command === symbol.name)
      .map(loc => loc.location);
  }
  return [Location.create(uri, range)];
}

/**
 * Counts the number of leading dashes in a node's text
 * This is used to determine the range of an option flag in an argparse's completion or usage
 * @param node the completion node to check
 * @return the number of leading dashes in the node's text
 */
function getLeadingDashCount(node: SyntaxNode): number {
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

/**
 * Namespace for checking SyntaxNode references are of a specific type
 *  • `alias foo='<NODE>'`
 *  • `bind ctrl-space '<NODE>'`
 *  • `complete -c foo -n '<NODE>' -xa '1 2 3'`
 */
export namespace NestedSyntaxNodeWithReferences {
  export function isAliasValueNode(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
    if (!isAliasDefinitionValue(node)) return false;
    const parent = findParentCommand(node);
    if (!parent) return false;
    const info = FishAlias.getInfo(parent);
    if (!info) return false;
    const infoCmds = info.value.split(';').map(cmd => cmd.trim().split(' ').at(0));
    return infoCmds.includes(definitionSymbol.name);
  }

  export function isBindCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
    if (!node?.parent || isOption(node)) return false;
    const parent = findParentCommand(node);
    if (!parent || !isCommandWithName(parent, 'bind')) return false;
    const subcommands = parent.children.slice(2).filter(c => !isOption(c));
    if (!subcommands.some(c => c.equals(node))) return false;
    const cmds = extractCommands(node);
    return cmds.some(cmd => cmd === definitionSymbol.name);
  }

  export function isCompleteConditionCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
    if (isOption(node) || !node.isNamed || isProgram(node)) return false; // skip options
    if (!node.parent || !isCommandWithName(node.parent, 'complete')) return false;
    if (!node?.previousSibling || !isMatchingOption(node?.previousSibling, Option.fromRaw('-n', '--condition'))) return false;
    const cmds = extractCommands(node);
    logger.debug(`Extracted commands from complete condition node: ${cmds}`);
    return !!cmds.some(cmd => cmd.trim() === definitionSymbol.name);
  }

  export function isWrappedCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
    if (!node?.parent || !findParentFunction(node)) return false;
    if (node.previousNamedSibling && isMatchingOption(node.previousNamedSibling, Option.fromRaw('-w', '--wraps'))) {
      const cmds = extractCommands(node);
      logger.debug(`Extracted commands from wrapped call node: ${cmds}`);
      return cmds.some(cmd => cmd.trim() === definitionSymbol.name);
    }
    if (isMatchingOptionOrOptionValue(node, Option.fromRaw('-w', '--wraps'))) {
      logger.warning(`Node ${node.text} is a wrapped call for symbol ${definitionSymbol.name}`);
      const cmds = extractCommands(node);
      logger.debug(`Extracted commands from wrapped call node: ${cmds}`);
      return cmds.some(cmd => cmd.trim() === definitionSymbol.name);
    }
    return false;
  }

  export function isAnyNestedCommand(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
    return isAliasValueNode(definitionSymbol, node)
      || isBindCall(definitionSymbol, node)
      || isCompleteConditionCall(definitionSymbol, node);
  }
}

/**
 * Checks if a symbol will only include references local to the current document
 *
 * If a symbol is global, or it might be referenced in other documents (i.e., `argparse`)
 * then it is not considered local to the document.
 *
 * @param symbol the symbol to check
 * @return true if the symbol's references can only be local to the document, false otherwise
 */
function isSymbolLocalToDocument(symbol: FishSymbol): boolean {
  if (symbol.isGlobal()) return false;
  if (symbol.isLocal() && symbol.isArgparse()) {
    const parent = symbol.parent;
    // argparse flags that are inside a global function might have completions,
    // so we don't consider them local to the document
    if (parent && parent.isGlobal()) return false;
  }
  if (symbol.document.isAutoloaded()) {
    if (symbol.isFunction() || symbol.hasEventHook()) {
      // functions and event hooks that are autoloaded are considered global
      return false;
    }
    if (symbol.isEvent()) {
      return false; // global event hooks are not local to the document
    }
  }

  // symbols that are not explicitly defined as global, will reach this point
  // thus, we consider them local to the document
  return true;
}

/**
 * Extracts the precise range of a command reference within an alias definition value
 * Only matches commands in command position, not as arguments
 */
function extractCommandRangeFromAliasValue(node: SyntaxNode, commandName: string): Range | null {
  const text = node.text;
  let searchText = text;
  let baseOffset = 0;

  // Handle different alias value formats
  if (text.includes('=')) {
    // Format: name=value
    const equalsIndex = text.indexOf('=');
    searchText = text.substring(equalsIndex + 1);
    baseOffset = equalsIndex + 1;
  }

  // Remove surrounding quotes if present
  if (searchText.startsWith('"') && searchText.endsWith('"') ||
    searchText.startsWith("'") && searchText.endsWith("'")) {
    searchText = searchText.slice(1, -1);
    baseOffset += 1;
  }

  // Find command positions using shell command structure analysis
  const commandMatches = findCommandPositions(searchText, commandName);

  if (commandMatches.length === 0) return null;

  // For now, return the first command match (you could return all if needed)
  const firstMatch = commandMatches[0];
  if (!firstMatch) return null;

  const startOffset = baseOffset + firstMatch.start;
  const endOffset = startOffset + commandName.length;

  return Range.create(
    node.startPosition.row,
    node.startPosition.column + startOffset,
    node.startPosition.row,
    node.startPosition.column + endOffset,
  );
}

/**
 * Finds positions where a command name appears as an actual command (not as an argument)
 */
function findCommandPositions(shellCode: string, commandName: string): Array<{ start: number; end: number; }> {
  const matches: Array<{ start: number; end: number; }> = [];

  // Split by command separators: ; && || & | (pipes and logical operators)
  const commandSeparators = /([;&|]+|\s*&&\s*|\s*\|\|\s*)/;
  const parts = shellCode.split(commandSeparators);

  let currentOffset = 0;

  for (const part of parts) {
    if (!part || commandSeparators.test(part)) {
      // This is a separator, skip it
      currentOffset += part.length;
      continue;
    }

    // Clean up whitespace and find the first word (command)
    const trimmedPart = part.trim();
    const partStartOffset = currentOffset + part.indexOf(trimmedPart);

    if (trimmedPart) {
      // Extract the first word as the command
      const firstWordMatch = trimmedPart.match(/^([^\s]+)/);
      if (firstWordMatch) {
        const firstWord = firstWordMatch[1];
        if (firstWord === commandName) {
          matches.push({
            start: partStartOffset,
            end: partStartOffset + commandName.length,
          });
        }
      }
    }

    currentOffset += part.length;
  }

  return matches;
}
/**
 * Optimized version of getChildNodes that pre-filters by text content
 * This significantly reduces the number of nodes we need to check
 */
function* getChildNodesOptimized(symbol: FishSymbol, doc: LspDocument): Generator<SyntaxNode> {
  const root = analyzer.analyze(doc).root;
  if (!root) return;

  const localSymbols = analyzer.getFlatDocumentSymbols(doc.uri)
    .filter(s => {
      if (s.uri === doc.uri) return false;
      if (s.isFunction() && s.isLocal() && s.name === symbol.name && symbol.isFunction()) {
        return !s.equals(symbol);
      }
      return s.name === symbol.name
        && s.kind === symbol.kind
        && s.isLocal()
        && !symbol.equalDefinition(s);
    });

  const skipNodes = localSymbols.map(s => s.parent?.node).filter(n => n !== undefined) as SyntaxNode[];

  const isPotentialMatch = (current: SyntaxNode) => {
    if (symbol.isArgparse()
      && (isOption(current) || current.text === symbol.name || current.text === symbol.argparseFlagName)
    ) {
      return true;
    } else if (symbol.name === current.text) {
      return true;
    } else if (isString(current)) {
      return true;
    }
    if (symbol.isFunction()) {
      return symbol.name === current.text
        || isCommandName(current)
        || current.type === 'word'
        || current.isNamed;
    }
    return false;
  };

  const queue: SyntaxNode[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (
      skipNodes.some(s =>
        containsNode(s, current) || s.equals(current) && !isProgram(current),
      )) {
      continue;
    }

    if (isPotentialMatch(current)) {
      yield current;
    }
    // Add children to queue for processing
    if (current.children.length > 0) {
      queue.unshift(...current.children);
    }
  }
}
/**
 * Returns a list of documents to search for references based on the options provided.
 *
 * @param document the document to search in
 * @param logCallback the logging callback function
 * @param opts the options for searching references
 * @return an array of documents to search for references
 */
function getDocumentsToSearch(
  document: LspDocument,
  logCallback: ReturnType<typeof logWrapper>,
  opts: ReferenceOptions,
): LspDocument[] {
  let documentsToSearch: LspDocument[] = [];
  if (opts.localOnly) {
    documentsToSearch.push(document);
  } else if (opts.allWorkspaces) {
    workspaceManager.all.forEach((ws: Workspace) => {
      documentsToSearch.push(...ws.allDocuments());
    });
  } else {
    // default to using the current workspace
    let currentWorkspace = workspaceManager.current;
    if (!currentWorkspace) {
      currentWorkspace = workspaceManager.findContainingWorkspace(document.uri) || undefined;
      if (!currentWorkspace) {
        logCallback(`No current workspace found for document ${document.uri}`, 'warning');
        return [document];
      }
    }
    currentWorkspace?.allDocuments().forEach((doc: LspDocument) => {
      documentsToSearch.push(doc);
    });
  }

  // filter out documents that don't match the specified file types
  if (opts.onlyInFiles && opts.onlyInFiles.length > 0) {
    documentsToSearch = documentsToSearch.filter(doc => {
      const fileType = doc.getAutoloadType();
      if (!fileType) return false;
      return opts.onlyInFiles!.includes(fileType);
    });
  }

  return documentsToSearch;
}

/**
 * Callback wrapper function for logging the getReferences function,
 * so that the parent function doesn't have to handle logging directly.
 *
 * Forwards the getReferences(params) to this function.
 *
 * Calls the logger.info/debug/warning/error methods with the request and params.
 */
function logWrapper(
  document: LspDocument,
  position: Position,
  opts: ReferenceOptions,
) {
  const posStr = `{line: ${position.line}, character: ${position.character}}`;
  const requestMsg = `getReferencesNew(params) -> ${new Date().toISOString()}`;
  const params = {
    uri: uriToReadablePath(document.uri),
    position: posStr,
    opts: opts,
  };
  const startTime = performance.now();

  return function(message: string, level: 'info' | 'debug' | 'warning' | 'error' = 'info') {
    if (!opts.loggingEnabled) return; // If logging is disabled
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    const logObj: {
      request: string;
      params: typeof params;
      message: string;
      // duration?: string;
    } = {
      request: requestMsg,
      params,
      message,
      // duration: opts.logPerformance ? `duration: ${duration} seconds` : undefined,
    };

    switch (level) {
      case 'info':
        logger.info(logObj, duration);
        break;
      case 'debug':
        logger.debug(logObj, duration);
        break;
      case 'warning':
        logger.warning(logObj, duration);
        break;
      case 'error':
        logger.error({
          ...logObj,
          message: `Error: ${message}`,
          duration,
        });
        break;
      default:
        logger.warning({
          ...logObj,
          message: `Unknown log level: ${level}. Original message: ${message}`,
          duration,
        });
        break;
    }
    logger.debug(`DURATION: ${duration}`, { uri: uriToReadablePath(document.uri), position: posStr });
  };
}

/**
 * Sorts the references based on their proximity to the definition symbol,
 * Sorting by:
 *   1. Definition Symbol URI (and local references)
 *   2. Go to implementation URI (functions/ <-> completions/)
 *   3. References Grouped by order of URI seen in Workspace Search
 *   4. Position (Top to Bottom, Left to Right)
 */
const locationSorter = (defSymbol: FishSymbol) => {
  const getUriPriority = (defSymbol: FishSymbol) => {
    return (uri: DocumentUri) => {
      let basePriority = 10; // default

      if (defSymbol.isArgparse()) {
        if (uri === defSymbol.uri) basePriority = 100;
        else if (uri.includes('completions/')) basePriority = 50;
      } else if (defSymbol.isFunction()) {
        if (uri === defSymbol.uri) basePriority = 100;
        else if (uri.includes('completions/')) basePriority = 50;
      } else if (defSymbol.isVariable()) {
        if (uri === defSymbol.uri) basePriority = 100;
      }

      // Add a small fraction based on URI string for consistent ordering
      const uriHash = uri.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return basePriority + uriHash % 1000 / 10000; // keeps string order as decimal
    };
  };

  const uriPriority = getUriPriority(defSymbol);

  return function(a: Location, b: Location) {
    const aUriPriority = uriPriority(a.uri);
    const bUriPriority = uriPriority(b.uri);

    if (aUriPriority !== bUriPriority) {
      return bUriPriority - aUriPriority; // higher priority first
    }

    // same URI, sort by position
    if (a.range.start.line !== b.range.start.line) {
      return a.range.start.line - b.range.start.line;
    }
    return a.range.start.character - b.range.start.character;
  };
};

export const getFilteredLocalSymbols = (definitionSymbol: FishSymbol, doc: LspDocument) => {
  if (definitionSymbol.isVariable() && !definitionSymbol.isArgparse()) {
    // if the symbol is a variable, we only want to find references in the current document
    return analyzer.getFlatDocumentSymbols(doc.uri)
      .filter(
        s => s.isLocal()
          && !s.equals(definitionSymbol)
          && !definitionSymbol.equalScopes(s)
          // && !s.parent?.equals(definitionSymbol?.parent || definitionSymbol)
          && s.name === definitionSymbol.name
          && s.kind === definitionSymbol.kind,
      );
  }
  if (doc.uri === definitionSymbol.uri) return [];
  return analyzer.getFlatDocumentSymbols(doc.uri)
    .filter(s =>
      s.isLocal()
        && s.name === definitionSymbol.name
        && s.kind === definitionSymbol.kind
        && !s.equals(definitionSymbol),
    );
};
