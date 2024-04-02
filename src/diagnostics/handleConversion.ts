import {
  CodeAction,
  CodeActionKind,
  Command,
  Diagnostic,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { Commands } from '../commands';
import { LspDocument } from '../document';
import { getNodeAtRange } from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';

export function handleConversionToCodeAction(
  diagnostic: Diagnostic,
  rootNode: SyntaxNode,
  document: LspDocument,
): CodeAction | null {
  const node = getNodeAtRange(rootNode, diagnostic.range);
  switch (diagnostic.code) {
    case errorCodes.privateHelperFunction:
      return {
        title: `Convert '${node!.text}' to private function`,
        edit: {
          changes: {
            [document.uri]: [
              {
                range: diagnostic.range,
                newText:
                                    '__' +
                                    getNodeAtRange(rootNode, diagnostic.range)!
                                      .text,
              },
            ],
          },
        },
        diagnostics: [diagnostic],
        kind: 'quickfix',
      };
    case errorCodes.missingAutoloadedFunctionName:
      return {
        title: `change function '${
          node!.text
        }' to '${document.getAutoLoadName()}'`,
        edit: {
          changes: {
            [document.uri]: [
              {
                range: diagnostic.range,
                newText: document.getAutoLoadName(),
              },
            ],
          },
        },
        diagnostics: [diagnostic],
        kind: 'quickfix',
      };
    case errorCodes.duplicateFunctionName:
      return {
        title: `change duplicate function name '${node!.text}'`,
        diagnostics: [diagnostic],
        command: Command.create(
          'source.rename.function',
          'rename',
          document.uri,
          {
            Position: {
              line: diagnostic.range.start.line,
              character: diagnostic.range.start.character,
            },
          },
        ),
        kind: 'source.rename.function',
      };
    case errorCodes.extraEnd:
      return {
        title: 'remove extra end',
        diagnostics: [diagnostic],
        kind: 'source.quickfix.removeEnd',
        edit: {
          changes: {
            [document.uri]: [
              {
                range: diagnostic.range,
                newText: '',
              },
            ],
          },
        },
      };
    case errorCodes.missingEnd:
      return {
        title: 'add missing end',
        edit: {
          changes: {
            [document.uri]: [
              {
                range: diagnostic.range,
                newText: `${node!.text}\nend`,
              },
            ],
          },
        },
        diagnostics: [diagnostic],
        kind: 'source.quickfix.addEnd',
      };
    case errorCodes.universalVariable:
      return {
        title: `change universal variable '${node!.text}'`,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [document.uri]: [
              {
                range: diagnostic.range,
                newText: node!.text === '--universal' ?
                  '--global --export' : '-gx',
              },
            ],
          },
        },
      };
    default:
      return null;
  }
}

function createCodeAction(title: string, diagnostic: Diagnostic, document: LspDocument, nodeEdit: SyntaxNode, kind?: CodeActionKind) : CodeAction {
  return {
    title: title,
    edit: {
      changes: {
        [document.uri]: [
          {
            range: diagnostic.range,
            newText: nodeEdit.text,
          },
        ],
      },
    },
    diagnostics: [diagnostic],
    kind: kind,
  };
}
