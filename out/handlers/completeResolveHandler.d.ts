import { CompletionItem } from 'vscode-languageserver-protocol/node';
import { Context } from '../interfaces';
export declare function getCompletionResolveHandler(context: Context): (item: CompletionItem) => Promise<CompletionItem>;
//# sourceMappingURL=completeResolveHandler.d.ts.map