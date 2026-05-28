import { DocumentUri, Location, Position, WorkDoneProgressReporter } from 'vscode-languageserver';
import { analyzer } from './analyze';
import { LspDocument } from './document';
import { findParentCommand, findParentFunction, isCommandWithName, isMatchingOption, isOption, isProgram, isString, isVariable, isVariableDefinitionName, isVariableExpansion, isVariableExpansionWithName } from './utils/node-types';
import { getRange, isPositionWithinRange, nodesGen } from './utils/tree-sitter';
import { isNodeExcluded } from './utils/skippable-scopes';
import { filterFirstPerScopeSymbol, FishSymbol } from './parsing/symbol';
import { Option, getLeadingDashCount } from './parsing/options';
import { logger } from './logger';
import { getGlobalArgparseLocations } from './parsing/argparse';
import { SyntaxNode } from 'web-tree-sitter';
import * as Locations from './utils/locations';
import { Workspace } from './utils/workspace';
import { workspaceManager } from './utils/workspace-manager';
import { isAliasDefinitionValue } from './parsing/alias';
import { extractCommandLocations, extractMatchingCommandLocations } from './parsing/nested-strings';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { isSetVariableDefinitionName } from './parsing/set';
import { FishString } from './parsing/string';
import { FishReferenceCandidate, isPotentialReferenceNode } from './parsing/reference-candidates';
import { config } from './config';

// ┌──────────────────────────────────┐
// │ file handles 3 main operations:  │
// │   • getReferences()              │
// │   • allUnusedLocalReferences()   │
// │   • getImplementations()         │
// └──────────────────────────────────┘

type ReferenceOptions = {
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
  // progress reporter for long-running searches
  reporter?: WorkDoneProgressReporter;
};

const DEFAULT_REFERENCE_OPTIONS: ReferenceOptions = {
  excludeDefinition: false,
  localOnly: false,
  firstMatch: false,
  allWorkspaces: false,
  onlyInFiles: [],
};

type ReferenceSearchContext = {
  definitionSymbol: FishSymbol;
  mergedOpts: ReferenceOptions;
  results: Location[];
  searchableDocuments: LspDocument[];
};

const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const locationKey = (loc: Location): string =>
  `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}`;

export function createReferenceSearchContext(
  document: LspDocument,
  position: Position,
  opts: ReferenceOptions,
): ReferenceSearchContext | null {
  const mergedOpts: ReferenceOptions = { ...DEFAULT_REFERENCE_OPTIONS, ...opts };
  const definitionSymbol = analyzer.getDefinition(document, position);
  if (!definitionSymbol) return null;

  const results: Location[] = [];
  if (!mergedOpts.excludeDefinition) results.push(definitionSymbol.toLocation());
  if (isSymbolLocalToDocument(definitionSymbol)) mergedOpts.localOnly = true;

  if (definitionSymbol.isArgparse() || definitionSymbol.isFunction()) {
    results.push(...getGlobalArgparseLocations(definitionSymbol.document, definitionSymbol));
  }
  if (definitionSymbol.isFunction() && definitionSymbol.hasEventHook() && definitionSymbol.document.isAutoloaded()) {
    results.push(
      ...analyzer.symbols.eventsByName.find(definitionSymbol.name)
        .filter(s => s.isEmittedEvent())
        .map(s => s.toLocation()),
    );
  }

  return {
    definitionSymbol,
    mergedOpts,
    results,
    searchableDocuments: getDocumentsToSearch(document, mergedOpts),
  };
}

function collectMatchingReferenceNodesInDocument(
  definitionSymbol: FishSymbol,
  doc: LspDocument,
): SyntaxNode[] {
  const filteredSymbols = getFilteredLocalSymbols(definitionSymbol, doc);
  const matchingNodes: SyntaxNode[] = [];
  for (const node of iterCandidatesForSymbol(definitionSymbol, doc)) {
    if (filteredSymbols?.some(s => s.containsNode(node) || s.scopeNode.equals(node) || s.scopeContainsNode(node))) {
      continue;
    }
    if (definitionSymbol.isReference(doc, node, true)) {
      matchingNodes.push(node);
    }
  }
  return matchingNodes;
}

function processDocumentForReferences(
  results: Location[],
  definitionSymbol: FishSymbol,
  doc: LspDocument,
  mergedOpts: ReferenceOptions,
): boolean {
  const nodes = collectMatchingReferenceNodesInDocument(definitionSymbol, doc);
  if (nodes.length === 0) return false;
  const seen = new Set(results.map(locationKey));
  if (mergedOpts.excludeDefinition) seen.add(locationKey(definitionSymbol.toLocation()));
  for (const node of nodes) {
    for (const loc of getLocationWrapper(definitionSymbol, node, doc.uri)) {
      const key = locationKey(loc);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(loc);
      }
    }
  }
  return true;
}

function reportSearchProgress(reporter: WorkDoneProgressReporter | undefined, total: number, index: number): void {
  if (reporter && total > 1) {
    reporter.report(Math.ceil((index + 1) / total * 100), `Searching ${index + 1}/${total} documents`);
  }
}

export function getReferences(
  document: LspDocument,
  position: Position,
  opts: ReferenceOptions = DEFAULT_REFERENCE_OPTIONS,
): Location[] {
  const context = createReferenceSearchContext(document, position, opts);
  if (!context) return getPrebuiltVariableReferences(document, position, opts.reporter);
  const { definitionSymbol, mergedOpts, results, searchableDocuments } = context;
  for (let index = 0; index < searchableDocuments.length; index++) {
    reportSearchProgress(mergedOpts.reporter, searchableDocuments.length, index);
    const foundNodes = processDocumentForReferences(results, definitionSymbol, searchableDocuments[index]!, mergedOpts);
    if (mergedOpts.firstMatch && foundNodes) break;
  }
  return results.sort(FishReferenceCandidate.comparatorForSymbol(definitionSymbol));
}

export async function getIncrementalReferences(
  document: LspDocument,
  position: Position,
  opts: ReferenceOptions = {},
): Promise<Location[]> {
  const context = createReferenceSearchContext(document, position, opts);
  if (!context) return getPrebuiltVariableReferencesIncremental(document, position, opts.reporter);
  const { definitionSymbol, mergedOpts, results, searchableDocuments } = context;
  for (let index = 0; index < searchableDocuments.length; index++) {
    reportSearchProgress(mergedOpts.reporter, searchableDocuments.length, index);
    if (mergedOpts.reporter && ((index + 1) % 25 === 0 || index === 0)) {
      await yieldToEventLoop();
    }
    const foundNodes = processDocumentForReferences(results, definitionSymbol, searchableDocuments[index]!, mergedOpts);
    if (mergedOpts.firstMatch && foundNodes) break;
  }
  return results.sort(FishReferenceCandidate.comparatorForSymbol(definitionSymbol));
}

function isUsedViaNoScopeShadowingRoot(symbol: FishSymbol): boolean {
  if (!symbol.isVariable() || !symbol.parent?.isFunctionWithNoScopeShadowing()) {
    return false;
  }
  const rootSymbol = analyzer.resolveNoScopeShadowingDefinition(symbol);
  const rootRefs = getReferences(
    rootSymbol.document,
    rootSymbol.selectionRange.start,
    { firstMatch: true },
  );
  return rootRefs.some(loc =>
    loc.uri !== rootSymbol.uri || !Locations.Location.equals(loc, rootSymbol.toLocation()),
  );
}

export function allUnusedLocalReferences(document: LspDocument): FishSymbol[] {
  const symbols = filterFirstPerScopeSymbol(document).filter(s =>
    s.isLocal()
    && (s.needsLocalReferences() || s.isEmittedEvent())
    && !s.isEventHook()
    && !s.isExported(),
  );
  const usedSymbols: FishSymbol[] = [];
  const unusedSymbols: FishSymbol[] = [];

  for (const symbol of symbols) {
    const localSymbols = getFilteredLocalSymbols(symbol, document);
    let found = false;
    for (const node of iterCandidatesForSymbol(symbol, document)) {
      // isPotentialReferenceNode is stricter than the cache's broad indexing —
      // rejects e.g. `bar` in `set foo bar` from being treated as a ref to `bar`
      if (!isPotentialReferenceNode(symbol, node)) continue;
      if (localSymbols?.some(c => c.scopeContainsNode(node))) continue;
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
    if (isUsedViaNoScopeShadowingRoot(symbol)) {
      return false;
    }
    if (symbol.isArgparse() && usedSymbols.some(s => s.equalArgparse(symbol))) {
      return false;
    }
    // A local variable is "used" if a command in its scope calls a
    // --no-scope-shadowing function that references the same variable name
    if (symbol.isVariable() && analyzer.symbols.noScopeShadowing.allSymbols.length > 0) {
      const scopeNode = symbol.scope.scopeNode;
      if (scopeNode) {
        // Find --no-scope-shadowing functions that use this variable name
        // (either as a child symbol or as a $var expansion in their body)
        const noScopeFuncs = analyzer.symbols.noScopeShadowing.allSymbols.filter(f => {
          if (!analyzer.isFunctionVisibleFrom(f, symbol.parent, symbol.uri)) return false;
          // Check child symbols (set var ...)
          if (f.children.some(c => c.isVariable() && c.name === symbol.name)) return true;
          // Check for $var expansions in the function body
          for (const n of nodesGen(f.scopeNode)) {
            if (isVariableExpansionWithName(n, symbol.name)) return true;
          }
          return false;
        });
        if (noScopeFuncs.length > 0) {
          for (const n of nodesGen(scopeNode)) {
            if (isCommandWithName(n, ...noScopeFuncs.map(f => f.name))) {
              return false;
            }
          }
        }
      }
    }
    // A local variable is "used" if a command in its scope calls a function
    // that inherits this variable via --inherit-variable
    if (symbol.isVariable() && analyzer.symbols.inheritedVariables.has(symbol.name)) {
      const inheritingFuncs = analyzer.getCallableInheritingFunctions(symbol.name, symbol.parent, symbol.uri);
      const scopeNode = symbol.scope.scopeNode;
      if (scopeNode) {
        for (const n of nodesGen(scopeNode)) {
          if (isCommandWithName(n, ...inheritingFuncs.map(f => f.name))) {
            return false;
          }
        }
      }
    }
    if (symbol.hasEventHook()) {
      if (symbol.isGlobal()) return false;
      if (
        symbol.isLocal()
        && symbol.children.some(c => c.fishKind === 'FUNCTION_EVENT' && usedSymbols.some(s => s.isEmittedEvent() && c.name === s.name))
      ) {
        return false;
      }
      // A locally-scoped function might still be globally invoked via an emitted event in another doc
      if (symbol.document.isAutoloaded() && symbol.isFunction()) {
        for (const event of symbol.children.filter(c => c.isEventHook())) {
          if (analyzer.symbols.eventsByName.find(event.name).some(m => m.isEmittedEvent())) {
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

// bi-directional jump between definition and completion
export function getImplementation(
  document: LspDocument,
  position: Position,
  opts: Pick<ReferenceOptions, 'reporter'> = {},
): Location[] {
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return [];
  const symbol = analyzer.getDefinition(document, position);
  if (!symbol) return [];

  const notAtCursor = (loc: Location) =>
    loc.uri !== document.uri || !isPositionWithinRange(position, loc.range);
  const prefersMovingCursor = (locations: Location[]): Location[] => {
    const moving = locations.filter(notAtCursor);
    if (moving.length > 0) return moving;
    const fallback = getReferences(document, position, { reporter: opts.reporter }).filter(notAtCursor);
    return fallback.length > 0 ? fallback : locations;
  };

  // Event symbols jump bidirectionally between emit site and hook
  if (symbol.isEmittedEvent() || symbol.isEventHook()) {
    const matchOther = symbol.isEmittedEvent()
      ? (m: FishSymbol) => m.isEventHook()
      : (m: FishSymbol) => m.isEmittedEvent();
    const result = analyzer.symbols.eventsByName.find(symbol.name).find(matchOther)?.toLocation();
    if (result) return prefersMovingCursor([result]);
  }

  // --no-scope-shadowing function: jump to the caller site (any ref that isn't the definition)
  if (symbol.isFunction() && symbol.isFunctionWithNoScopeShadowing()) {
    const def = symbol.selectionRange.start;
    const callSites = getReferences(document, position, { localOnly: true, reporter: opts.reporter })
      .filter(loc => loc.range.start.line !== def.line || loc.range.start.character !== def.character);
    if (callSites.length > 0) return prefersMovingCursor(callSites);
  }

  // --no-scope-shadowing: bidirectional jump between caller's variable and callee's usage
  if (symbol.isVariable()) {
    const enclosingFunc = findParentFunction(node);
    const enclosingFuncName = enclosingFunc?.childForFieldName('name')?.text;

    // From $var in a --no-scope-shadowing function → jump to caller's definition
    if (enclosingFuncName && analyzer.symbols.noScopeShadowing.has(enclosingFuncName)) {
      const enclosingFuncSymbol = analyzer.getEnclosingFunctionSymbol(document.uri, node);
      if (!enclosingFuncSymbol || analyzer.isFunctionVisibleFrom(enclosingFuncSymbol, symbol.parent, document.uri)) {
        const callerDef = analyzer.getDefinition(document, position);
        if (callerDef && callerDef.parent?.name !== enclosingFuncName) {
          return prefersMovingCursor([callerDef.toLocation()]);
        }
      }
    }

    // From var in a regular function → jump to usage in --no-scope-shadowing callee
    if (symbol.parent?.isFunction() && !symbol.parent.isFunctionWithNoScopeShadowing()) {
      const allRefs = getReferences(document, position, { reporter: opts.reporter });
      const calleeRefs = allRefs.filter(loc => {
        if (loc.uri !== document.uri) return false;
        const refNode = analyzer.nodeAtPoint(loc.uri, loc.range.start.line, loc.range.start.character);
        if (!refNode) return false;
        const refFunc = findParentFunction(refNode);
        const refFuncName = refFunc?.childForFieldName('name')?.text;
        const refFuncSymbol = refFunc ? analyzer.getEnclosingFunctionSymbol(loc.uri, refNode) : null;
        return !!(
          refFuncName
          && refFuncName !== symbol.parent?.name
          && refFuncSymbol?.isFunctionWithNoScopeShadowing()
          && analyzer.isFunctionVisibleFrom(refFuncSymbol, symbol.parent, loc.uri)
        );
      });
      if (calleeRefs.length > 0) {
        return prefersMovingCursor(calleeRefs);
      }
    }
  }

  const newLocations = getReferences(document, position, {
    reporter: opts.reporter,
    allWorkspaces: !config.fish_lsp_single_workspace_support,
  }).filter(location => location.uri !== document.uri);

  if (newLocations.some(s => s.uri === symbol.uri)) {
    return prefersMovingCursor([symbol.toLocation()]);
  }
  if (newLocations.some(s => s.uri.includes('completions/'))) {
    return prefersMovingCursor([newLocations.find(s => s.uri.includes('completions/'))!]);
  }
  return prefersMovingCursor([symbol.toLocation()]);
}

// Resolves a node to one or more Location ranges, narrowing the range when tree-sitter
// tokenizes multiple references together (e.g. `argparse h/help` returns 'h' or 'help'
// individually, and `alias`/`bind`/`complete -n` extract the command within the string).
function getLocationWrapper(symbol: FishSymbol, node: SyntaxNode, uri: DocumentUri): Location[] {
  if (symbol.fishKind === 'ARGPARSE' && isOption(node)) {
    const range = getRange(node);
    range.start.character += getLeadingDashCount(node.text);
    range.end.character += 1;
    return [Location.create(uri, range)];
  }
  if (isAliasDefinitionValue(node) || isBindCall(symbol, node) || isCompleteConditionCall(symbol, node)) {
    return extractMatchingCommandLocations(symbol, node, uri);
  }
  if (symbol.isFunction() && (isString(node) || isOption(node))) {
    return extractCommandLocations(node, uri)
      .filter(loc => loc.command === symbol.name)
      .map(loc => loc.location);
  }
  return [Location.create(uri, getRange(node))];
}

function isBindCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
  if (!node?.parent || isOption(node)) return false;
  const parent = findParentCommand(node);
  if (!parent || !isCommandWithName(parent, 'bind')) return false;
  const subcommands = parent.children.slice(2).filter(c => !isOption(c));
  if (!subcommands.some(c => c.equals(node))) return false;
  return FishString.extractCommands(node).some(cmd => cmd === definitionSymbol.name);
}

function isCompleteConditionCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
  if (isOption(node) || !node.isNamed || isProgram(node)) return false;
  if (!node.parent || !isCommandWithName(node.parent, 'complete')) return false;
  if (!node.previousSibling || !isMatchingOption(node.previousSibling, Option.fromRaw('-n', '--condition'))) return false;
  return FishString.extractCommands(node).some(cmd => cmd.trim() === definitionSymbol.name);
}

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

  // variables inside --no-scope-shadowing functions can be referenced cross-file
  if (symbol.isVariable() && symbol.parent?.isFunctionWithNoScopeShadowing()) {
    return false;
  }

  // variables in a regular function that calls a --no-scope-shadowing function
  // using the same variable name can be referenced cross-file
  if (symbol.isVariable() && symbol.parent?.isFunction() && !symbol.parent.isFunctionWithNoScopeShadowing()) {
    if (analyzer.symbols.noScopeShadowing.allSymbols.some(f =>
      analyzer.isFunctionVisibleFrom(f, symbol.parent, symbol.uri)
      && f.children.some(c => c.isVariable() && c.name === symbol.name)
      && [...nodesGen(symbol.parent!.scopeNode)].some(n => isCommandWithName(n, f.name)),
    )) {
      return false;
    }
  }

  // --inherit-variable symbols reference the caller's variable, so they're cross-file
  if (symbol.isInheritVariable()) {
    return false;
  }

  // variables that are inherited by another function via --inherit-variable
  // can be referenced cross-file (the caller's variable is shared with the callee)
  // Only escape if the symbol's parent function actually calls a function that
  // inherits this variable — avoids false-positive cross-file search for common names
  if (symbol.isVariable() && analyzer.symbols.inheritedVariables.has(symbol.name)) {
    const inheritingFuncs = analyzer.getCallableInheritingFunctions(symbol.name, symbol.parent, symbol.uri);
    const parentFunc = symbol.parent;
    if (parentFunc?.isFunction() && parentFunc.scopeNode) {
      const callsInheritor = inheritingFuncs.some(f =>
        [...nodesGen(parentFunc.scopeNode)].some(n => isCommandWithName(n, f.name)),
      );
      if (callsInheritor) return false;
    }
  }

  // symbols that are not explicitly defined as global, will reach this point
  // thus, we consider them local to the document
  return true;
}

// Yields name-matched candidate nodes for `symbol` from the per-document cache,
// handling argparse alias names (`_flag_help` ↔ `help` ↔ `--help`) internally.
// Callers apply additional semantic checks (isReference / isPotentialReferenceNode).
function* iterCandidatesForSymbol(symbol: FishSymbol, doc: LspDocument): Generator<SyntaxNode> {
  const root = analyzer.getRootNode(doc.uri);
  if (!root) return;
  analyzer.referenceCandidates.ensureDocument(doc, root);
  for (const candidate of analyzer.referenceCandidates.findInDocumentForSymbol(doc.uri, symbol)) {
    yield candidate.node;
  }
}

function getDocumentsToSearch(
  document: LspDocument,
  opts: ReferenceOptions,
): LspDocument[] {
  let documentsToSearch: LspDocument[] = [];
  if (opts.localOnly) {
    documentsToSearch.push(document);
  } else if (opts.allWorkspaces) {
    workspaceManager.all.forEach((ws: Workspace) => {
      if (!config.fish_lsp_single_workspace_support && ws.contains(document.uri)) {
        return;
      }
      documentsToSearch.push(...ws.allDocuments());
    });
  } else {
    const currentWorkspace = workspaceManager.findContainingWorkspace(document.uri)
      || workspaceManager.current;
    if (!currentWorkspace) {
      logger.warning(`No workspace found for document ${document.uri}`);
      return [document];
    }
    documentsToSearch.push(...currentWorkspace.allDocuments());
  }

  if (opts.onlyInFiles && opts.onlyInFiles.length > 0) {
    documentsToSearch = documentsToSearch.filter(doc => {
      const fileType = doc.getAutoloadType();
      return fileType ? opts.onlyInFiles!.includes(fileType) : false;
    });
  }

  return documentsToSearch;
}

function collectPrebuiltVariableReferenceLocations(
  doc: LspDocument,
  varName: string,
): Location[] {
  const root = analyzer.getRootNode(doc.uri);
  if (!root) return [];

  analyzer.referenceCandidates.ensureDocument(doc, root);
  const scopeSpans = analyzer.getScopeSpans(doc, varName);
  const candidates = analyzer.referenceCandidates.findInDocument(doc.uri, varName);
  const locations: Location[] = [];

  for (const { node } of candidates) {
    // skip nodes inside local redefinitions, but allow self-referencing
    // expansions (e.g. $PATH in `set -lx PATH $PATH:/opt/bin`) since those
    // read the pre-existing global value before the local is created
    if (scopeSpans.length > 0 && isNodeExcluded(node, scopeSpans)) {
      continue;
    }
    if (isVariableExpansionWithName(node, varName)) {
      const focusedNode = node.firstNamedChild;
      if (!focusedNode || focusedNode.text !== varName) {
        continue;
      }
      locations.push(Location.create(doc.uri, getRange(focusedNode)));
    } else if (isVariableDefinitionName(node) && node.text === varName) {
      locations.push(Location.create(doc.uri, getRange(node)));
    } else if (!isVariableDefinitionName(node) && isSetVariableDefinitionName(node, false) && node.text === varName) {
      locations.push(Location.create(doc.uri, getRange(node)));
    }
  }

  return locations;
}

export function getPrebuiltVariableReferences(
  document: LspDocument,
  position: Position,
  reporter?: WorkDoneProgressReporter,
): Location[] {
  const context = getPrebuiltVariableReferenceContext(document, position);
  if (!context) return [];
  const { varName, documentsToSearch } = context;
  const results: Location[] = [];
  for (let index = 0; index < documentsToSearch.length; index++) {
    reportSearchProgress(reporter, documentsToSearch.length, index);
    results.push(...collectPrebuiltVariableReferenceLocations(documentsToSearch[index]!, varName));
  }
  return results;
}

async function getPrebuiltVariableReferencesIncremental(
  document: LspDocument,
  position: Position,
  reporter?: WorkDoneProgressReporter,
): Promise<Location[]> {
  const context = getPrebuiltVariableReferenceContext(document, position);
  if (!context) return [];
  const { varName, documentsToSearch } = context;
  const results: Location[] = [];
  if (reporter) {
    reporter.report(0, `Searching 0/${documentsToSearch.length} documents`);
    await yieldToEventLoop();
  }
  for (let index = 0; index < documentsToSearch.length; index++) {
    reportSearchProgress(reporter, documentsToSearch.length, index);
    if (reporter && ((index + 1) % 25 === 0 || index === 0)) await yieldToEventLoop();
    results.push(...collectPrebuiltVariableReferenceLocations(documentsToSearch[index]!, varName));
  }
  return results;
}

function getPrebuiltVariableReferenceContext(
  document: LspDocument,
  position: Position,
) {
  const node = analyzer.nodeAtPoint(document.uri, position.line, position.character);
  if (!node) return null;

  const varName = isVariableExpansion(node) ? node.text.slice(1)
    : isVariableDefinitionName(node) || isSetVariableDefinitionName(node, false) ? node.text
      : isVariable(node) && node.type === 'variable_name' ? node.text
        : null;
  if (!varName) return null;

  const prebuilt = PrebuiltDocumentationMap.getByName('$' + varName) || PrebuiltDocumentationMap.getByName(varName);
  if (!prebuilt) return null;

  const currentWorkspace = workspaceManager.findContainingWorkspace(document.uri) || workspaceManager.current;
  if (!currentWorkspace) return null;

  return {
    varName,
    documentsToSearch: currentWorkspace.allDocuments(),
  };
}
export function isPrebuiltVariableReference(
  document: LspDocument,
  position: Position,
): boolean {
  return getPrebuiltVariableReferenceContext(document, position) !== null;
}

function getFilteredLocalSymbols(definitionSymbol: FishSymbol, doc: LspDocument) {
  if (definitionSymbol.isVariable() && !definitionSymbol.isArgparse()) {
    // if the symbol is a variable, we only want to find references in the current document
    return analyzer.symbols.findDocumentVariables(doc.uri, definitionSymbol.name)
      .filter(
        s => s.isLocal()
          && !s.equals(definitionSymbol)
          && !definitionSymbol.equalScopes(s)
          && s.name === definitionSymbol.name
          && s.kind === definitionSymbol.kind
          // variables inside --no-scope-shadowing functions don't shadow
          // the caller's variables — they share the same scope
          && !s.parent?.isFunctionWithNoScopeShadowing()
          // --inherit-variable declarations don't shadow — they inherit
          && !s.isInheritVariable(),
      );
  }
  if (doc.uri === definitionSymbol.uri) return [];
  return analyzer.symbols.findDocumentNamedSymbols(doc.uri, definitionSymbol.name)
    .filter(s =>
      s.isLocal()
      && s.kind === definitionSymbol.kind
      && !s.equals(definitionSymbol),
    );
}
