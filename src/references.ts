import { DocumentUri, Location, Position, Range } from 'vscode-languageserver';
import { analyzer } from './analyze';
import { LspDocument } from './document';
import { findParentCommand, findParentFunction, isCommandWithName, isCompleteCommandName, isFunctionDefinition, isMatchingOption, isOption, isString } from './utils/node-types';
import { getRange } from './utils/tree-sitter';
import { FishSymbol } from './parsing/symbol';
import { isCompletionCommandDefinition } from './parsing/complete';
import { isMatchingOptionOrOptionValue, Option } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations, isCompletionArgparseFlagWithCommandName } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';
import * as Locations from './utils/locations';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { uriToReadablePath } from './utils/translation';
import { FishAlias, isAliasDefinitionValue } from './parsing/alias';
import { extractCommands, extractMatchingCommandLocations } from './parsing/nested-strings';

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
    logPerformance: false,
  },
): Location[] {
  const results: Location[] = [];
  const logCallback = logWrapper(document, position, opts);

  const definitionSymbol = analyzer.getDefinition(document, position);
  if (!definitionSymbol) {
    logCallback(
      `No definition symbol found for position ${JSON.stringify(position)} in document ${document.uri}`,
      'warning'
    );
    return [];
  }

  // include the definition symbol itself
  if (!opts.excludeDefinition) results.push(definitionSymbol.toLocation());

  // if the symbol is local, we only search in the current document 
  if (isSymbolLocalToDocument(definitionSymbol)) opts.localOnly = true; 

  // create a list of al documents we will search for references
  let documentsToSearch: LspDocument[] = [];

  // get all the documents to search based on the options
  if (opts.localOnly) {
    documentsToSearch.push(document);
  } else if (opts.allWorkspaces) {
    // search in all workspaces
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
        return [];
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

  if (definitionSymbol.fishKind === 'ARGPARSE') {
    results.push(...getGlobalArgparseLocations(analyzer, document, definitionSymbol));
  }

  const callbackfn = definitionSymbol.fishKind === 'ARGPARSE'
    ? isArgparseMatchCallback(definitionSymbol)
    : isCommandMatchCallback(definitionSymbol);

  const searchableDocuments = new Set<string>(documentsToSearch.map(doc => doc.uri));

  const matchingNodes: { [document: DocumentUri]: SyntaxNode[]; } = {};

  // boolean to control stopping our search when opts.firstMatch is true
  let shouldExitEarly = false;

  // now search
  for (const { document, nodes } of analyzer.findNodesGen()) {
    if (!searchableDocuments.has(document.uri)) continue;

    for (const node of nodes) {
      if (callbackfn(document, node)) {
        let currentDocumentsNodes = matchingNodes[document.uri] ?? [];
        currentDocumentsNodes.push(node);
        matchingNodes[document.uri] = currentDocumentsNodes;
        if (opts.firstMatch) {
          shouldExitEarly = true; // stop searching after the first match
          break;
        }
      }
    }
    if (shouldExitEarly) break;
  }
  // for (const documentUri of Array.from(searchableDocuments)) {
  //   const document = analyzer.getDocument(documentUri);
  //   if (!document) {
  //     logCallback(`Document not found for URI: ${documentUri}`, 'warning');
  //     continue;
  //   }
  //   for (const node of analyzer.getNodes(documentUri)) {
  //     if (callbackfn(document, node)) {
  //       let currentDocumentsNodes = matchingNodes[documentUri] ?? [];
  //       currentDocumentsNodes.push(node);
  //       matchingNodes[documentUri] = currentDocumentsNodes;
  //       if (opts.firstMatch) {
  //         shouldExitEarly = true; // stop searching after the first match
  //         break;
  //       }
  //     }
  //   }
  //   if (shouldExitEarly) break;
  // }

  // now convert the matching nodes to locations
  for (const [uri, nodes] of Object.entries(matchingNodes)) {
    for (const node of nodes) {
      const locations = getLocationWrapper(definitionSymbol, node, uri)
        .filter(loc => !results.some(location => Locations.Location.equals(loc, location)));
      results.push(...locations);
    }
  }

  logCallback(`Found ${results.length} references for symbol '${definitionSymbol.name}' in document '${workspaceManager.current?.name}/${document.getRelativeFilenameToWorkspace()}'`);

  return results;
}

function isArgparseMatchCallback(definitionSymbol: FishSymbol) {
  const parentName = definitionSymbol.parent?.name
    || definitionSymbol.scopeNode.firstNamedChild?.text
    || definitionSymbol.scopeNode.text;


  return function (searchDocument: LspDocument, node: SyntaxNode): boolean {
    if (isCompletionArgparseFlagWithCommandName(node, parentName, definitionSymbol.argparseFlagName)) {
      return true;
    }
    // parentName --flag-name
    if (
      node.parent
      && isCommandWithName(node.parent, parentName)
      && isOption(node)
      && isMatchingOption(node, Option.fromRaw(definitionSymbol?.argparseFlag))
    ) {
      return true;
    }
    // _flag_name in scope
    if (
      searchDocument.uri === definitionSymbol.uri
      && definitionSymbol.scopeContainsNode(node)
      && node.text === definitionSymbol.name
    ) {
      return true;
    }
    return false;
  };
}

/**
 * Returns a callback function that checks if a node matches the definition symbol
 * This is used to filter nodes when searching for references
 * @param definitionSymbol the symbol to match against
 */
function isCommandMatchCallback(definitionSymbol: FishSymbol) {
  function compareNodeToSymbolBasedOnType(searchDocument: LspDocument, node: SyntaxNode): boolean {
      // remove `complete ... -s opt -l opt` entries for variables
      if (definitionSymbol.isVariable() && node.parent) {
        const isCompletion = isCompletionCommandDefinition(node.parent);
        if (isCompletion) return false;
      }
      if (definitionSymbol.isFunction()) {
        // remove `complete ... -l cmdname` entries, keep `complete -c cmdname` for functions
        if (isCompleteCommandName(node)) {
          return node.text === definitionSymbol.name && !definitionSymbol.focusedNode.equals(node);
          // keep `complete ... -n 'cmdname'` entries for functions
        } else if (NestedSyntaxNodeWithReferences.isCompleteConditionCall(definitionSymbol, node)) {
          return true;
        } else if (definitionSymbol.isFunction() && node.parent && isCommandWithName(node.parent, 'complete')) {
          return false;
        }
        // keep `alias ...='cmdname'` entries for functions
        if (NestedSyntaxNodeWithReferences.isAliasValueNode(definitionSymbol, node)) {
          return true;
        }
        // keep `bind ... cmdname` entries for functions
        if (NestedSyntaxNodeWithReferences.isBindCall(definitionSymbol, node)) {
          return true;
        }
        // function ... --wraps='cmdname'
        if (NestedSyntaxNodeWithReferences.isWrappedCall(definitionSymbol, node)) {
          return true;
        }
        if (node.parent && !isCommandWithName(node.parent, definitionSymbol.name) && node.parent.firstChild?.equals(node)) {
          return false;
        }
      }
      return node.text === definitionSymbol.name && !definitionSymbol.focusedNode.equals(node);
  }


  return function (searchDocument: LspDocument, node: SyntaxNode): boolean {
    // skip all `command some_func` as references for functions
    if (definitionSymbol.isFunction() && node.parent && isCommandWithName(node.parent, 'command')) {
      return false;
    }
    // check if the node is a local symbol
    if (definitionSymbol.isLocal() && searchDocument.uri === definitionSymbol.uri) {
      return definitionSymbol.scopeContainsNode(node) &&
        !definitionSymbol.focusedNode.equals(node) &&
        compareNodeToSymbolBasedOnType(searchDocument, node);
    }
    if (definitionSymbol.isGlobal()) {
      // get all the local symbols for the current document, and remove any node that is redefined in the local scope
      const localSymbols = analyzer.cache.getFlatDocumentSymbols(searchDocument.uri)
        .filter(s => s.name === definitionSymbol.name && s.isLocal());
      if (localSymbols.length > 0 && localSymbols.some(s => s.scopeContainsNode(node))) {
        return false;
      }
      return compareNodeToSymbolBasedOnType(searchDocument, node);
    }
    return false;
  };
}

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
  return [Location.create(uri, range)];
}

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
    if (isOption(node) || !node.isNamed) return false; // skip options
    logger.info({
      msg: `Checking if node is a complete condition call for symbol ${definitionSymbol.name}`,
      node: {
        type: node.type,
        text: node.text,
      },
      parent: {
        type: node.parent?.type,
        text: node.parent?.text,
      }
    })
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
    return NestedSyntaxNodeWithReferences.isAliasValueNode(definitionSymbol, node)
      || NestedSyntaxNodeWithReferences.isBindCall(definitionSymbol, node)
      || NestedSyntaxNodeWithReferences.isCompleteConditionCall(definitionSymbol, node);
  }
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

  // all references to the symbol, excluding the definition itself
  const newLocations = getReferences(document, position, { excludeDefinition: true })
    .map(location => ({
      uri: location.uri,
      range: location.range,
      node: analyzer.nodeAtPoint(location.uri, location.range.start.line, location.range.start.character),
    }));

  const commandNode = analyzer.commandAtPoint(document.uri, position.line, position.character);

  // if the current node is a function definition at a completion command
  // return its definition location
  if (symbol.isFunction() && commandNode && isCommandWithName(commandNode, 'complete')) {
    return [symbol.toLocation()];
  }

  // if the current node is a function definition not at its completion command
  // return its completion location
  if (symbol.isFunction()) {
    const completionLocation = newLocations.find(s => {
      const parent = analyzer.commandAtPoint(s.uri, s.range.start.line, s.range.start.character);
      if (parent && isCommandWithName(parent, 'complete')) {
        return true
      }
      return false;
    })
    if (completionLocation) {
      return [Location.create(completionLocation.uri, completionLocation.range)]
    }
  }

  if (symbol.fishKind === 'ARGPARSE') {

  }

  // jump to the next reference
  if (symbol.isVariable()) {
    newLocations.unshift({...symbol.toLocation(), node: symbol.focusedNode});
    const currentIndex = newLocations.findIndex(s => s.node && s.node.equals(node));
    const nextIndex = (currentIndex + 1) % newLocations.length;
    const nextLocation = newLocations[nextIndex];
    if (!nextLocation) {
      return [symbol.toLocation()];
    }
    return [Location.create(nextLocation.uri, nextLocation.range)];
  }
  locations.unshift(symbol.toLocation())
  locations.push(...newLocations.map(s => Location.create(s.uri, s.range)));
  return locations;
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
function isSymbolLocalToDocument(symbol: FishSymbol) : boolean {
  if (symbol.isGlobal()) return false;
  if (symbol.isLocal() && symbol.fishKind === 'ARGPARSE') {
    const parent = symbol.parent;
    // argparse flags that are inside a global function might have completions,
    // so we don't consider them local to the document
    if (parent && parent.isGlobal()) return false;
  }
  // symbols that are not explicitly defined as global, will reach this point
  // thus, we consider them local to the document
  return true;
}
   


/**
 * Extracts the precise range of a command reference within an alias definition value
 */
// function extractCommandRangeFromAliasValue(node: SyntaxNode, commandName: string): Range | null {
//   const text = node.text;
//   let searchText = text;
//   let baseOffset = 0;
//   
//   // Handle different alias value formats
//   if (text.includes('=')) {
//     // Format: name=value
//     const equalsIndex = text.indexOf('=');
//     searchText = text.substring(equalsIndex + 1);
//     baseOffset = equalsIndex + 1;
//   }
//   
//   // Remove surrounding quotes if present
//   if ((searchText.startsWith('"') && searchText.endsWith('"')) || 
//       (searchText.startsWith("'") && searchText.endsWith("'"))) {
//     searchText = searchText.slice(1, -1);
//     baseOffset += 1;
//   }
//   
//   // Find the command using word boundaries to avoid partial matches
//   const regex = new RegExp(`\\b${escapeRegexChars(commandName)}\\b`);
//   const match = regex.exec(searchText);
//   
//   if (!match) return null;
//   
//   // Calculate the precise range within the original node
//   const startOffset = baseOffset + match.index;
//   const endOffset = startOffset + commandName.length;
//   
//   return Range.create(
//     node.startPosition.row,
//     node.startPosition.column + startOffset,
//     node.startPosition.row,
//     node.startPosition.column + endOffset
//   );
// }

/**
 * Escapes special regex characters in a string
 */
// function escapeRegexChars(str: string): string {
//   return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// }
//

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
  if ((searchText.startsWith('"') && searchText.endsWith('"')) ||
    (searchText.startsWith("'") && searchText.endsWith("'"))) {
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
    node.startPosition.column + endOffset
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
            end: partStartOffset + commandName.length
          });
        }
      }
    }

    currentOffset += part.length;
  }

  return matches;
}

function logWrapper(
  document: LspDocument,
  position: Position,
  opts: ReferenceOptions = {
    excludeDefinition: false,
    localOnly: false,
    firstMatch: false,
    allWorkspaces: false,
    onlyInFiles: [],
    logPerformance: false,
  },
) {
  const posStr = `{line: ${position.line}, character: ${position.character}}`;
  const requestMsg = `getReferencesNew(params) -> ${new Date().toISOString()}`;
  const params = {
    uri: uriToReadablePath(document.uri),
    position: posStr,
    opts: opts,
  };
  const startTime = performance.now();

  return function (message: string, level: 'info' | 'debug' | 'warning' | 'error' = 'info') {
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2); // Convert to seconds with 2 decimal places
    const logObj: {
      request: string;
      params: typeof params;
      message: string;
      duration?: string;
    } = {
      request: requestMsg,
      params,
      message,
      duration: undefined,
    };

    if (opts.logPerformance) {
      logObj.duration = `total duration ${duration} ms`;
    }

    switch (level) {
      case 'info':
        logger.info(logObj);
        break;
      case 'debug':
        logger.debug(logObj);
        break;
      case 'warning':
        logger.warning(logObj);
        break;
      case 'error':
        logger.error({
          ...logObj,
          message: `Error: ${message}`,
        });
        break;
      default:
        logger.warning({
          ...logObj,
          message: `Unknown log level: ${level}. Original message: ${message}`,
        });
        break;
    }
  };
}
