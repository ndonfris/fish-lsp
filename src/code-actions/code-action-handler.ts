// In server.ts
import { CodeAction, CodeActionParams, Diagnostic, Range } from 'vscode-languageserver';
import { getDisableDiagnosticActions } from './disable-actions';
import { getQuickFixes } from './quick-fixes';
import { uriToPath } from '../utils/translation';
import { logger } from '../logger';
import { LspDocument, LspDocuments } from '../document';
import { Analyzer } from '../analyze';
import { getNodeAtRange } from '../utils/tree-sitter';
import { convertIfToCombiners, extractCommandToFunction, extractToFunction, extractToVariable } from './refactors';

// export async function createCodeActionHandler(docs: LspDocuments, analyzer: Analyzer) {
//
//   return async  function handleCodeAction(params: CodeActionParams) : Promise<CodeAction[]> {
//     logger.log('onCodeAction', params);
//
//     const uri = uriToPath(params.textDocument.uri);
//     const document = docs.get(uri);
//     if (!document || !uri) return [];
//
//     const results: CodeAction[] = [];
//
//     // Add quick fixes
//     for (const diagnostic of params.context.diagnostics) {
//       const node = analyzer.nodeAtPoint(
//         document.uri,
//         diagnostic.range.start.line,
//         diagnostic.range.start.character
//       );
//
//       if (!node) continue;
//
//       const quickFix = getQuickFixes(document, diagnostic, node);
//       if (quickFix) {
//         results.push(quickFix);
//       }
//     }
//
//     // Add disable actions
//     if (params.context.diagnostics.length > 0) {
//       results.push(...getDisableDiagnosticActions(
//         document,
//         params.context.diagnostics
//       ));
//     }
//
//     return results;
//   };
// }
// src/handlers/code-action.ts
export function createCodeActionHandler(docs: LspDocuments, analyzer: Analyzer) {
  // Helper functions that have access to docs/analyzer through closure
  function getNodeAtDiagnostic(diagnostic: Diagnostic, uri: string) {
    return analyzer.nodeAtPoint(
      uri, diagnostic.range.start.line, diagnostic.range.start.character,
    );
  }

  function processQuickFixes(document: LspDocument, diagnostics: Diagnostic[]) {
    const results: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      const node = getNodeAtDiagnostic(diagnostic, document.uri);
      if (!node) continue;

      const quickFix = getQuickFixes(document, diagnostic, node);
      if (quickFix) results.push(quickFix);
    }
    return results;
  }

  async function processRefactors(document: LspDocument, range: Range) {
    const results: CodeAction[] = [];

    // Get node at the selected range
    const selectedNode = getNodeAtRange(analyzer.getRootNode(document)!, range);
    if (!selectedNode) return results;

    // Try each refactoring action
    const extractFunction = extractToFunction(document, range, selectedNode);
    if (extractFunction) results.push(extractFunction);

    const extractCommandFunction = extractCommandToFunction(document, selectedNode);
    if (extractCommandFunction) results.push(extractCommandFunction);

    const extractVar = extractToVariable(document, range, selectedNode);
    if (extractVar) results.push(extractVar);

    const convertIf = convertIfToCombiners(document, selectedNode);
    if (convertIf) results.push(convertIf);

    return results;
  }

  // // The actual handler using the helper functions
  // return async function handleCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
  //   logger.log('onCodeAction', params);
  //
  //   const uri = uriToPath(params.textDocument.uri);
  //   const document = docs.get(uri);
  //   if (!document || !uri) return [];
  //
  //   const results: CodeAction[] = [];
  //
  //   // Use helper functions
  //   results.push(...await processQuickFixes(document, params.context.diagnostics));
  //
  //   //
  //
  //   if (params.context.diagnostics.length > 0) {
  //     results.push(...getDisableDiagnosticActions(document, params.context.diagnostics));
  //   }
  //
  //   return results;
  // };
  return async function handleCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
    logger.log('onCodeAction', params);

    const uri = uriToPath(params.textDocument.uri);
    const document = docs.get(uri);
    if (!document || !uri) return [];

    const results: CodeAction[] = [];

    // Check what kinds of actions are requested
    const onlyRefactoring = params.context.only?.some(kind =>
      kind.startsWith('refactor'),
    );
    const onlyQuickFix = params.context.only?.some(kind =>
      kind.startsWith('quickfix'),
    );

    // Add quick fixes if requested
    if (!params.context.only || onlyQuickFix) {
      if (params.context.diagnostics.length > 0) {
        // Add regular quick fixes
        results.push(...processQuickFixes(document, params.context.diagnostics));

        // Add disable actions
        results.push(...getDisableDiagnosticActions(document, params.context.diagnostics));
      }
    }

    // Add refactors if requested
    if (!params.context.only || onlyRefactoring) {
      results.push(...await processRefactors(document, params.range));
    }

    return results;
  };
}
