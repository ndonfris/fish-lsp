import {
  RenameParams,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol/node'
import { Context } from '../interfaces'
import { findReferences, getNodeAt, getParentFunction, isIdentifier } from '../utils'

export function getRenameRequestHandler(context: Context) {
  const { trees, namespaces, dependencies } = context

  return async function handleRenameRequest(
    params: RenameParams,
  ): Promise<WorkspaceEdit | null> {
    const { position, textDocument, newName } = params
    const node = getNodeAt(trees[textDocument.uri], position.line, position.character)

    if (!node || !isIdentifier(node)) return null

    const parentFunction = getParentFunction(node)

    // Parameter rename
    if (parentFunction) {
      const edits: WorkspaceEdit = {
        changes: {
          [textDocument.uri]: [],
        },
      }

      edits.changes![textDocument.uri] = findReferences(
        parentFunction,
        namespaces[textDocument.uri],
        node,
        namespaces[textDocument.uri],
      ).map((r) => TextEdit.replace(r, newName))

      return edits
    }

    // Function and variable rename
    const linkedUris = dependencies.getLinkedUris(textDocument.uri)
    const edits: WorkspaceEdit = {}

    for (const uri of linkedUris) {
      if (!trees[uri]) continue
      if (!edits.changes) edits.changes = {}
      if (!edits.changes[uri]) edits.changes[uri] = []

      edits.changes[uri] = findReferences(
        trees[uri].rootNode,
        namespaces[uri],
        node,
        namespaces[textDocument.uri],
      ).map((r) => TextEdit.replace(r, newName))
    }

    return edits
  }
}
