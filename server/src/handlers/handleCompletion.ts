import {
  CompletionItem,
  Position,
  SymbolInformation,
  TextDocumentPositionParams,
} from 'vscode-languageserver-protocol/node'
import { getPredefinedCompletionItems, symbolInfoToCompletionItem } from '../completion'
import { Context, NamespaceMap } from '../interfaces'
import { isPositionWithinRange } from '../utils'

function notNamespace(symbolInfo: SymbolInformation): boolean {
  return !!symbolInfo.containerName
}

function getNamespaceUnderCursor(namespaces: NamespaceMap, position: Position): string {
  for (const [ns, range] of [...namespaces]) {
    if (isPositionWithinRange(position, range)) return ns
  }

  return 'awk'
}

export function getCompletionHandler(context: Context) {
  const { symbols, namespaces, dependencies } = context

  return function handleCompletion(params: TextDocumentPositionParams): CompletionItem[] {
    const { textDocument, position } = params
    const namespaceUnderCursor = getNamespaceUnderCursor(
      namespaces[textDocument.uri],
      position,
    )

    const allDeps = dependencies.getAllBreadthFirst(params.textDocument.uri)
    const allSymbols = [...allDeps]
      .filter((uri) => symbols[uri])
      .flatMap((uri) => [...symbols[uri].values()].flat())
      .filter(notNamespace)

    return allSymbols
      .map((si) => symbolInfoToCompletionItem(si, namespaceUnderCursor))
      .concat(getPredefinedCompletionItems())
  }
}
