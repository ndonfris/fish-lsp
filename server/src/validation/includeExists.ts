import { existsSync } from 'fs'
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'
import { getDependencyUrl, getRange, isInclude } from '../utils'
import { ValidationContext } from './validator'

export function validateIncludeExists(context: ValidationContext): Diagnostic | null {
  const { node, uri } = context

  if (isInclude(node)) {
    const range = getRange(node)
    const url = getDependencyUrl(node, uri)

    if (!existsSync(url)) {
      return Diagnostic.create(range, 'File does not exist', DiagnosticSeverity.Error)
    }
  }

  return null
}
