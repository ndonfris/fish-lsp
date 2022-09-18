import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { findParent, getRange, isLoop } from '../utils'
import { ValidationContext } from './validator'

export function validateContinuePlacement(context: ValidationContext): Diagnostic | null {
  const { node } = context

  if (node.type === 'continue_statement') {
    if (findParent(node, isLoop)) return null

    return Diagnostic.create(
      getRange(node),
      `'continue' cannot be used outside of loop`,
      DiagnosticSeverity.Error,
    )
  }

  return null
}
