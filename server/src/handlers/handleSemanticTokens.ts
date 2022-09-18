import { readFileSync } from 'fs'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { QueryCapture } from 'web-tree-sitter'
import { Context } from '../interfaces'
import { getQueriesList } from '../utils'
import * as path from 'path'

interface UnencodedSemanticToken {
  line: number
  startChar: number
  length: number
  tokenType: string
  tokenModifiers: string[]
}

export function getSemanticTokensHandler(context: Context) {
  const { trees, connection } = context

  return function handleSemanticTokens(params: {
    textDocument: TextDocument
  }): UnencodedSemanticToken[] {
    const { textDocument } = params
    const tree = trees[textDocument.uri]
    const lang = tree.getLanguage()

    const highlightsPath = path.resolve(
      require.resolve('tree-sitter-awk'),
      '..',
      '..',
      '..',
      'queries',
      'highlights.scm',
    )

    const queriesText = readFileSync(highlightsPath, 'utf8')
    const queriesList = getQueriesList(queriesText).reverse() // Reverse to prioritize in tree-sitter manner
    const captures: QueryCapture[] = []

    for (const queryString of queriesList) {
      const query = lang.query(queryString)

      if (query.captureNames.length > 1) {
        connection.console.warn(
          `Got more than 1 captureNames: ${query.captureNames.join(', ')}`,
        )
      }

      captures.push(...query.captures(tree.rootNode))
    }

    return captures.map<UnencodedSemanticToken>(({ name, node }) => ({
      line: node.startPosition.row,
      startChar: node.startPosition.column,
      length: node.endIndex - node.startIndex,
      tokenType: name,
      tokenModifiers: [],
    }))
  }
}
