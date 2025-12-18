import { CodeAction, CodeActionParams, Diagnostic, Range } from 'vscode-languageserver';
import { getDisableDiagnosticActions } from './disable-actions';
import { createFixAllAction, getQuickFixes } from './quick-fixes';
import { logger } from '../logger';
import { documents, LspDocument } from '../document';
import { analyzer, Analyzer } from '../analyze';
import { findFirstParent, getNodeAtRange } from '../utils/tree-sitter';
import { convertIfToCombiners, extractCommandToFunction, extractFunctionToFile, extractFunctionWithArgparseToCompletionsFile, extractToVariable, replaceAbsolutePathWithVariable, simplifySetAppendPrepend } from './refactors';
import { createArgparseCompletionsCodeAction } from './argparse-completions';
import { isCommandName, isCommandWithName, isProgram, isAliasDefinitionName, isCommand } from '../utils/node-types';
import { createAliasInlineAction, createAliasSaveActionNewFile } from './alias-wrapper';
import { SyntaxNode } from 'web-tree-sitter';
import { handleRedirectActions } from './redirect-actions';

/**
 * Sort code actions by kind to group similar actions together
 */
function sortCodeActionsByKind(actions: CodeAction[]): CodeAction[] {
  const kindOrder = {
    'quickfix.disable': 0,      // Disable comments first
    'quickfix.fix': 1,           // Then quick fixes
    'quickfix.fixAll': 2,        // Then fix all
    'refactor.extract': 3,       // Then extractions
    'refactor.rewrite': 4,       // Then rewrites (redirects, prefixes, etc.)
    'source.rename': 5,          // Then renames
  };

  return actions.sort((a, b) => {
    const orderA = a.kind ? kindOrder[a.kind as keyof typeof kindOrder] ?? 999 : 999;
    const orderB = b.kind ? kindOrder[b.kind as keyof typeof kindOrder] ?? 999 : 999;
    return orderA - orderB;
  });
}

/**
 * Check if a range represents a selection (non-zero width)
 */
function isSelection(range: Range): boolean {
  return range.start.line !== range.end.line ||
    range.start.character !== range.end.character;
}

export function getParentCommandNodeForCodeAction(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null;
  return findFirstParent(node, isCommand);
}

export function createCodeActionHandler() {
  /**
   * small helper for now, used to add code actions that are not `preferred`
   * quickfixes to the list of results, when a quickfix is requested.
   */
  async function getSelectionCodeActions(document: LspDocument, range: Range) {
    const rootNode = analyzer.getRootNode(document.uri);
    if (!rootNode) return [];

    const selectedNode = getNodeAtRange(rootNode, range);
    if (!selectedNode) return [];

    logger.log('getSelectionCodeActions', {
      selectedNodeType: selectedNode.type,
      selectedNodeText: selectedNode.text.substring(0, 50),
      isProgram: isProgram(selectedNode),
      isCommandWithNameArgparse: isCommandWithName(selectedNode, 'argparse'),
      parentType: selectedNode.parent?.type,
      parentIsArgparse: selectedNode.parent ? isCommandWithName(selectedNode.parent, 'argparse') : false,
    });

    const commands: SyntaxNode[] = [];

    const results: CodeAction[] = [];
    if (isProgram(selectedNode)) {
      const MAX_REDIRECT_COMMANDS = 2;
      const cursorPosition = range.start;
      const commandsForRedirect: SyntaxNode[] = [];

      // First pass: collect all command nodes and handle argparse
      analyzer.getNodes(document.uri).forEach(n => {
        if (isCommandWithName(n, 'argparse')) {
          const argparseAction = createArgparseCompletionsCodeAction(n, document);
          if (argparseAction) results.push(argparseAction);
        }
        if (isCommandName(n) && !commands.some(c => n.id === c.id)) {
          commands.push(n);
          commandsForRedirect.push(n);
        }
        // if (isIfStatement(n)) {
        //   const convertIfAction = convertIfToCombiners(document, n, false);
        //   if (convertIfAction) results.push(convertIfAction);
        // }
      });

      // Sort commands by distance to cursor and take the 2 closest
      const closestCommands = commandsForRedirect
        .sort((a, b) => {
          const distA = Math.abs(a.startPosition.row - cursorPosition.line);
          const distB = Math.abs(b.startPosition.row - cursorPosition.line);
          return distA - distB;
        })
        .slice(0, MAX_REDIRECT_COMMANDS);

      // Add redirect actions only for the closest commands
      closestCommands.forEach(n => {
        const redirectActions = handleRedirectActions(document, n.parent!);
        if (redirectActions) results.push(...redirectActions);
      });
    }

    // Note: Alias refactoring is handled in processRefactors to avoid duplication
    // Note: extractCommandToFunction is handled in processRefactors to avoid duplication
    if (isCommandWithName(selectedNode, 'argparse')) {
      const argparseAction = createArgparseCompletionsCodeAction(selectedNode, document);
      if (argparseAction) results.push(argparseAction);
    } else if (selectedNode.parent && isCommandWithName(selectedNode.parent, 'argparse')) {
      // Also handle when cursor is on a child of argparse command (e.g., on the word "argparse")
      const argparseAction = createArgparseCompletionsCodeAction(selectedNode.parent, document);
      if (argparseAction) results.push(argparseAction);
    }

    if (isCommandName(selectedNode) && !commands.some(c => selectedNode.id === c.id)) {
      commands.push(selectedNode);
      const redirectActions = handleRedirectActions(document, selectedNode.parent!);
      if (redirectActions) results.push(...redirectActions);
    }

    // if (isCommand(selectedNode) || hasParent(selectedNode, isCommand) && !commands.some(c => selectedNode.id === c.id)) {
    //   commands.push(selectedNode);
    //   const addSilenceAction = silenceCommandAction(document, selectedNode);
    //   if (addSilenceAction) results.push(addSilenceAction);
    // }

    if (results.length === 0) {
      logger.log('No selection code actions for node', selectedNode.type, selectedNode.text);
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

    // Check if cursor is on the 'alias' keyword
    if (selectedNode.text === 'alias') {
      aliasCommand = selectedNode.parent!;

      // Check if cursor is on the alias definition name (e.g., "foo" in "alias foo=bar")
    } else if (isAliasDefinitionName(selectedNode)) {
      aliasCommand = selectedNode.parent?.type === 'concatenation'
        ? selectedNode.parent.parent!
        : selectedNode.parent!;
    }

    if (aliasCommand && isCommandWithName(aliasCommand, 'alias')) {
      logger.log('isCommandWithName(alias)', aliasCommand.text);
      const aliasInlineFunction = await createAliasInlineAction(document, aliasCommand);
      const aliasNewFile = await createAliasSaveActionNewFile(document, aliasCommand);
      if (aliasInlineFunction) results.push(aliasInlineFunction);
      if (aliasNewFile) results.push(aliasNewFile);
      return results;
    }

    // Try each refactoring action
    // const extractFunction = extractToFunction(document, range);
    // if (extractFunction) results.push(extractFunction);
    // const selectedRange = isSelection(range) ? range : undefined;

    // Pass range and selection info to extractCommandToFunction
    if (!isSelection(range)) {
      const extractCommandFunction = extractCommandToFunction(
        document,
        isSelection(range) ? range : undefined,
        selectedNode,
      );
      if (extractCommandFunction) results.push(extractCommandFunction);

      const extractVar = extractToVariable(document, range, selectedNode);
      if (extractVar) results.push(extractVar);
    }

    const extractFuncToFile = extractFunctionToFile(document, range, selectedNode);
    if (extractFuncToFile) results.push(extractFuncToFile);

    const extractCompletionToFile = extractFunctionWithArgparseToCompletionsFile(document, range, selectedNode);
    if (extractCompletionToFile) results.push(extractCompletionToFile);

    const convertIf = convertIfToCombiners(document, selectedNode);
    if (convertIf) results.push(convertIf);

    const replacePathWithVarActions = replaceAbsolutePathWithVariable(document, range);
    results.push(...replacePathWithVarActions);

    const simplifySetActions = simplifySetAppendPrepend(document, selectedNode);
    results.push(...simplifySetActions);

    return results;
  }

  return async function handleCodeAction(params: CodeActionParams): Promise<CodeAction[]> {
    logger.debug('onCodeAction', {
      params: {
        context: {
          only: params.context.only,
          diagnostics: params.context.diagnostics.map(d => `${d.code}:${d.range.start.line}`),
          triggerKind: params.context.triggerKind?.toString(),
        },
        uri: params.textDocument.uri,
        range: params.range,
        isSelection: isSelection(params.range),
      },
    });

    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const results: CodeAction[] = [];

    // only process diagnostics from the fish-lsp source
    const diagnostics = params.context.diagnostics
      .filter(d => !!d?.severity)
      .filter(d => d.source === 'fish-lsp');

    // Check what kinds of actions are requested
    const onlyRefactoring = params.context.only?.some(kind => kind.startsWith('refactor'));
    const onlyQuickFix = params.context.only?.some(kind => kind.startsWith('quickfix'));

    logger.log('Requested actions', { onlyRefactoring, onlyQuickFix });
    logger.log('Diagnostics', diagnostics.map(d => ({ code: d.code, message: d.message })));

    // Add disable actions
    if (diagnostics.length > 0 && !onlyRefactoring) {
      const disableActions = getDisableDiagnosticActions(document, diagnostics);
      logger.log('Disable actions', disableActions.map(a => a.title));
      for (const action of disableActions) {
        if (results.every(existing => existing.title !== action.title)) {
          results.push(action);
        }
      }
    }
    // Add quick fixes if requested
    if (onlyQuickFix) {
      logger.log('Processing onlyQuickFixes');
      results.push(...await processQuickFixes(document, diagnostics, analyzer));
      results.push(...await getSelectionCodeActions(document, params.range));
      const allAction = createFixAllAction(document, results);
      if (allAction) results.push(allAction);
      logger.log('CodeAction results', results.map(r => r.title));
      return sortCodeActionsByKind(results);
    }

    // add the refactors
    if (onlyRefactoring) {
      logger.log('Processing onlyRefactors');
      results.push(...await processRefactors(document, params.range));
      logger.log('CodeAction results', results.map(r => r.title));
      return sortCodeActionsByKind(results);
    }

    logger.log('Processing all actions');
    results.push(...await processQuickFixes(document, diagnostics, analyzer));
    results.push(...await getSelectionCodeActions(document, params.range));
    results.push(...await processRefactors(document, params.range));
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
    return sortCodeActionsByKind(results);
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

export function createOnCodeActionResolveHandler() {
  return async function codeActionResolover(codeAction: CodeAction) {
    return codeAction;
  };
}

export function codeActionHandlers() {
  return {
    onCodeActionCallback: createCodeActionHandler(),
    onCodeActionResolveCallback: createOnCodeActionResolveHandler(),
  };
}

