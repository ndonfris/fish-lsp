import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { getBuiltinHints } from '../hints'
import { getFunctionName, getRange } from '../utils'
import { ValidationContext } from './validator'

export function validateBuiltinName(context: ValidationContext): Diagnostic | null {
  const { node, docs } = context

  if (node.type === 'func_def') {
    const name = getFunctionName(node)
    const range = getRange(node)
    const builtins = getBuiltinHints(docs)

    if (name in builtins) {
      return Diagnostic.create(
        range,
        `'${name}' is built-in function, function name must be unique`,
        DiagnosticSeverity.Error,
      )
    }
  }

  return null
}
