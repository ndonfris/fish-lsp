import { CodeAction, CodeActionParams, Diagnostic, Range } from 'vscode-languageserver';
import { getDisableDiagnosticActions } from './disable-actions';
import { getQuickFixes } from './quick-fixes';
import { uriToPath } from '../utils/translation';
import { logger } from '../logger';
import { LspDocument, LspDocuments } from '../document';
import { Analyzer } from '../analyze';
import { getNodeAtRange } from '../utils/tree-sitter';
import { convertIfToCombiners, extractCommandToFunction, extractFunctionToFile, extractFunctionWithArgparseToCompletionsFile, extractToFunction, extractToVariable } from './refactors';
// import { createAliasSaveAction, createAliasSaveActionNewFile } from './alias-wrapper';

export function createCodeActionHandler(docs: LspDocuments, analyzer: Analyzer) {
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

    const rootNode = analyzer.getRootNode(document);
    if (!rootNode) return results;

    // Get node at the selected range
    const selectedNode = getNodeAtRange(rootNode, range);
    if (!selectedNode) return results;

    // Try each refactoring action
    const extractFunction = extractToFunction(document, range);
    if (extractFunction) results.push(extractFunction);

    const extractCommandFunction = extractCommandToFunction(document, selectedNode);
    if (extractCommandFunction) results.push(extractCommandFunction);

    const extractVar = extractToVariable(document, range, selectedNode);
    if (extractVar) results.push(extractVar);

    const extractFuncToFile = extractFunctionToFile(document, range, selectedNode);
    if (extractFuncToFile) results.push(extractFuncToFile);

    const extractCompletionToFile = extractFunctionWithArgparseToCompletionsFile(document, range, selectedNode);
    if (extractCompletionToFile) results.push(extractCompletionToFile);

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
    const onlyRefactoring = params.context.only?.some(kind => kind.startsWith('refactor'));
    const onlyQuickFix = params.context.only?.some(kind => kind.startsWith('quickfix'));

    logger.log('Requested actions', { onlyRefactoring, onlyQuickFix });

    // Add disable actions
    if (params.context.diagnostics.length > 0) {
      results.push(...getDisableDiagnosticActions(document, params.context.diagnostics));
    }
    // Add quick fixes if requested
    if (onlyQuickFix) {
      results.push(...await processQuickFixes(document, params.context.diagnostics, analyzer));
      return results;
    }

    // add the refactors
    if (onlyRefactoring) {
      results.push(...await processRefactors(document, params.range));
      return results;
    }
    results.push(...await processQuickFixes(document, params.context.diagnostics, analyzer));

    logger.log('CodeAction results', results.map(r => r.title));
    return results;
  };
}
