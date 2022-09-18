import {
  DocumentHighlight,
  DocumentHighlightParams,
} from 'vscode-languageserver-protocol/node'
import { Context } from '../interfaces'
import { findReferences, getNodeAt } from '../utils'

const applicableNodeTypes = new Set(['identifier', 'field_ref'])

export function getDocumentHighlightHandler(context: Context) {
  const { trees, namespaces } = context

  return function handleDocumentHighlight(
    params: DocumentHighlightParams,
  ): DocumentHighlight[] {
    const { textDocument, position } = params
    const { uri } = textDocument

    let node = getNodeAt(trees[textDocument.uri], position.line, position.character)

    if (!node) return []

    if (node.type === 'number' && node.parent?.type === 'field_ref') {
      node = node.parent
    }

    if (!applicableNodeTypes.has(node.type)) return []

    const tree = trees[textDocument.uri]

    return findReferences(tree.rootNode, namespaces[uri], node, namespaces[uri]).map(
      (range) => DocumentHighlight.create(range),
    )
  }
}
