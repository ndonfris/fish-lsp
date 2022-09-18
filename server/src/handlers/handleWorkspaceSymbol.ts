import { SymbolInformation, WorkspaceSymbolParams } from 'vscode-languageserver/node'
import { Context } from '../interfaces'

export function getWorkspaceSymbolHandler(context: Context) {
  const { symbols } = context

  return function handleWorkspaceSymbol(
    params: WorkspaceSymbolParams,
  ): SymbolInformation[] {
    const result: SymbolInformation[] = []
    const symbolBuckets = Object.values(symbols)

    for (const sb of symbolBuckets) {
      const matchedNames: string[] = []

      for (const name of sb.keys()) {
        if (name.includes(params.query)) matchedNames.push(name)
      }

      result.push(...matchedNames.flatMap((n) => sb.get(n) || []))
    }

    return result
  }
}
