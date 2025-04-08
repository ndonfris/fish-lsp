import { InlayHint, InlayHintKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { isCommand, isCommandName, isReturn } from './utils/node-types';
import { findChildNodes } from './utils/tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
import { getReferences } from './references';
import { logger } from './logger';

export function getStatusInlayHints(root: SyntaxNode): InlayHint[] {
  const hints: InlayHint[] = [];
  const returnStatements = findChildNodes(root, isReturn);

  for (const returnStmt of returnStatements) {
    const status = getReturnStatusValue(returnStmt);
    if (status) {
      hints.push({
        position: {
          line: returnStmt.endPosition.row,
          character: returnStmt.endPosition.column,
        },
        kind: InlayHintKind.Parameter,
        label: ` → ${status.inlineValue}`,
        paddingLeft: true,
        tooltip: {
          kind: 'markdown',
          value: `Status code ${status.tooltip.code}: ${status.tooltip.description}`,
        },
      });
    }
  }

  return hints;
}

export function findReturnNodes(root: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (isReturn(node)) {
      nodes.push(node);
    }
    queue.push(...node.children);
  }

  return nodes;
}

function getStatusDescription(status: string): string {
  const statusMap: Record<string, string> = {
    0: 'Success',
    1: 'General error',
    2: 'Misuse of shell builtins',
    126: 'Command invoked cannot execute',
    127: 'Command not found',
    128: 'Invalid exit argument',
    130: 'Script terminated by Control-C',
  };
  return statusMap[status] || `Exit code ${status}`;
}

export function getReturnStatusValue(returnNode: SyntaxNode): {
  inlineValue: string;
  tooltip: {
    code: string;
    description: string;
  };
} | undefined {
  const statusArg = returnNode.children.find(child =>
    !isCommand(child) && !isCommandName(child) && child.type === 'integer');

  if (!statusArg?.text) return undefined;

  const statusInfo = PrebuiltDocumentationMap.getByName(statusArg.text).pop();
  const statusInfoShort = getStatusDescription(statusArg.text);

  return statusInfoShort ? {
    inlineValue: statusInfoShort,
    tooltip: {
      code: statusInfo?.name || statusArg.text,
      description: statusInfo?.description || statusInfoShort,
    },
  } : undefined;
}

// export function getGlobalReferencesCodeLens(analyzer: Analyzer, document: LspDocument): InlayHint[] {
//     return analyzer.getFlatDocumentSymbols(document.uri)
//     .filter(symbol => symbol.scope.scopeTag === 'global' || symbol.scope.scopeTag === 'universal')
//     .map(symbol => {
//       const referenceCount = getReferenceLocations(analyzer, document, symbol.selectionRange.start).length
//       return {
//         position: document.getLineEnd(symbol.selectionRange.start.line),
//         kind: InlayHintKind.Type,
//         label: `${referenceCount} reference${referenceCount === 0 ? '' : 's'}`,
//         paddingLeft: true,
//       }
//     })
// }

// export function getAllInlayHints(analyzer: Analyzer, document: LspDocument): InlayHint[] {
//   const root = analyzer.getRootNode(document);
//   const results: InlayHint[] = [];
//   if (root) {
//     results.push(...getStatusInlayHints(root));
//   }
//
//   // const globalReferencesHints = getGlobalReferencesCodeLens(analyzer, document);
//   // if (globalReferencesHints.length > 0) {
//   //   results.push(...globalReferencesHints);
//   // }
//   return results
// }

// Add a cache for the entire inlay hints result
type InlayHintsCache = {
  hints: InlayHint[];
  timestamp: number;
  version: number; // Track document version
};

const inlayHintsCache = new Map<string, InlayHintsCache>();
const INLAY_HINTS_TTL = 1500; // 1.5 seconds TTL for full hints refresh

function getCachedInlayHints(
  uri: string,
  documentVersion: number,
): InlayHint[] | undefined {
  const entry = inlayHintsCache.get(uri);
  if (!entry) return undefined;

  // Return nothing if document version changed or cache is too old
  if (entry.version !== documentVersion ||
      Date.now() - entry.timestamp > INLAY_HINTS_TTL) {
    inlayHintsCache.delete(uri);
    return undefined;
  }

  return entry.hints;
}

function setCachedInlayHints(
  uri: string,
  hints: InlayHint[],
  documentVersion: number,
) {
  inlayHintsCache.set(uri, {
    hints,
    timestamp: Date.now(),
    version: documentVersion,
  });
}

export function getGlobalReferencesInlayHints(
  analyzer: Analyzer,
  document: LspDocument,
): InlayHint[] {
  // Try to get cached hints first
  const cachedHints = getCachedInlayHints(document.uri, document.version);
  if (cachedHints) {
    logger?.log('Using cached inlay hints');
    return cachedHints;
  }

  logger?.log('Computing new inlay hints');

  const hints: InlayHint[] = analyzer.getFlatDocumentSymbols(document.uri)
    .filter(symbol => symbol.scope.scopeTag === 'global' || symbol.scope.scopeTag === 'universal')
    .map(symbol => {
      const referenceCount = getReferences(analyzer, document, symbol.selectionRange.start).length;

      return {
        position: document.getLineEnd(symbol.selectionRange.start.line),
        kind: InlayHintKind.Type,
        label: `${referenceCount} reference${referenceCount === 1 ? '' : 's'}`,
        paddingLeft: true,
        tooltip: {
          kind: 'markdown',
          value: `${symbol.name} is referenced ${referenceCount} time${referenceCount === 1 ? '' : 's'} across the workspace`,
        },
      };
    });

  // Cache the new hints
  setCachedInlayHints(document.uri, hints, document.version);

  return hints;
}

// Function to invalidate cache when document changes
export function invalidateInlayHintsCache(uri: string) {
  inlayHintsCache.delete(uri);
}

export function getAllInlayHints(analyzer: Analyzer, document: LspDocument): InlayHint[] {
  const results: InlayHint[] = [];
  const root = analyzer.getRootNode(document.uri);
  if (root) {
    results.push(...getStatusInlayHints(root));
    // results.push(...getGlobalReferencesInlayHints(analyzer, document));
  }
  return results;
  // const cachedHints = getCachedInlayHints(document.uri, document.version);
  // if (cachedHints) {
  //   return cachedHints;
  // }
  //
  // const results: InlayHint[] = [];
  // const root = analyzer.getRootNode(document);
  //
  // if (root) {
  //   results.push(...getStatusInlayHints(root));
  //   results.push(...getGlobalReferencesInlayHints(analyzer, document));
  // }
  //
  // // Cache all hints together
  // setCachedInlayHints(document.uri, results, document.version);
  //
  // return results;
}
