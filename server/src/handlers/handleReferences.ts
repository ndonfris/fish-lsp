import { Location, ReferenceParams } from 'vscode-languageserver/node'
import { Context } from '../interfaces'
import { findReferences, getNodeAt, getParentFunction } from '../utils'

export function getReferencesHandler(context: Context) {
  const { trees, namespaces, dependencies } = context

  return function handleReferences(params: ReferenceParams): Location[] {
    const { textDocument, position } = params
    const node = getNodeAt(trees[textDocument.uri], position.line, position.character)

    if (!node) return []

    const parentFunc = getParentFunction(node)

    if (parentFunc) {
      return findReferences(
        parentFunc,
        namespaces[textDocument.uri],
        node,
        namespaces[textDocument.uri],
      ).map((range) => Location.create(textDocument.uri, range))
    }

    const result: Location[] = []

    for (const uri of dependencies.getLinkedUris(textDocument.uri)) {
      if (!trees[uri]) continue

      result.push(
        ...findReferences(
          trees[uri].rootNode,
          namespaces[uri],
          node,
          namespaces[textDocument.uri],
        ).map((range) => Location.create(uri, range)),
      )
    }

    return result
  }
}
