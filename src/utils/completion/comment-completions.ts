import { Command, Position, Range, TextEdit } from 'vscode-languageserver';
import { FishCommandCompletionItem, FishCompletionData } from './types';
import { StaticItems } from './static-items';
import { SyntaxNode } from 'web-tree-sitter';
import { DIAGNOSTIC_COMMENT_REGEX, DiagnosticAction, isValidErrorCode } from '../../diagnostics/comments-handler';
import { FishCompletionList } from './list';
import { SetupData } from './pager';
import { ErrorCodes } from '../../diagnostics/error-codes';

export function buildCommentCompletions(
  line: string,
  position: Position,
  node: SyntaxNode,
  data: SetupData,
  word: string,
) {
  // FishCompletionItem.createData(data.uri, line,  ,detail, documentation)
  const hashIndex = line.indexOf('#');

  // Create range from the # character to cursor
  const range = Range.create(
    Position.create(position.line, hashIndex),
    position,
  );

  // Command to retrigger completion
  const retriggerCommand: Command = {
    title: 'Suggest',
    command: 'editor.action.triggerSuggest',
  };

  const completions: FishCommandCompletionItem[] = [];

  if (position.line === 0) {
    completions.push(
      ...StaticItems.shebang.map(item => {
        item.textEdit = TextEdit.replace(range, item.label);
        return item;
      }),
    );
  }

  /**
   * add diagnostic comment strings:
   * `# @fish-lsp-disable`
   */
  const diagnosticComment = getCommentDiagnostics(line, position.line);
  if (!diagnosticComment) {
    completions.push(
      ...StaticItems.comment.map((item) => {
        item.textEdit = TextEdit.replace(range, `${item.label} `);
        item.command = retriggerCommand;
        return item;
      }));
  }

  /**
   * add diagnostic codes to the completion list
   * `# @fish-lsp-disable 1001`
   */
  if (diagnosticComment) {
    if (diagnosticComment?.codes) {
      const codeStrings = diagnosticComment?.codes.map(code => code.toString());
      completions.push(
        ...StaticItems.diagnostic
          .filter(item => !codeStrings.includes(item.label))
          .map((item) => {
            item.command = retriggerCommand;
            item.insertText = `${item.label} `;
            return item;
          }),
      );
    }
  }
  const completionData: FishCompletionData = {
    word,
    position,
    uri: data.uri,
    line,
  };

  return FishCompletionList.create(false, completionData, completions);
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
