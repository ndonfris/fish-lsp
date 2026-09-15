import { Command, Position, Range, TextEdit } from 'vscode-languageserver';
import { cloneCompletionItem, FishCompletionItem } from './types';
import { StaticItems } from './static-items';
import { DIAGNOSTIC_COMMENT_REGEX, DiagnosticAction, isValidErrorCode } from '../../diagnostics/comments-handler';
import { ErrorCodes } from '../../diagnostics/error-codes';

/** retrigger completion after inserting a directive, so its codes are suggested next */
const retriggerCommand: Command = {
  title: 'Suggest',
  command: 'editor.action.triggerSuggest',
};

/**
 * Completions for a comment line: shebangs (first line only), `# @fish-lsp-*`
 * directives, and the diagnostic codes a directive has not listed yet.
 */
export function buildCommentCompletions(line: string, position: Position): FishCompletionItem[] {
  // replace from the `#` character to the cursor
  const range = Range.create(Position.create(position.line, line.indexOf('#')), position);
  const completions: FishCompletionItem[] = [];

  if (position.line === 0) {
    completions.push(...(StaticItems.shebang ?? []).map((staticItem) => {
      const item = cloneCompletionItem(staticItem);
      item.textEdit = TextEdit.replace(range, item.label);
      return item;
    }));
  }

  const diagnosticComment = getCommentDiagnostics(line, position.line);
  if (!diagnosticComment) {
    completions.push(...(StaticItems.comment ?? []).map((staticItem) => {
      const item = cloneCompletionItem(staticItem);
      item.textEdit = TextEdit.replace(range, `${item.label} `);
      item.command = retriggerCommand;
      return item;
    }));
  } else {
    // `# @fish-lsp-disable 1001 <TAB>` → remaining codes
    const codeStrings = diagnosticComment.codes.map(code => code.toString());
    completions.push(...(StaticItems.diagnostic ?? [])
      .filter(staticItem => !codeStrings.includes(staticItem.label))
      .map((staticItem) => {
        const item = cloneCompletionItem(staticItem);
        item.command = retriggerCommand;
        item.insertText = `${item.label} `;
        return item;
      }));
  }

  return completions;
}

function getCommentDiagnostics(line: string, lineNumber: number) {
  const match = line.trim().match(DIAGNOSTIC_COMMENT_REGEX);
  if (!match) return null;

  const [, action, nextLine, codesStr] = match;

  const codeStrings = codesStr ? codesStr.trim().split(/\s+/) : [];

  // Parse the diagnostic codes if present
  const parsedCodes = codeStrings
    .map(codeStr => parseInt(codeStr, 10))
    .filter(code => !isNaN(code));

  const validCodes: ErrorCodes.CodeTypes[] = [];
  const invalidCodes: string[] = [];

  codeStrings.forEach((codeStr, idx) => {
    const code = parsedCodes[idx];
    if (code && !isNaN(code) && isValidErrorCode(code)) {
      validCodes.push(code as ErrorCodes.CodeTypes);
    } else {
      invalidCodes.push(codeStr);
    }
  });

  return {
    action: action as DiagnosticAction,
    target: nextLine ? 'next-line' : 'line',
    codes: validCodes,
    lineNumber: lineNumber,
    invalidCodes: invalidCodes.length > 0 ? invalidCodes : undefined,
  };
}
