import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { SyntaxNode } from 'web-tree-sitter'
import { findParent, getRange } from '../utils'
import { ValidationContext } from './validator'

function isRuleWithSpecialPattern(node: SyntaxNode) {
  return (
    node.type === 'rule' &&
    ['BEGIN', 'BEGINFILE', 'NEXT', 'NEXTFILE'].includes(node.firstChild?.text || '')
  )
}

export function validateNextPlacement(context: ValidationContext): Diagnostic | null {
  const { node } = context

  if (node.type === 'next_statement' || node.type === 'nextfile_statement') {
    if (findParent(node, isRuleWithSpecialPattern)) {
      return Diagnostic.create(
        getRange(node),
        `${node.type} cannot be used inside of BEGIN/BEGINFILE or END/ENDFILE`,
        DiagnosticSeverity.Error,
      )
    }
  }

  return null
}
