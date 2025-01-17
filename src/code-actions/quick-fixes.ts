import { CodeAction, Diagnostic, TextEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { ErrorCodes } from '../diagnostics/errorCodes';
import { getRange } from '../utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorNodeTypes } from '../diagnostics/node-types';
import { SupportedCodeActionKinds } from './action-kinds';

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
  document: LspDocument,
  diagnostic: Diagnostic,
  edits: TextEdit[],
): CodeAction {
  return {
    title,
    kind: SupportedCodeActionKinds.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: edits,
      },
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
): CodeAction | undefined {
  const rawErrorNodeToken = getErrorNodeToken(diagnostic.data.node);

  if (!rawErrorNodeToken) return undefined;

  const endTokenWithNewline = rawErrorNodeToken === 'end' ? '\nend' : rawErrorNodeToken;
  return createQuickFix(
    `Add missing "${rawErrorNodeToken}"`,
    document,
    diagnostic,
    [TextEdit.insert(diagnostic.range.end, endTokenWithNewline)],
  );
}

export function handleExtraEndFix(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  // Simply delete the extra end
  const edit = TextEdit.del(diagnostic.range);

  return createQuickFix(
    'Remove extra "end"',
    document,
    diagnostic,
    [edit],
  );
}

export function handleQuietOptionFix(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  const node = diagnostic.data.node;
  // Add -q flag after the command name
  let nodeRange = getRange(node);
  if (node.firstChild && node.firstChild?.text === 'string') {
    nodeRange = getRange(node.firstChild.nextSibling!);
  }
  const edit = TextEdit.insert(
    nodeRange.end,
    ' -q',
  );

  return createQuickFix(
    'Add quiet flag (-q)',
    document,
    diagnostic,
    [edit],
  );
}

export function handleSingleQuoteVarFix(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  const node = diagnostic.data.node;
  // Replace single quotes with double quotes
  const text = node.text;
  const newText = text.replace(/'/g, '"');

  const edit = TextEdit.replace(
    diagnostic.range,
    newText,
  );

  return createQuickFix(
    'Convert to double quotes',
    document,
    diagnostic,
    [edit],
  );
}

export function handleTestCommandVariableExpansionWithoutString(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  return createQuickFix(
    'Surround test string comparison with double quotes',
    document,
    diagnostic,
    [
      TextEdit.insert(diagnostic.range.start, '"'),
      TextEdit.insert(diagnostic.range.end, '"'),
    ],
  );
}

export function getQuickFixes(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  switch (diagnostic.code) {
    case ErrorCodes.missingEnd:
      return handleMissingEndFix(document, diagnostic);

    case ErrorCodes.extraEnd:
      return handleExtraEndFix(document, diagnostic);

    case ErrorCodes.missingQuietOption:
      return handleQuietOptionFix(document, diagnostic);

    case ErrorCodes.singleQuoteVariableExpansion:
      return handleSingleQuoteVarFix(document, diagnostic);

    case ErrorCodes.testCommandMissingStringCharacters:
      return handleTestCommandVariableExpansionWithoutString(document, diagnostic);

    default:
      return undefined;
  }
}
