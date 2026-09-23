import { ChangeAnnotation, CodeAction, Diagnostic, Position, RenameFile, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { ErrorCodes } from '../diagnostics/error-codes';
import { equalRanges, getChildNodes } from '../utils/tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorNodeTypes, findMissingClosers, findUnclosedBlocks, getFishBuiltinEquivalentCommandName, hasMissingClosingToken, isFishStatusDeprecatedFlag, isTestBracketWithoutClose } from '../diagnostics/node-types';
import { SupportedCodeActionKinds } from './action-kinds';
import { logger } from '../logger';
import { analyzer, Analyzer } from '../analyze';
import { getRange } from '../utils/tree-sitter';
import { pathToRelativeFunctionName, uriToPath, uriToReadablePath } from '../utils/translation';
import { FishString } from '../parsing/string';
import { findParentCommand, isAliasDefinitionName, isArgparseVariableDefinitionName, isConditionalCommand, isFunctionDefinition, isFunctionDefinitionName, isVariableDefinitionName } from '../utils/node-types';
import { StatusArgs } from '../diagnostics/deprecated-flags';
import { CommandNames } from '../command';
import { server } from '../server';
import { configHandlers } from '../config';

/**
 * These quick-fixes are separated from the other diagnostic quick-fixes because
 * future work will involve adding significantly more complex
 * solutions here (atleast I hope. I definitely think fish uniquely has a lot
 * of potential for how advanced quick-fixes could become eventually).
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
  const diagnosticStarts = new Map<TextEdit, Position>();
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
        // Check each edit individually for duplicates
        // Only skip if both range AND content are identical
        for (const newEdit of edits) {
          const isDuplicate = oldEdits.some(e =>
            equalRanges(e.range, newEdit.range) && e.newText === newEdit.newText,
          );
          if (!isDuplicate) {
            oldEdits.push(newEdit);
            const start = action.diagnostics?.[0]?.range.start;
            if (start) diagnosticStarts.set(newEdit, start);
          }
        }
        resultEdits[uri] = oldEdits;
        diagnostics.push(...action.diagnostics || []);
      }
    }
  }
  // Inserts at one position land in array order. Closers sharing a position
  // come from nested openers, so the innermost (latest diagnostic) goes first.
  const compare = (a?: Position, b?: Position) => a && b ? a.line - b.line || a.character - b.character : 0;
  for (const uri in resultEdits) {
    resultEdits[uri]!.sort((a, b) => compare(a.range.start, b.range.start) || compare(diagnosticStarts.get(b), diagnosticStarts.get(a)));
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
 * Improved to handle all opening tokens defined in ErrorNodeTypes
 */
function getErrorNodeToken(node: SyntaxNode): string | undefined {
  const { text, type } = node;

  // Handle exact node type matches first (most reliable)
  if (type in ErrorNodeTypes) {
    return ErrorNodeTypes[type as keyof typeof ErrorNodeTypes];
  }

  // For ERROR nodes, we need to look at the actual content to determine the token
  if (type === 'ERROR') {
    // Look for unclosed quotes at the end of the text
    if (text.endsWith('"') && !text.startsWith('"')) {
      return '"';
    }
    if (text.endsWith("'") && !text.startsWith("'")) {
      return "'";
    }
    // Look for unclosed quotes at the beginning
    if (text.includes('"') && text.indexOf('"') === text.lastIndexOf('"')) {
      return '"';
    }
    if (text.includes("'") && text.indexOf("'") === text.lastIndexOf("'")) {
      return "'";
    }
  }

  // Handle single character tokens that might be embedded in text
  const singleCharTokens = ['"', "'", '{', '[', '('];
  for (const token of singleCharTokens) {
    if (text.includes(token)) {
      // Check if it's an unclosed token by counting occurrences
      let matches = 0;
      if (token === '"') {
        matches = (text.match(/"/g) || []).length;
      } else if (token === "'") {
        matches = (text.match(/'/g) || []).length;
      } else {
        matches = (text.match(new RegExp(`\\${token}`, 'g')) || []).length;
      }

      if (matches % 2 === 1) { // Odd number means unclosed
        return ErrorNodeTypes[token as keyof typeof ErrorNodeTypes];
      }
    }
  }

  // Handle keyword tokens (function, while, if, for, begin, switch)
  const keywordTokens = ['function', 'while', 'if', 'for', 'begin', 'switch'];
  for (const token of keywordTokens) {
    // Check if the text starts with the keyword followed by whitespace or end of string
    const regex = new RegExp(`^${token}(?=\\s|$)`);
    if (regex.test(text)) {
      return ErrorNodeTypes[token as keyof typeof ErrorNodeTypes];
    }
  }

  // Fallback to original logic for any remaining cases
  const startTokens = Object.keys(ErrorNodeTypes);
  for (const token of startTokens) {
    if (text.startsWith(token)) {
      return ErrorNodeTypes[token as keyof typeof ErrorNodeTypes];
    }
  }

  return undefined;
}

const enclosingBlockTypes = [
  'function_definition', 'for_statement', 'while_statement', 'if_statement', 'begin_statement', 'switch_statement',
  'else_if_clause', 'else_clause', 'case_clause',
];

/**
 * The first blank line from `from` that separates commands of an unfinished
 * block, or undefined. Recovery often leaves only the opening keyword, so the
 * condition and body are grouped through the first blank line, rather than
 * closing the block immediately after that keyword.
 */
function findBlankLineForEnd(document: LspDocument, root: SyntaxNode, lines: string[], openerRow: number, from: number, to = lines.length): number | undefined {
  for (let line = from; line < to; line++) {
    if (!/^[\t ]*\r?$/.test(lines[line]!)) continue;
    const offset = document.offsetAt({ line, character: 0 });
    let containingNode: SyntaxNode | null = root.descendantForIndex(offset);
    // A blank line inside a parsed string or a complete nested block is not
    // a boundary between commands in the unfinished block. A block whose `end`
    // is indented unlike its keyword took an `end` meant for an outer block,
    // and a block or branch already open on the keyword's line holds it.
    let insideCompleteNode = false;
    while (containingNode && !containingNode.equals(root)) {
      const end = containingNode.lastChild;
      const misindentedBlock = end?.type === 'end' && containingNode.firstChild
        && end.startPosition.column !== (lines[containingNode.startPosition.row]!.match(/^[\t ]*/)?.[0].length ?? 0);
      const enclosesOpener = containingNode.startPosition.row <= openerRow && enclosingBlockTypes.includes(containingNode.type);
      if (containingNode.isNamed && containingNode.startIndex < offset && containingNode.endIndex > offset && !containingNode.hasError && !misindentedBlock && !enclosesOpener) {
        insideCompleteNode = true;
        break;
      }
      containingNode = containingNode.parent;
    }
    if (insideCompleteNode) continue;
    const previousNewline = root.descendantForIndex(Math.max(0, offset - 1));
    if (previousNewline.type === 'escape_sequence') continue;
    return line;
  }
  return undefined;
}

/**
 * Inserts the `end` of the block starting on `blocks[0].row`, indented like
 * it. `blocks` continues with the unclosed blocks nested in it, innermost
 * last: each one's `end` takes a blank line first, so this one goes after
 * theirs. A block whose enclosing block's `end` is on `beforeRow` closes
 * before that line. Past the last blank line, every `end` is inserted at the
 * end of the file; fix-all orders `end`s sharing a position innermost first.
 */
function missingEndEdit(document: LspDocument, root: SyntaxNode, blocks: { row: number; beforeRow?: number; }[]): TextEdit {
  const text = document.getText();
  const lines = text.split('\n');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = lines[blocks[0]!.row]!.match(/^[\t ]*/)?.[0] ?? '';
  // the blank line replaced with `end`, or the line `end` is inserted above;
  // neither means the end of the file
  let blankLine: number | undefined;
  let aboveLine: number | undefined;
  let after = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { row, beforeRow } = blocks[i]!;
    blankLine = after === Infinity ? undefined
      : findBlankLineForEnd(document, root, lines, row, Math.max(row + 1, after + 1), beforeRow);
    aboveLine = undefined;
    // the trailing empty line of a file ending in a newline is its end
    if (blankLine === lines.length - 1) blankLine = undefined;
    if (blankLine !== undefined) {
      after = blankLine;
    } else if (beforeRow !== undefined && after !== Infinity) {
      aboveLine = beforeRow;
      after = beforeRow;
    } else {
      after = Infinity;
    }
  }
  if (blankLine !== undefined) {
    const content = lines[blankLine]!.replace(/\r$/, '');
    return TextEdit.replace({ start: { line: blankLine, character: 0 }, end: { line: blankLine, character: content.length } }, `${indent}end`);
  }
  if (aboveLine !== undefined) {
    return TextEdit.insert({ line: aboveLine, character: 0 }, `${indent}end${newline}`);
  }
  if (/\n[\t ]*$/.test(text)) {
    return TextEdit.insert({ line: lines.length - 1, character: 0 }, `${indent}end${newline}`);
  }
  return TextEdit.insert(document.positionAt(text.length), `${newline}${indent}end`);
}

export function handleMissingEndFix(
  document: LspDocument,
  diagnostic: Diagnostic,
  analyzer: Analyzer,
): CodeAction | undefined {
  const root = analyzer.getTree(document.uri)!.rootNode;

  const recoveryNode = root.descendantForPosition(
    { row: diagnostic.range.start.line, column: diagnostic.range.start.character },
    { row: diagnostic.range.end.line, column: diagnostic.range.end.character },
  );
  // `[ -n "$str"` parsed as a command, so only its final argument is missing.
  // A lone `[` command spans the same range as its name word and `[` token.
  let testCommand: SyntaxNode | null = recoveryNode;
  while (testCommand && testCommand.startIndex === recoveryNode.startIndex && !isTestBracketWithoutClose(testCommand)) {
    testCommand = testCommand.parent;
  }
  if (testCommand && !isTestBracketWithoutClose(testCommand)) testCommand = null;
  if (testCommand) {
    return createQuickFix('Add missing "]"', diagnostic, {
      [document.uri]: [TextEdit.insert(document.positionAt(testCommand.endIndex), ' ]')],
    });
  }
  // `$var[1 2` above another line: recovery already marks where the closer goes
  const missingCloser = hasMissingClosingToken(recoveryNode) ? recoveryNode.children.find(child => child.isMissing) : undefined;
  if (missingCloser) {
    return createQuickFix(`Add missing "${missingCloser.type}"`, diagnostic, {
      [document.uri]: [TextEdit.insert(document.positionAt(missingCloser.startIndex), missingCloser.type)],
    });
  }
  // Each group of unclosed openers is its own diagnostic, anchored on them.
  // Find it again from the outermost ERROR node, as diagnostics do.
  let outermostError: SyntaxNode | null = null;
  for (let node: SyntaxNode | null = recoveryNode; node; node = node.parent) {
    if (node.isError) outermostError = node;
  }
  if (outermostError) {
    const start = document.offsetAt(diagnostic.range.start);
    const closer = findMissingClosers(outermostError, document).find(c => c.openers[0]!.startIndex === start);
    if (closer) {
      return createQuickFix(`Add missing "${closer.tokens}"`, diagnostic, {
        [document.uri]: [TextEdit.insert(document.positionAt(closer.offset), closer.newText)],
      });
    }
    // An unclosed block keyword: its `end` goes after those of the blocks inside it
    const blocks = findUnclosedBlocks(outermostError, document);
    const index = blocks.findIndex(({ keyword }) => keyword.startIndex === start);
    if (index !== -1) {
      return createQuickFix('Add missing "end"', diagnostic, {
        [document.uri]: [missingEndEdit(document, root, blocks.slice(index).map(({ keyword, beforeRow }) => ({ row: keyword.startPosition.row, beforeRow })))],
      });
    }
  }

  let errNode = root.descendantForPosition({ row: diagnostic.range.start.line, column: diagnostic.range.start.character })!;

  // If we found an ERROR node, try to find the specific error token within it
  if (errNode.type === 'ERROR') {
    // Use findErrorCause to get the specific problematic node
    const errorCause = findErrorCauseFromNode(errNode);
    if (errorCause) {
      errNode = errorCause;
    }
  }

  const rawErrorNodeToken = getErrorNodeToken(errNode);

  if (!rawErrorNodeToken) return undefined;

  if (rawErrorNodeToken === 'end') {
    return createQuickFix('Add missing "end"', diagnostic, {
      [document.uri]: [missingEndEdit(document, root, [{ row: errNode.startPosition.row }])],
    });
  }

  // Determine the appropriate insertion position and text based on token type
  const insertionData = getTokenInsertionData(errNode, rawErrorNodeToken);

  return {
    title: `Add missing "${rawErrorNodeToken}"`,
    diagnostics: [diagnostic],
    kind: SupportedCodeActionKinds.QuickFix,
    edit: {
      changes: {
        [document.uri]: [
          TextEdit.insert(insertionData.position, insertionData.text),
        ],
      },
    },
  };
}

/**
 * Find the specific error cause within an ERROR node
 */
function findErrorCauseFromNode(errorNode: SyntaxNode): SyntaxNode | null {
  // Look for unclosed quote tokens within the error node's children
  for (const child of errorNode.children) {
    if (child.type === '"' || child.type === "'" || child.text === '"' || child.text === "'") {
      return child;
    }
  }

  // If no specific token found, look at the text content
  const text = errorNode.text;
  if (text.includes('"') && text.indexOf('"') === text.lastIndexOf('"')) {
    return errorNode; // Return the error node itself
  }
  if (text.includes("'") && text.indexOf("'") === text.lastIndexOf("'")) {
    return errorNode; // Return the error node itself
  }

  return null;
}

/**
 * Determines the appropriate insertion position and text for different token types
 */
function getTokenInsertionData(errNode: SyntaxNode, closingToken: string): {
  position: { line: number; character: number; };
  text: string;
} {
  // Handle quotes (', ")
  if (closingToken === "'" || closingToken === '"') {
    // For quotes, add the closing quote immediately after the current position
    return {
      position: { line: errNode.endPosition.row, character: errNode.endPosition.column },
      text: closingToken,
    };
  }

  // Handle brackets, braces, parentheses (], }, ))
  if ([')', '}', ']'].includes(closingToken)) {
    // For brackets/braces/parens, add the closing token immediately after
    return {
      position: { line: errNode.endPosition.row, character: errNode.endPosition.column },
      text: closingToken,
    };
  }

  // Fallback case
  return {
    position: { line: errNode.endPosition.row, character: errNode.endPosition.column },
    text: closingToken,
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
    title: 'Add silence (-q) flag',
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

function handleExternalShellCommandInsteadOfBuiltin(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction | undefined {
  // Replace the command with an external shell command
  const node = analyzer.nodeAtPoint(document.uri, diagnostic.range.start.line, diagnostic.range.start.character);
  if (!node) {
    logger.warning('handleExternalShellCommandInsteadOfBuiltin: No node found for diagnostic', diagnostic);
    return undefined;
  }
  const newCommandText = getFishBuiltinEquivalentCommandName(node);
  if (!newCommandText) {
    logger.warning('handleExternalShellCommandInsteadOfBuiltin: No equivalent command found for', node.text);
    return undefined;
  }
  // Don't handle ambiguous commands
  if (newCommandText.includes(' | ')) {
    logger.warning('handleExternalShellCommandInsteadOfBuiltin: Command is ambiguous, skipping', newCommandText);
    return undefined;
  }
  const edit = TextEdit.replace(
    diagnostic.range,
    newCommandText,
  );

  return {
    title: `Convert external shell command "${node.text}" to fish builtin "${newCommandText}"`,
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
  const newText = text.replace(/\\/g, '\\\\').replace(/'/g, '"').replace(/\$/g, '\\$');

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
  const functionName = FishString.fromNode(node);
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

const getNodeType = (node: SyntaxNode) => {
  if (isFunctionDefinitionName(node)) {
    return 'function';
  }
  if (isArgparseVariableDefinitionName(node)) {
    return 'argparse';
  }
  if (isAliasDefinitionName(node)) {
    return 'alias';
  }
  if (isVariableDefinitionName(node)) {
    return 'variable';
  }
  return 'unknown';
};

function handleUnusedSymbol(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction | undefined {
  const nodeType = getNodeType(node);
  if (nodeType === 'unknown') return undefined;

  // Find the entire function definition to remove
  let scopeNode = node;
  while (scopeNode && !isFunctionDefinition(scopeNode)) {
    scopeNode = scopeNode.parent!;
  }

  if (nodeType === 'function') {
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
  if (nodeType === 'argparse') {
    const parentCommand = findParentCommand(node);
    if (!parentCommand) return undefined;

    const changeAnnotation = ChangeAnnotation.create(
      `Check if argparse variable ${node.text} is set`,
      true,
      `Check if argparse variable '${node.text}' is set, in file '${document.getFilePath()}'  (line: ${node.startPosition.row + 1})`,
    );

    const symbol = analyzer.getDefinition(document, diagnostic.range.end);
    if (!symbol) return undefined;

    const indent = document.getIndentAtLine(parentCommand.endPosition.row);
    const name = symbol.aliasedNames.length > 0
      ? symbol.aliasedNames.reduce((longest, current) => current.length > longest.length ? current : longest, '')
      : symbol.name;
    const insertText = [
      '\n',
      `if set -ql ${name}`,
      '    ',
      'end',
    ].map(line => `${indent}${line}`).join('\n');

    let parentNode = symbol.node;
    if (parentNode && parentNode.nextNamedSibling && isConditionalCommand(parentNode.nextNamedSibling)) {
      while (parentNode && parentNode.nextNamedSibling && isConditionalCommand(parentNode.nextNamedSibling)) {
        parentNode = parentNode.nextNamedSibling;
      }
    }

    const workspaceEdit: WorkspaceEdit = {
      changes: {
        [document.uri]: [
          TextEdit.insert(getRange(parentNode).end, insertText),
        ],
      },
      changeAnnotations: {
        [changeAnnotation.label]: changeAnnotation,
      },
    };
    return {
      title: `Use \`argparse ${node.text}\` variable '${name}' if it's set in '${symbol.parent?.name || uriToReadablePath(document.uri)}'`,
      kind: SupportedCodeActionKinds.QuickFix,
      diagnostics: [diagnostic],
      edit: workspaceEdit,
      isPreferred: true,
    };
  }
  return undefined;
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

export function handleConvertStatusFlagToSubcommand(diagnostic: Diagnostic, node: SyntaxNode, document: LspDocument): CodeAction | undefined {
  logger.log({ name: 'handleConvertStatusFlagToSubcommand', diagnostic: diagnostic.range, node: node.text });

  if (!isFishStatusDeprecatedFlag(node)) return undefined;
  const replaceText = StatusArgs.findSubcommandFromFlag(node.text);
  if (!replaceText) return undefined;
  const edit = TextEdit.replace(diagnostic.range, replaceText);
  const workspaceEdit: WorkspaceEdit = {
    changes: {
      [document.uri]: [edit],
    },
  };
  return {
    title: `Convert deprecated status flag '${node.text}' to subcommand '${replaceText}'`,
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
    case ErrorCodes.leadingConditionalOperator: {
      const operator = document.getText(diagnostic.range);
      if (operator !== '&&' && operator !== '||') return [];
      const replacement = operator === '&&' ? 'and' : 'or';
      return [createQuickFix(`Replace '${operator}' with '${replacement}'`, diagnostic, {
        [document.uri]: [TextEdit.replace(diagnostic.range, replacement)],
      })];
    }

    case ErrorCodes.missingOptionValue: {
      const option = document.getText(diagnostic.range);
      if (option !== '--description' && !/^-[^-]*d$/.test(option)) return [];
      const action = createQuickFix('Add an empty description', diagnostic, {
        [document.uri]: [TextEdit.insert(diagnostic.range.end, ' ""')],
      });
      // A standard WorkspaceEdit cannot contain snippet tabstops. Clients that
      // support showDocument can place the cursor after applying the edit.
      if (server?.clientSupportsShowDocument && configHandlers.executeCommand) {
        action.command = {
          title: 'Edit description',
          command: CommandNames.SELECT_QUICK_FIX_POSITION,
          arguments: [document.uri, { ...diagnostic.range.end, character: diagnostic.range.end.character + 2 }],
        };
      }
      return [action];
    }

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

    case ErrorCodes.usedExternalShellCommandWhenBuiltinExists:
      action = handleExternalShellCommandInsteadOfBuiltin(document, diagnostic);
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
    case ErrorCodes.unusedLocalDefinition:
      if (!node) return [];
      action = handleUnusedSymbol(diagnostic, node, document);
      if (action) actions.push(action);
      return actions;

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

    case ErrorCodes.fishStatusDeprecatedFlag:
      if (!node) return [];
      action = handleConvertStatusFlagToSubcommand(diagnostic, node, document);
      if (action) actions.push(action);
      return actions;

    default:
      return actions;
  }
}
