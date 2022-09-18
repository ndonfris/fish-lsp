import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { findParent, getRange, isLoop, isSwitch } from '../utils'
import { ValidationContext } from './validator'

export function validateBreakPlacement(context: ValidationContext): Diagnostic | null {
  const { node } = context

  if (node.type === 'break_statement') {
    if (findParent(node, isLoop) || findParent(node, isSwitch)) return null

    return Diagnostic.create(
      getRange(node),
      `'break' cannot be used outside of loop or switch/case`,
      DiagnosticSeverity.Error,
    )
  }

  return null
}
