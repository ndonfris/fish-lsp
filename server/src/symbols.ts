import { Position } from 'vscode-languageserver-textdocument'
import { SymbolInformation } from 'vscode-languageserver-types'

export function getNearestPrecedingSymbol(
  startingPosition: Position,
  symbolsToSearch: SymbolInformation[],
): SymbolInformation | null {
  const { line, character } = startingPosition

  let result: SymbolInformation | null = null

  for (const sym of symbolsToSearch) {
    const newLineDistance = line - sym.location.range.start.line
    if (newLineDistance < 0) continue

    if (!result) {
      result = sym
      continue
    }

    const currentLineDistance = line - result.location.range.start.line

    if (newLineDistance < currentLineDistance) {
      result = sym
      continue
    }

    const currentCharDistance = character - result.location.range.start.character
    const newCharDistance = character - sym.location.range.start.character

    if (newCharDistance < currentCharDistance) result = sym
  }

  return result
}

export function getFinalSymbolByPosition(
  symbolsToSearch: SymbolInformation[],
): SymbolInformation | null {
  let result: SymbolInformation | null = null

  for (const sym of symbolsToSearch) {
    if (!result) {
      result = sym
      continue
    }

    if (sym.location.range.start.line > result.location.range.start.line) {
      result = sym
      continue
    }

    if (sym.location.range.start.character > result.location.range.start.character) {
      result = sym
    }
  }

  return result
}
