import {RequestType, TextDocumentPositionParams} from 'vscode-languageserver';


export const Commands = {
    APPLY_REFACTORING: 'applyRefactoring',
    SELECT_REFACTORING: 'selectRefactoring',
    APPLY_WORKSPACE_EDIT: 'applyWorkspaceEdit',
    RENAME: 'rename',
    //APPLY_REFACTORING: '_fish.applyRefactoring',
    //SELECT_REFACTORING: '_fish.selectRefactoring',
    //APPLY_WORKSPACE_EDIT: '_fish.applyWorkspaceEdit',
    //RENAME: '_fish.rename',
}


export namespace FishRenameRequest {
    export const type = new RequestType<TextDocumentPositionParams, void, void>('_fish.rename');
}





