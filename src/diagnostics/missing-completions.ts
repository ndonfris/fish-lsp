import { Diagnostic, Location } from 'vscode-languageserver';
import { analyzer } from '../analyze';
import { LspDocument } from '../document';
import { logger } from '../logger';
import { FishSymbol } from '../parsing/symbol';
import { getRange } from '../utils/tree-sitter';
import { CompletionSymbol, getGroupedCompletionSymbolsAsArgparse, groupCompletionSymbolsTogether } from '../parsing/complete';
import { flattenNested } from '../utils/flatten';
import * as Locations from '../utils/locations';
import { uriToReadablePath } from '../utils/translation';
import { equalDiagnostics } from '../code-actions/code-action-handler';

// TODO: add this to the validation.ts file

export function findAllMissingArgparseFlags(
  document: LspDocument,
) {
  const fishSymbols: FishSymbol[] = [];
  const completionSymbols: CompletionSymbol[][] = [];
  const diagnostics: Diagnostic[] = [];
  if (document.isFunction()) {
    const result = findMissingArgparseFlagsWithExistingCompletions(document);
    completionSymbols.push(...result);
  }
  if (document.isAutoloadedWithPotentialCompletions()) {
    const result = findMissingCompletionsWithExistingArgparse(document);
    fishSymbols.push(...result);
  }

  if (completionSymbols.length === 0 && fishSymbols.length === 0) {
    logger.debug(`No missing argparse flags found in document: ${document.uri}`);
    return [];
  }

  // create diagnostics for missing completions
  if (completionSymbols.length > 0) {
    for (const completionGroup of completionSymbols) {
      const diag = createCompletionDiagnostic(completionGroup, analyzer.getFlatDocumentSymbols(document.uri));
      if (diag) {
        const toAdd = diag.filter(d => !diagnostics.some(existing => equalDiagnostics(existing, d)));
        diagnostics.push(...toAdd);
      }
    }
  }

  // create diagnostics for missing argparse flags
  if (fishSymbols.length > 0) {
    for (const symbol of fishSymbols) {
      const diag = createArgparseDiagnostic(symbol, document);
      if (diag) {
        const toAdd = diag.filter(d => !diagnostics.some(existing => equalDiagnostics(existing, d)));
        diagnostics.push(...toAdd);
      }
    }
  }

  // Check if the symbol is a command definition
  return diagnostics;
}

function findMissingArgparseFlagsWithExistingCompletions(
  document: LspDocument,
): CompletionSymbol[][] {
  const missingCompletions: CompletionSymbol[][] = [];

  /**
   * Retrieve all global function symbols in the document.
   */
  const symbols = analyzer.getFlatDocumentSymbols(document.uri);
  const globalSymbols = symbols.filter(s => s.isGlobal() && s.isFunction());

  /**
   * Flatten all global autoloaded function symbols,
   * and extract their argparse symbols.
   */
  const argparseSymbols = flattenNested(...globalSymbols).filter(s => s.fishKind === 'ARGPARSE');
  for (const symbol of argparseSymbols) {
    // get the locations where the completion symbol is implemented
    const completionLocations = analyzer.getImplementation(document, symbol.toPosition())
      .filter(loc => !symbol.equalsLocation(loc));

    if (completionLocations.length === 0) continue;

    for (const location of completionLocations) {
      const cSymbols = analyzer
        .getFlatCompletionSymbols(location.uri)
        .filter(s => s.isNonEmpty());

      if (cSymbols.length === 0) continue;

      const grouped = groupCompletionSymbolsTogether(...cSymbols);
      const result = getGroupedCompletionSymbolsAsArgparse(grouped, argparseSymbols);
      if (result.length > 0) {
        missingCompletions.push(...result);
      }
    }
  }
  return missingCompletions;
}

function findMissingCompletionsWithExistingArgparse(
  document: LspDocument,
) {
  const missingCompletions: FishSymbol[] = [];

  const completionSymbols = analyzer.getFlatCompletionSymbols(document.uri).filter(s => s.isNonEmpty());
  const implementationLocations: Location[] = [];

  completionSymbols.forEach(s => {
    const pos = s.toPosition();
    if (!pos) return;
    const results = analyzer.getImplementation(document, pos)
      .filter(loc => !Locations.Location.equals(loc, s.toLocation()));
    if (results.length === 0) return;
    implementationLocations.push(...results);
  });

  const grouped = groupCompletionSymbolsTogether(...completionSymbols);

  if (grouped.length === 0) return missingCompletions;

  for (const location of implementationLocations) {
    const cSymbols = analyzer.getFlatDocumentSymbols(location.uri)
      .filter(s => s.fishKind === 'ARGPARSE');

    if (cSymbols.length === 0) continue;

    for (const symbol of cSymbols) {
      if (grouped.some(group => group.some(s => s.equalsArgparse(symbol)))) {
        // If the symbol is already in the grouped completions, skip it
        continue;
      }
      missingCompletions.push(symbol);
    }
  }
  return missingCompletions;
}

function createCompletionDiagnostic(completionGroup: CompletionSymbol[], symbols: FishSymbol[]) {
  const diagnostics: Diagnostic[] = [];
  const focusedSymbol = symbols.find(s => s.isFunction() && s.isGlobal() && completionGroup.every(c => c.commandName === s.name));
  if (!focusedSymbol) {
    logger.warning(`No focused location found for completion group: ${completionGroup.map(c => c.text).join(', ')}`, 'HERE');
    return null;
  }

  const hasArgparse = flattenNested(focusedSymbol).find(l => l.fishKind === 'ARGPARSE');
  const focusedNode = hasArgparse ? hasArgparse.node.firstNamedChild : focusedSymbol.node.firstChild?.nextSibling;
  if (!focusedNode) {
    logger.warning(`No focused node found for completion group: ${completionGroup.map(c => c.text).join(', ')}`);
    return null;
  }

  const joinedGroup = completionGroup.map(c => c.toArgparseOpt()).join('/');

  const firstCompletion = completionGroup.find(c => c.isNonEmpty())!;
  const firstCompletionDoc = firstCompletion.document!;
  const prettyPath = uriToReadablePath(firstCompletionDoc.uri);

  // Create a diagnostic for the completion group
  diagnostics.push({
    message: `Add missing \`argparse ${joinedGroup}\` from completion in '${prettyPath}'`,
    severity: 1, // Warning
    source: 'fish-lsp',
    code: 4008,
    range: getRange(focusedNode),
    data: {
      node: focusedNode,
    },
  });

  const joinedGroupUsage = completionGroup.map((item, idx) => {
    if (idx === 0) {
      return item.toUsage();
    }
    return item.toFlag();
  }).join('/');
  diagnostics.push({
    message: `Remove the unused completion \`${joinedGroupUsage}\` in '${prettyPath}'`,
    severity: 1, // Error
    source: 'fish-lsp',
    code: 4009,
    range: getRange(firstCompletion.parent),
    data: {
      node: firstCompletion.parent,
    },
  });

  return diagnostics;
}

function createArgparseDiagnostic(
  symbol: FishSymbol,
  document: LspDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const focusedNode = symbol.focusedNode;

  if (!focusedNode) {
    logger.warning(`No focused node found for symbol: ${symbol.name}`);
    return [];
  }

  const prettyPath = uriToReadablePath(document.uri);
  diagnostics.push({
    message: `remove unused \`argparse ${symbol.argparseFlagName}\` in '${prettyPath}'`,
    severity: 1, // Warning
    source: 'fish-lsp',
    code: 4009,
    range: getRange(focusedNode),
    data: {
      type: 'argparse removal',
      node: focusedNode,
    },
  });

  const completionLocation = analyzer.getImplementation(document, symbol.toPosition())
    .find(loc => !Locations.Location.equals(loc, symbol.toLocation()));

  if (completionLocation) {
    const prettyCompletionPath = uriToReadablePath(completionLocation.uri);
    diagnostics.push({
      message: `Add missing \`${symbol.parent!.name + ' ' + symbol.argparseFlag}\` completion in '${prettyCompletionPath}'`,
      severity: 1, // Warning
      source: 'fish-lsp',
      code: 4008,
      range: getRange(focusedNode),
      data: {
        type: 'argparse addition',
        node: focusedNode,
      },
    });
  }
  return diagnostics;
}

