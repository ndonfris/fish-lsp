import { Command, ApplyWorkspaceEditParams, CodeActionParams, DocumentFormattingParams, DocumentRangeFormattingParams, FormattingOptions, HoverParams, Position, RenameParams, RequestType, TextDocumentIdentifier, TextDocumentPositionParams, WorkspaceEdit, Range, CodeActionContext, _Connection, _, ServerCapabilities } from 'vscode-languageserver';
import { ExecuteCommandParams, ServerRequestHandler } from 'vscode-languageserver';

export const Commands = {
  APPLY_REFACTORING: 'applyRefactoring',
  SELECT_REFACTORING: 'selectRefactoring',
  APPLY_WORKSPACE_EDIT: 'applyWorkspaceEdit',
  RENAME: 'rename',
  HOVER: 'hover',
  CODE_ACTION: 'codeAction',
  FORMAT: 'format',
  FORMAT_RANGE: 'formatRange',
  INLINE_CODELENS: 'inlineCodelens',
};

export enum CommandTypes {
  APPLY_REFACTORING = 'applyRefactoring',
  SELECT_REFACTORING = 'selectRefactoring',
  APPLY_WORKSPACE_EDIT = 'applyWorkspaceEdit',
  RENAME = 'rename',
  RENAME_FILE = 'renameFile',
  HOVER = 'hover',
  CODE_ACTION = 'codeAction',
  FORMAT = 'format',
  FORMAT_RANGE = 'formatRange',
  INLINE_CODELENS = 'inlineCodelens',
}

export const commands: Record<CommandTypes, Command> = {
  [CommandTypes.APPLY_REFACTORING]: {
    title: 'applyRefactoring',
    command: 'editor.action.refactor',
  },
  [CommandTypes.SELECT_REFACTORING]: {
    title: 'selectRefactoring',
    command: 'editor.action.selectRefactoring',
  },
  [CommandTypes.APPLY_WORKSPACE_EDIT]: {
    title: 'applyWorkspaceEdit',
    command: 'editor.action.applyWorkspaceEdit',
  },
  [CommandTypes.RENAME]: {
    title: 'rename',
    command: 'editor.action.rename',
  },
  [CommandTypes.RENAME_FILE]: {
    title: 'rename file',
    //command: 'workspace.renameCurrentFile',
    command: 'editor.action.renameCurrentFile',
  },
  [CommandTypes.HOVER]: {
    title: 'hover',
    command: 'editor.action.hover',
  },
  [CommandTypes.CODE_ACTION]: {
    title: 'codeAction',
    command: 'editor.action.codeAction',
  },
  [CommandTypes.FORMAT]: {
    title: 'format',
    command: 'editor.action.format',
  },
  [CommandTypes.FORMAT_RANGE]: {
    title: 'formatRange',
    command: 'editor.action.formatRange',
  },
  [CommandTypes.INLINE_CODELENS]: {
    title: 'inlineCodelens',
    command: 'editor.action.inlineCodelens',
  },
};

export namespace FishRenameRequest {
  export const type = new RequestType<TextDocumentPositionParams, void, void>('rename');
}

export namespace CommandParams {

  export function isRenameParams(paramArgs: unknown | RenameParams): paramArgs is RenameParams {
    const { newName, position, textDocument, workDoneToken } = paramArgs as RenameParams;
    return typeof newName === 'string' && Position.is(position) && TextDocumentIdentifier.is(textDocument.uri);
  }

  export function isApplyWorkspaceEditParams(paramArgs: unknown | ApplyWorkspaceEditParams): paramArgs is ApplyWorkspaceEditParams {
    const { edit, label } = paramArgs as ApplyWorkspaceEditParams;
    return WorkspaceEdit.is(edit) && typeof label === 'string';
  }

  export function isRefactoringParams(paramArgs: unknown | ApplyWorkspaceEditParams): paramArgs is ApplyWorkspaceEditParams {
    const { edit, label } = paramArgs as ApplyWorkspaceEditParams;
    return WorkspaceEdit.is(edit) && typeof label === 'string';
  }

  /**
     * works for HoverParams, CompletionParams, DefinitionParams
     *
     * @param {Object | TextDocumentPositionParams} paramsArgs - the params to check
     *
     *
     * @returns {boolean} - true if the params are for a TextDocumentPositionParams
     */
  export function isTextDocumentPositionParams(paramArgs: unknown | TextDocumentPositionParams): paramArgs is TextDocumentPositionParams {
    const { textDocument, position } = paramArgs as TextDocumentPositionParams;
    if (!textDocument.uri) {
      return false;
    }
    return TextDocumentIdentifier.is(textDocument.uri) && Position.is(position);
  }

  export function isHoverParams(paramArgs: unknown | HoverParams): paramArgs is HoverParams {
    const { textDocument, position } = paramArgs as HoverParams;
    if (!textDocument.uri) {
      return false;
    }
    return TextDocumentIdentifier.is(textDocument.uri) && Position.is(position);
  }

  export function isDocumentFormattingParams(paramArgs: unknown | DocumentFormattingParams): paramArgs is DocumentFormattingParams {
    const { textDocument, options } = paramArgs as DocumentFormattingParams;
    return TextDocumentIdentifier.is(textDocument.uri) && FormattingOptions.is(options);
  }

  export function isDocumentRangeFormattingParams(params: unknown | DocumentRangeFormattingParams): params is DocumentRangeFormattingParams {
    const { textDocument, options, range } = params as DocumentRangeFormattingParams;
    return TextDocumentIdentifier.is(textDocument.uri) && FormattingOptions.is(options) && range !== undefined;
  }

  export function isOnCodeActionParams(params: unknown | CodeActionParams): params is CodeActionParams {
    const { textDocument, context, range } = params as CodeActionParams;
    return TextDocumentIdentifier.is(textDocument.uri) && CodeActionContext.is(context) && Range.is(range);
  }
  //export function is

}

//export interface ConnectionEventHandler {
//    register: (connection: _Connection<_, _, _, _, _, _, _>) => void;
//    capabilities?: ServerCapabilities<any>;
//    experimentalCapabilities?: any;
//}
//
//export const executeCommandHandler : ConnectionEventHandler = {
//    register: function (connection: _Connection<_, _, _, _, _, _, _>): void {
//
//        connection.onExecuteCommand(onExecuteCommand);
//    },
//    capabilities: {
//
//        executeCommandProvider: {
//            commands: [
//                //"64tass.assembleAndViewInList"
//            ]
//        }
//    }
//};
//
//const onExecuteCommand: ServerRequestHandler<ExecuteCommandParams, any | undefined | null, never, void> =
//async function(params, token, workDoneProgress, resultProgress) {
//
//    console.log("Execute Command: ", params);
//};

