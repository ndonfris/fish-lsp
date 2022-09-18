import {
  DocumentFormattingParams,
  Position,
  Range,
  TextEdit,
  uinteger,
} from 'vscode-languageserver/node'
import { formatDocument } from '../format'
import { Context } from '../interfaces'

export function getDocumentFormattingHandler(context: Context) {
  const { documents, connection } = context

  return (params: DocumentFormattingParams): TextEdit[] => {
    const editedDocument = documents.get(params.textDocument.uri)

    if (!editedDocument) return []

    const text = editedDocument.getText()

    let formattedText: string | null = null

    try {
      formattedText = formatDocument(text)
    } catch (err) {
      if (err instanceof Error) {
        connection.window.showErrorMessage(err.message)
      }

      if (typeof err === 'string') {
        connection.window.showErrorMessage(err)
      }

      return []
    }

    if (!formattedText) return []

    const editedRange = Range.create(
      Position.create(0, 0),
      Position.create(editedDocument.lineCount, uinteger.MAX_VALUE),
    )

    return [TextEdit.replace(editedRange, formattedText)]
  }
}
