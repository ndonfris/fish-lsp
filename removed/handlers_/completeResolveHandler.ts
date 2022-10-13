import {CompletionItem} from 'vscode-languageserver-protocol/node'; 
import {Context} from '../interfaces';




export function getCompletionResolveHandler(context: Context) {

    const { completion, analyzer, trees } = context

    return async function handleCompletionResolver(item: CompletionItem) {
        return item
    }


}
