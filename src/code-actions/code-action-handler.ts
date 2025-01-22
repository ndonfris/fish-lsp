import { CodeAction, CodeActionParams, Diagnostic, Range } from 'vscode-languageserver';
import { getDisableDiagnosticActions } from './disable-actions';
import { getQuickFixes } from './quick-fixes';
import { uriToPath } from '../utils/translation';
import { logger } from '../logger';
import { LspDocument, LspDocuments } from '../document';
import { Analyzer } from '../analyze';
import { getNodeAtRange } from '../utils/tree-sitter';
import { convertIfToCombiners, extractCommandToFunction, extractToFunction, extractToVariable } from './refactors';
// import { createAliasSaveAction, createAliasSaveActionNewFile } from './alias-wrapper';

export function createCodeActionHandler(docs: LspDocuments, analyzer: Analyzer) {
  // Helper functions that have access to docs/analyzer through closure
  // function getNodeAtDiagnostic(diagnostic: Diagnostic, uri: string) {
  //   return analyzer.nodeAtPoint(
  //     uri, diagnostic.range.start.line, diagnostic.range.start.character,
  //   );
  // }

  async function processQuickFixes(document: LspDocument, diagnostics: Diagnostic[], analyzer: Analyzer) {
    const results: CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      logger.log('Processing diagnostic', diagnostic.code, diagnostic.message);
      const quickFixs = await getQuickFixes(document, diagnostic, analyzer);
      for (const fix of quickFixs) {
        logger.log('QuickFix', fix?.title);
      }
      if (quickFixs) results.push(...quickFixs);
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

  return async function handleCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
    logger.log('onCodeAction', params);

    const uri = uriToPath(params.textDocument.uri);
    const document = docs.get(uri);
    if (!document || !uri) return [];

    const results: CodeAction[] = [];

    // Check what kinds of actions are requested
    // const onlyRefactoring = params.context.only?.some(kind =>
    //   kind.startsWith('refactor'),
    // );
    // const onlyQuickFix = params.context.only?.some(kind =>
    //   kind.startsWith('quickfix'),
    // );

    // if (params.context.diagnostics.length > 0) {
    //   // Add regular quick fixes
    //   results.push(...processQuickFixes(document, params.context.diagnostics));
    // }

    // Add quick fixes if requested
    const quickFixes = await processQuickFixes(document, params.context.diagnostics, analyzer);
    results.push(...quickFixes);
    // Add disable actions
    results.push(...getDisableDiagnosticActions(document, params.context.diagnostics));

    const refactors = await processRefactors(document, params.range);
    results.push(...refactors);

    // Add refactors if requested
    // if (!!onlyRefactoring) {
    //   // results.push(...await processRefactors(document, params.range));
    // }

    return results;
  };
}
