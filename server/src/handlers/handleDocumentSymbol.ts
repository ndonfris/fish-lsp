import { DocumentSymbolParams, SymbolInformation } from 'vscode-languageserver/node'
import { Context } from '../interfaces'

export function getDocumentSymbolHandler(context: Context) {
  const { symbols } = context

  return function handleDocumentSymbol(
    params: DocumentSymbolParams,
  ): SymbolInformation[] {
    return [...symbols[params.textDocument.uri].values()].flat()
  }
}
