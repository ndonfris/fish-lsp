import {ApplyWorkspaceEditParams, CodeActionParams, DocumentFormattingParams, DocumentRangeFormattingParams, FormattingOptions, HoverParams, Position, RenameParams, RequestType, TextDocumentIdentifier, TextDocumentPositionParams, WorkspaceEdit, Range, CodeActionContext, _Connection, _, ServerCapabilities} from 'vscode-languageserver';
import { ExecuteCommandParams, ServerRequestHandler, } from "vscode-languageserver";

export const Commands = {
    APPLY_REFACTORING: 'applyRefactoring',
    SELECT_REFACTORING: 'selectRefactoring',
    APPLY_WORKSPACE_EDIT: 'applyWorkspaceEdit',
    RENAME: 'rename',
    HOVER: 'hover',
    CODE_ACTION: 'codeAction',
    FORMAT: 'format',
    FORMAT_RANGE: 'formatRange',
    //APPLY_REFACTORING: '_fish.applyRefactoring',
    //SELECT_REFACTORING: '_fish.selectRefactoring',
    //APPLY_WORKSPACE_EDIT: '_fish.applyWorkspaceEdit',
    //RENAME: '_fish.rename',
}


export namespace FishRenameRequest {
    export const type = new RequestType<TextDocumentPositionParams, void, void>('rename');
}

export namespace CommandParams {

    export function isRenameParams(paramArgs: Object | RenameParams): paramArgs is RenameParams {
        const { newName, position, textDocument, workDoneToken } = paramArgs as RenameParams;
        return typeof newName === 'string' && Position.is(position) && TextDocumentIdentifier.is(textDocument.uri);
    }

    export function isApplyWorkspaceEditParams(paramArgs: Object | ApplyWorkspaceEditParams): paramArgs is ApplyWorkspaceEditParams {
        const { edit, label } = paramArgs as ApplyWorkspaceEditParams;
        return WorkspaceEdit.is(edit) && typeof label === 'string';
    }

    export function isRefactoringParams(paramArgs: Object | ApplyWorkspaceEditParams): paramArgs is ApplyWorkspaceEditParams {
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
    export function isTextDocumentPositionParams(paramArgs: Object | TextDocumentPositionParams): paramArgs is TextDocumentPositionParams {
        const { textDocument, position } = paramArgs as TextDocumentPositionParams;
        if (!textDocument.uri) return false;
        return TextDocumentIdentifier.is(textDocument.uri) && Position.is(position);
    }

    export function isHoverParams(paramArgs: Object | HoverParams): paramArgs is HoverParams {
        const { textDocument, position } = paramArgs as HoverParams;
        if (!textDocument.uri) return false;
        return TextDocumentIdentifier.is(textDocument.uri) && Position.is(position);
    }

    export function isDocumentFormattingParams(paramArgs: Object |  DocumentFormattingParams): paramArgs is DocumentFormattingParams {
        const { textDocument, options } = paramArgs as DocumentFormattingParams;
        return TextDocumentIdentifier.is(textDocument.uri) && FormattingOptions.is(options)
    }

    export function isDocumentRangeFormattingParams(params: Object |  DocumentRangeFormattingParams): params is  DocumentRangeFormattingParams {
        const { textDocument, options, range } = params as  DocumentRangeFormattingParams;
        return TextDocumentIdentifier.is(textDocument.uri) && FormattingOptions.is(options) && range !== undefined;
    }

    export function isOnCodeActionParams(params: Object |  CodeActionParams): params is CodeActionParams {
        const { textDocument, context, range } = params as  CodeActionParams;
        return TextDocumentIdentifier.is(textDocument.uri) &&  CodeActionContext.is(context) && Range.is(range);
    }


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

