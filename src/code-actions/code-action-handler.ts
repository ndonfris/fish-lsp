import { CodeAction, CodeActionParams, Diagnostic, Range } from 'vscode-languageserver';
import { getDisableDiagnosticActions } from './disable-actions';
import { createFixAllAction, getQuickFixes } from './quick-fixes';
import { uriToPath } from '../utils/translation';
import { logger } from '../logger';
import { LspDocument, LspDocuments } from '../document';
import { Analyzer } from '../analyze';
import { getNodeAtRange } from '../utils/tree-sitter';
import { convertIfToCombiners, extractCommandToFunction, extractFunctionToFile, extractFunctionWithArgparseToCompletionsFile, extractToFunction, extractToVariable } from './refactors';
import { createArgparseCompletionsCodeAction } from './argparse-completions';
import { isCommandWithName, isIfStatement, isProgram } from '../utils/node-types';
import { createAliasInlineAction, createAliasSaveActionNewFile } from './alias-wrapper';

export function createCodeActionHandler(docs: LspDocuments, analyzer: Analyzer) {
  /**
   * small helper for now, used to add code actions that are not `preferred`
   * quickfixes to the list of results, when a quickfix is requested.
   */
  async function getSelectionCodeActions(document: LspDocument, range: Range) {
    const rootNode = analyzer.getRootNode(document.uri);
    if (!rootNode) return [];

    const selectedNode = getNodeAtRange(rootNode, range);
    if (!selectedNode) return [];

    const results: CodeAction[] = [];
    if (isProgram(selectedNode)) {
      analyzer.getNodes(document.uri).forEach(n => {
        if (isCommandWithName(n, 'argparse')) {
          const argparseAction = createArgparseCompletionsCodeAction(n, document);
          if (argparseAction) results.push(argparseAction);
        }
        // if (isIfStatement(n)) {
        //   const convertIfAction = convertIfToCombiners(document, n, false);
        //   if (convertIfAction) results.push(convertIfAction);
        // }
      });
    }

    if (!isProgram(selectedNode)) {
      const commandToFunctionAction = extractCommandToFunction(document, selectedNode);
      if (commandToFunctionAction) results.push(commandToFunctionAction);
    }

    if (isCommandWithName(selectedNode, 'alias')) {
      const aliasInlineFunction = await createAliasInlineAction(document, selectedNode);
      const aliasNewFile = await createAliasSaveActionNewFile(document, selectedNode);
      if (aliasInlineFunction) results.push(aliasInlineFunction);
      if (aliasNewFile) results.push(aliasNewFile);
    }

    return results;
  }

  /**
   * Helper to add quick fixes to the list that are mostly of the type `preferred`
   *
   * These quick fixes include things like `disable` actions, and general fixes to silence diagnostics
   */
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

  /**
   * Process refactors for the given document and range
   */
  async function processRefactors(document: LspDocument, range: Range) {
    const results: CodeAction[] = [];

    const rootNode = analyzer.getRootNode(document.uri);
    if (!rootNode) return results;

    // Get node at the selected range
    const selectedNode = getNodeAtRange(rootNode, range);
    if (!selectedNode) return results;

    // try refactoring aliases first
    let aliasCommand = selectedNode;
    if (selectedNode.text === 'alias') aliasCommand = selectedNode.parent!;
    if (aliasCommand && isCommandWithName(aliasCommand, 'alias')) {
      logger.log('isCommandWithName(alias)', aliasCommand.text);
      const aliasInlineFunction = await createAliasInlineAction(document, aliasCommand);
      const aliasNewFile = await createAliasSaveActionNewFile(document, aliasCommand);
      if (aliasInlineFunction) results.push(aliasInlineFunction);
      if (aliasNewFile) results.push(aliasNewFile);
      return results;
    }

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
    logger.log('onCodeAction', { uri });

    const results: CodeAction[] = [];

    // only process diagnostics from the fish-lsp source
    const diagnostics = params.context.diagnostics.filter(d => d.source === 'fish-lsp');

    // Check what kinds of actions are requested
    const onlyRefactoring = params.context.only?.some(kind => kind.startsWith('refactor'));
    const onlyQuickFix = params.context.only?.some(kind => kind.startsWith('quickfix'));

    logger.log('Requested actions', { onlyRefactoring, onlyQuickFix });
    logger.log('Diagnostics', diagnostics.map(d => d.message));

    // Add disable actions
    if (diagnostics.length > 0 && !onlyRefactoring) {
      results.push(...getDisableDiagnosticActions(document, diagnostics));
    }
    // Add quick fixes if requested
    if (onlyQuickFix) {
      logger.log('Processing onlyQuickFixes');
      results.push(...await processQuickFixes(document, diagnostics, analyzer));
      results.push(...await getSelectionCodeActions(document, params.range));
      const allAction = createFixAllAction(document, results);
      if (allAction) results.push(allAction);
      logger.log('CodeAction results', results.map(r => r.title));
      return results;
    }

    // add the refactors
    if (onlyRefactoring) {
      logger.log('Processing onlyRefactors');
      results.push(...await processRefactors(document, params.range));
      logger.log('CodeAction results', results.map(r => r.title));
      return results;
    }

    logger.log('Processing all actions');
    results.push(...await processQuickFixes(document, diagnostics, analyzer));
    results.push(...await getSelectionCodeActions(document, params.range));
    const allAction = createFixAllAction(document, results);
    if (allAction) {
      logger.log({
        name: 'allAction',
        title: allAction.title,
        kind: allAction.kind,
        diagnostics: diagnostics?.map(d => d.message),
        edit: allAction.edit,
      });
      results.push(allAction);
    }
    logger.log('CodeAction results', results.map(r => r.title));
    return results;
  };
}

export function equalDiagnostics(d1: Diagnostic, d2: Diagnostic) {
  return d1.code === d2.code &&
    d1.message === d2.message &&
    d1.range.start.line === d2.range.start.line &&
    d1.range.start.character === d2.range.start.character &&
    d1.range.end.line === d2.range.end.line &&
    d1.range.end.character === d2.range.end.character &&
    d1.data.node?.text === d2.data.node?.text;
}

export function createOnCodeActionResolveHandler(_docs: LspDocuments, _analyzer: Analyzer) {
  return async function codeActionResolover(codeAction: CodeAction) {
    return codeAction;
  };
}

export function codeActionHandlers(docs: LspDocuments, analyzer: Analyzer) {
  return {
    onCodeAction: createCodeActionHandler(docs, analyzer),
    onCodeActionResolve: createOnCodeActionResolveHandler(docs, analyzer),
  };
}

