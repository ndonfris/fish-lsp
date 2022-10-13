import { TextDocumentPositionParams } from 'vscode-languageserver-protocol/node';
import { CompletionList } from 'vscode-languageserver/node';
import { Context } from '../interfaces';
export declare function getCompletionHandler(context: Context): Promise<(params: TextDocumentPositionParams) => Promise<CompletionList | null>>;
//# sourceMappingURL=completeHandler.d.ts.map