import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { getRange } from '../utils'
import { ValidationContext } from './validator'

export function validateMissingNode(context: ValidationContext): Diagnostic | null {
  const { node } = context

  if (node.isMissing()) {
    return Diagnostic.create(
      getRange(node),
      `Syntax error: missing ${node.type}`,
      DiagnosticSeverity.Warning,
    )
  }

  return null
}
