import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { getRange } from '../utils'
import { ValidationContext } from './validator'

export function validateSyntaxError(context: ValidationContext): Diagnostic | null {
  const { node } = context

  if (node.type !== 'ERROR') return null

  return Diagnostic.create(getRange(node), 'Syntax error', DiagnosticSeverity.Error)
}
