import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver'
import { getFunctionName, getNamespace, getRange } from '../utils'
import { ValidationContext } from './validator'

function isSameRange(range1: Range, range2: Range): boolean {
  return (
    range1.start.line === range2.start.line &&
    range1.start.character === range2.start.character &&
    range1.end.line === range2.end.line &&
    range1.end.character === range2.end.character
  )
}

export function validateNameCollision(context: ValidationContext): Diagnostic | null {
  const { node, dependencies, symbols, namespaces, uri } = context

  const namespace = getNamespace(node, namespaces[uri])

  if (node.type === 'func_def') {
    const name = getFunctionName(node)
    const range = getRange(node)
    const linkedUris = dependencies.getLinkedUris(uri)

    let existingDefinition: SymbolInformation | undefined

    for (const sm of [...linkedUris].map((u) => symbols[u])) {
      const symbolInfos = sm?.get(name)

      if (!symbolInfos) continue

      existingDefinition = symbolInfos.find(
        (si) => si.containerName === namespace && si.kind === SymbolKind.Function,
      )
    }

    if (!existingDefinition) return null

    const { uri: eduri, range: edrange } = existingDefinition.location

    if (uri !== eduri || !isSameRange(range, edrange)) {
      return Diagnostic.create(
        range,
        `Function name must be unique`,
        DiagnosticSeverity.Error,
      )
    }
  }

  return null
}
