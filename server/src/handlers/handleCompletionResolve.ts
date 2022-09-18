import { CompletionItem } from 'vscode-languageserver-protocol/node'
import {
  enrichWithDocumentation,
  enrichWithSymbolInfo,
  UserDefinedDataEntry,
} from '../completion'
import { Context } from '../interfaces'

export function getCompletionResolveHandler(context: Context) {
  const { trees, docs } = context

  return function handleCompletionResolve(item: CompletionItem): CompletionItem {
    if (typeof item.data === 'string') {
      enrichWithDocumentation(item, docs)
    } else if (item.data?.type === 'user_defined') {
      const { symbolInfo } = item.data as UserDefinedDataEntry
      enrichWithSymbolInfo(item, trees[symbolInfo.location.uri])
    }

    return item
  }
}
