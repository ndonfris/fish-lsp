import { ChangeAnnotation, CodeAction, Diagnostic, RenameFile, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { ErrorCodes } from '../diagnostics/error-codes';
import { equalRanges, getChildNodes } from '../utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorNodeTypes } from '../diagnostics/node-types';
import { SupportedCodeActionKinds } from './action-kinds';
import { logger } from '../logger';
import { Analyzer } from '../analyze';
// import { createAliasInlineAction, createAliasSaveActionNewFile } from './alias-wrapper';
import { getRange } from '../utils/tree-sitter';
import { pathToRelativeFunctionName, uriToPath } from '../utils/translation';
import { isFunctionDefinition } from '../utils/node-types';

/**
 * These quick-fixes are separated from the other diagnostic quick-fixes because
 * future work will involve adding significantly more complex
 * solutions here (atleast I hope. I definitely think fish uniquely has a lot
 * of potential for how advancded quickfixes could become eventually).
 *
 * The quick-fixes located at disable-actions.ts are mainly for simple disabling
 * of diagnostic messages.
 */

// Helper to create a QuickFix code action
function createQuickFix(
  title: string,
  diagnostic: Diagnostic,
  edits: { [uri: string]: TextEdit[]; },
): CodeAction {
  return {
    title,
    kind: SupportedCodeActionKinds.QuickFix.toString(),
    isPreferred: true,
    diagnostics: [diagnostic],
    edit: { changes: edits },
  };
}

/**
 * Helper to create a QuickFix code action for fixing all problems
 */
export function createFixAllAction(
  document: LspDocument,
  actions: CodeAction[],
): CodeAction | undefined {
  if (actions.length === 0) return undefined;
  const fixableActions = actions.filter(action => {
    return action.isPreferred && action.kind === SupportedCodeActionKinds.QuickFix;
  });
  for (const fixable of fixableActions) {
    logger.info('createFixAllAction', { fixable: fixable.title });
  }

  if (fixableActions.length === 0) return undefined;
  const resultEdits: { [uri: string]: TextEdit[]; } = {};
  const diagnostics: Diagnostic[] = [];
  for (const action of fixableActions) {
    if (!action.edit || !action.edit.changes) continue;
    const changes = action.edit.changes;
    for (const uri of Object.keys(changes)) {
      const edits = changes[uri];
      if (!edits || edits.length === 0) continue;
      if (!resultEdits[uri]) {
        resultEdits[uri] = [];
      }
      const oldEdits = resultEdits[uri];
      if (edits && edits?.length > 0) {
        if (!oldEdits.some(e => edits.find(newEdit => equalRanges(e.range, newEdit.range)))) {
          oldEdits.push(...edits);
          resultEdits[uri] = oldEdits;
          diagnostics.push(...action.diagnostics || []);
        }
        // resultEdits[uri].push(...edits);
      }
    }
  }
  const allEdits: TextEdit[] = [];
  for (const uri in resultEdits) {
    const edits = resultEdits[uri];
    if (!edits || edits.length === 0) continue;
    allEdits.push(...edits);
  }
  return {
    title: `Fix all auto-fixable quickfixes (total fixes: ${allEdits.length}) (codes: ${diagnostics.map(d => d.code).join(', ')})`,
    kind: SupportedCodeActionKinds.QuickFixAll,
    diagnostics,
    edit: {
      changes: resultEdits,
    },
    data: {
      isQuickFix: true,
      documentUri: document.uri,
      totalEdits: allEdits.length,
      uris: Array.from(new Set(Object.keys(resultEdits))),
    },
  };
}

/**
 * utility function to get the error node token
 */
function getErrorNodeToken(node: SyntaxNode): string | undefined {
  const { text } = node;
  const startTokens = Object.keys(ErrorNodeTypes);
  for (const token of startTokens) {
    if (text.startsWith(token)) {
      return ErrorNodeTypes[token as keyof typeof ErrorNodeTypes];
    }
  }
  return undefined;
}

export function handleMissingEndFix(
  document: LspDocument,
  diagnostic: Diagnostic,
  analyzer: Analyzer,
): CodeAction | undefined {
  const root = analyzer.getTree(document.uri)!.rootNode;

  const errNode = root.descendantForPosition({ row: diagnostic.range.start.line, column: diagnostic.range.start.character })!;

  // const err = root!.childForFieldName('ERROR')!;
  // const toSearch = getChildNodes(err).find(node => node.isError)!;

  const rawErrorNodeToken = getErrorNodeToken(errNode);

  if (!rawErrorNodeToken) return undefined;

  const endTokenWithNewline = rawErrorNodeToken === 'end' ? '\nend' : rawErrorNodeToken;
  return {
    title: `Add missing "${rawErrorNodeToken}"`,
    diagnostics: [diagnostic],
    kind: SupportedCodeActionKinds.QuickFix,
    edit: {
      changes: {
        [document.uri]: [
          TextEdit.insert({
            line: errNode!.endPosition.row,
            character: errNode!.endPosition.column,
          }, endTokenWithNewline),
        ],
      },
    },
  };
}

export function handleExtraEndFix(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  // Simply delete the extra end
  const edit = TextEdit.del(diagnostic.range);

  return createQuickFix(
    'Remove extra "end"',
    diagnostic,
    {
      [document.uri]: [edit],
    },
  );
}

// Handle missing quiet option error
function handleMissingQuietError(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  // Add -q flag
  const edit = TextEdit.insert(diagnostic.range.end, ' -q ');

  return {
    title: 'Add quiet (-q) flag',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    command: {
      command: 'editor.action.formatDocument',
      title: 'Format Document',
    },
    isPreferred: true,
  };
}

function handleZeroIndexedArray(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  return {
    title: 'Convert zero-indexed array to one-indexed array',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [
          TextEdit.del(diagnostic.range),
          TextEdit.insert(diagnostic.range.start, '1'),
        ],
      },
    },
    isPreferred: true,
  };
}

function handleDotSourceCommand(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  const edit = TextEdit.replace(diagnostic.range, 'source');

  return {
    title: 'Convert dot source command to source',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

// fix cases like: -xU
function handleUniversalVariable(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  const text = document.getText(diagnostic.range);

  let newText = text.replace(/U/g, 'g');
  newText = newText.replace(/--universal/g, '--global');

  const edit = TextEdit.replace(
    {
      start: diagnostic.range.start,
      end: diagnostic.range.end,
    },
    newText,
  );

  return {
    title: 'Convert universal scope to global scope',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

export function handleSingleQuoteVarFix(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  // Replace single quotes with double quotes
  const text = document.getText(diagnostic.range);
  const newText = text.replace(/'/g, '"').replace(/\$/g, '\\$');

  const edit = TextEdit.replace(
    diagnostic.range,
    newText,
  );

  return {
    title: 'Convert to double quotes',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

export function handleTestCommandVariableExpansionWithoutString(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  return createQuickFix(
    'Surround test string comparison with double quotes',
    diagnostic,
    {
      [document.uri]: [
        TextEdit.insert(diagnostic.range.start, '"'),
        TextEdit.insert(diagnostic.range.end, '"'),
      ],
    },
  );
}

function handleMissingDefinition(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction {
  // Create function definition with filename
  const functionName = pathToRelativeFunctionName(document.uri);
  const edit: TextEdit = {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    },
    newText: `function ${functionName}\n    # TODO: Implement function\nend\n`,
  };

  return {
    title: `Create function '${functionName}'`,
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

function handleFilenameMismatch(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction | undefined {
  const functionName = node.text;
  const newUri = document.uri.replace(/[^/]+\.fish$/, `${functionName}.fish`);
  if (document.getAutoloadType() !== 'functions') {
    return;
  }
  const oldName = document.getAutoLoadName();
  const oldFilePath = document.getFilePath();
  const oldFilename = document.getFilename();
  const newFilePath = uriToPath(newUri);

  const annotation = ChangeAnnotation.create(
    `rename ${oldFilename} to ${newUri.split('/').pop()}`,
    true,
    `Rename '${oldFilePath}' to '${newFilePath}'`,
  );

  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      RenameFile.create(document.uri, newUri, { ignoreIfExists: false, overwrite: true }),
    ],
    changeAnnotations: {
      [annotation.label]: annotation,
    },
  };

  return {
    title: `RENAME: '${oldFilename}' to '${functionName}.fish' (File missing function '${oldName}')`,
    kind: SupportedCodeActionKinds.RefactorRewrite,
    diagnostics: [diagnostic],
    edit: workspaceEdit,
  };
}

function handleCompletionFilenameMismatch(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction | undefined {
  const functionName = node.text;
  const newUri = document.uri.replace(/[^/]+\.fish$/, `${functionName}.fish`);
  if (document.getAutoloadType() !== 'completions') {
    return;
  }
  const oldName = document.getAutoLoadName();
  const oldFilePath = document.getFilePath();
  const oldFilename = document.getFilename();
  const newFilePath = uriToPath(newUri);

  const annotation = ChangeAnnotation.create(
    `rename ${oldFilename} to ${newUri.split('/').pop()}`,
    true,
    `Rename '${oldFilePath}' to '${newFilePath}'`,
  );

  const workspaceEdit: WorkspaceEdit = {
    documentChanges: [
      RenameFile.create(document.uri, newUri, { ignoreIfExists: false, overwrite: true }),
    ],
    changeAnnotations: {
      [annotation.label]: annotation,
    },
  };

  return {
    title: `RENAME: '${oldFilename}' to '${functionName}.fish' (File missing completion '${oldName}')`,
    kind: SupportedCodeActionKinds.RefactorRewrite,
    diagnostics: [diagnostic],
    edit: workspaceEdit,
  };
}
function handleReservedKeyword(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction {
  const replaceText = `__${node.text}`;

  const changeAnnotation = ChangeAnnotation.create(
    `rename ${node.text} to ${replaceText}`,
    true,
    `Rename reserved keyword function definition '${node.text}' to '${replaceText}' (line: ${node.startPosition.row + 1})`,
  );

  const workspaceEdit: WorkspaceEdit = {
    changes: {
      [document.uri]: [
        TextEdit.replace(getRange(node), replaceText),
      ],
    },
    changeAnnotations: {
      [changeAnnotation.label]: changeAnnotation,
    },
  };
  return {
    title: `Rename reserved keyword '${node.text}' to '${replaceText}' (line: ${node.startPosition.row + 1})`,
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    isPreferred: true,
    edit: workspaceEdit,
  };
}

function handleUnusedFunction(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction {
  // Find the entire function definition to remove
  let scopeNode = node;
  while (scopeNode && !isFunctionDefinition(scopeNode)) {
    scopeNode = scopeNode.parent!;
  }

  const changeAnnotation = ChangeAnnotation.create(
    `Removed unused function ${node.text}`,
    true,
    `Removed unused function '${node.text}', in file '${document.getFilePath()}'  (line: ${node.startPosition.row + 1} - ${node.endPosition.row + 1})`,
  );

  const workspaceEdit: WorkspaceEdit = {
    changes: {
      [document.uri]: [
        TextEdit.del(getRange(scopeNode)),
      ],
    },
    changeAnnotations: {
      [changeAnnotation.label]: changeAnnotation,
    },
  };

  return {
    title: `Remove unused function ${node.text} (line: ${node.startPosition.row + 1})`,
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: workspaceEdit,
  };
}

function handleAddEndStdinToArgparse(diagnostic: Diagnostic, document: LspDocument): CodeAction {
  const edit = TextEdit.insert(diagnostic.range.end, ' -- $argv');

  return {
    title: 'Add end stdin ` -- $argv` to argparse',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [edit],
      },
    },
    isPreferred: true,
  };
}

function handleConvertDeprecatedFishLsp(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction {
  // const value = document.getText(diagnostic.range);
  logger.log({ name: 'handleConvertDeprecatedFishLsp', diagnostic: diagnostic.range, node: node.text });

  const replaceText = node.text === 'fish_lsp_logfile' ? 'fish_lsp_log_file' : node.text;
  const edit = TextEdit.replace(diagnostic.range, replaceText);
  const workspaceEdit: WorkspaceEdit = {
    changes: {
      [document.uri]: [edit],
    },
  };
  return {
    title: 'Convert deprecated environment variable name',
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: workspaceEdit,
    isPreferred: true,
  };
}

export async function getQuickFixes(
  document: LspDocument,
  diagnostic: Diagnostic,
  analyzer: Analyzer,
): Promise<CodeAction[]> {
  if (!diagnostic.code) return [];

  logger.log({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    node: diagnostic.data.node.text,
    range: diagnostic.range,
  });

  let action: CodeAction | undefined;
  const actions: CodeAction[] = [];

  const root = analyzer.getRootNode(document.uri);
  let node = root;

  if (root) {
    node = getChildNodes(root).find(n =>
      n.startPosition.row === diagnostic.range.start.line &&
      n.startPosition.column === diagnostic.range.start.character);
  }
  logger.info('getQuickFixes', { code: diagnostic.code, message: diagnostic.message, node: node?.text });

  switch (diagnostic.code) {
    case ErrorCodes.missingEnd:
      action = handleMissingEndFix(document, diagnostic, analyzer);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.extraEnd:
      action = handleExtraEndFix(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.missingQuietOption:
      action = handleMissingQuietError(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.usedUnviersalDefinition:
      action = handleUniversalVariable(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.dotSourceCommand:
      action = handleDotSourceCommand(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.zeroIndexedArray:
      action = handleZeroIndexedArray(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.singleQuoteVariableExpansion:
      action = handleSingleQuoteVarFix(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.testCommandMissingStringCharacters:
      action = handleTestCommandVariableExpansionWithoutString(document, diagnostic);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.autoloadedFunctionMissingDefinition:
      if (!node) return [];
      return [handleMissingDefinition(diagnostic, node, document)];
    case ErrorCodes.autoloadedFunctionFilenameMismatch:
      if (!node) return [];
      action = handleFilenameMismatch(diagnostic, node, document);
      if (action) actions.push(action);
      return actions;
    case ErrorCodes.functionNameUsingReservedKeyword:
      if (!node) return [];
      return [handleReservedKeyword(diagnostic, node, document)];
    case ErrorCodes.unusedLocalFunction:
      if (!node) return [];
      return [handleUnusedFunction(diagnostic, node, document)];

    case ErrorCodes.autoloadedCompletionMissingCommandName:
      if (!node) return [];
      action = handleCompletionFilenameMismatch(diagnostic, node, document);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.argparseMissingEndStdin:
      action = handleAddEndStdinToArgparse(diagnostic, document);
      if (action) actions.push(action);
      return actions;

    case ErrorCodes.fishLspDeprecatedEnvName:
      if (!node) return [];
      return [handleConvertDeprecatedFishLsp(diagnostic, node, document)];

    default:
      return actions;
  }
}
