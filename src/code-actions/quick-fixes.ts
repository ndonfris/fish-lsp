import { CodeAction, Diagnostic, TextEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { ErrorCodes } from '../diagnostics/errorCodes';
import { getChildNodes } from '../utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorNodeTypes } from '../diagnostics/node-types';
import { SupportedCodeActionKinds } from './action-kinds';
import { logger } from '../logger';
import { Analyzer } from '../analyze';

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
  const root = analyzer.getTree(document)!.rootNode;
  logger.log('endDiag', diagnostic.range);
  // if (!root) return undefined;

  const errNode = root.descendantForPosition({ row: diagnostic.range.start.line, column: diagnostic.range.start.character })!;

  const err = root!.childForFieldName('ERROR')!;
  const toSearch = getChildNodes(err).find(node => node.isError)!;
  logger.log('toSearch', toSearch.text);
  logger.log('errorNodeToken', err.text);

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

// export function handleQuietOptionFix(
//   document: LspDocument,
//   diagnostic: Diagnostic,
// ): CodeAction {
//   const node: SyntaxNode = diagnostic.data.node;
//   // // Add -q flag after the command name
//   // let nodeRange = getRange(node);
//   // if (node.firstChild && node.firstChild?.text === 'string') {
//   //   nodeRange = getRange(node.firstChild.nextSibling!);
//   // }
//   const edit = TextEdit.insert(
//     diagnostic.range.end,
//     ' -q',
//   );
//
//   return createQuickFix(
//     'Add quiet flag (-q)',
//     diagnostic,
//     {
//       [document.uri]: [edit]
//     }
//   );
// }

// Handle missing quiet option error
function handleMissingQuietError(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  // Add -q flag
  const edit = TextEdit.insert(
    diagnostic.range.end,
    ' -q ',
  );

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

export function getQuickFixes(
  document: LspDocument,
  diagnostic: Diagnostic,
  analyzer: Analyzer,
): CodeAction | undefined {
  if (!diagnostic.code) return undefined;
  logger.log({ code: diagnostic.code, message: diagnostic.message, severity: diagnostic.severity, node: diagnostic.data.node.text, range: diagnostic.range });
  switch (diagnostic.code) {
    case ErrorCodes.missingEnd:
      return handleMissingEndFix(document, diagnostic, analyzer);

    case ErrorCodes.extraEnd:
      return handleExtraEndFix(document, diagnostic);

    case ErrorCodes.missingQuietOption:
      return handleMissingQuietError(document, diagnostic);

    case ErrorCodes.usedUnviersalDefinition:
      return handleUniversalVariable(document, diagnostic);

    case ErrorCodes.zeroIndexedArray:
      return handleZeroIndexedArray(document, diagnostic);

    case ErrorCodes.singleQuoteVariableExpansion:
      return handleSingleQuoteVarFix(document, diagnostic);

    case ErrorCodes.testCommandMissingStringCharacters:
      return handleTestCommandVariableExpansionWithoutString(document, diagnostic);

    default:
      return undefined;
  }
}
