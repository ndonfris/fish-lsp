import { DefinitionParams, Location } from 'vscode-languageserver-protocol/node'
import { Context } from '../interfaces'
import { getName, getNamespace, getNodeAt, getParentFunctionName } from '../utils'

export function getDefinitionHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies } = context

  return function handleDefinition(params: DefinitionParams): Location[] {
    const { textDocument, position } = params
    const node = getNodeAt(trees[textDocument.uri], position.line, position.character)

    if (!node) return []

    const name = getName(node)

    if (!name) return []

    const namespace = getNamespace(node, namespaces[textDocument.uri])
    const parentFunc = getParentFunctionName(node)
    const containerName = parentFunc ? `${namespace}::${parentFunc}` : namespace

    return [...dependencies.getLinkedUris(textDocument.uri)]
      .filter((uri) => symbols[uri]?.has(name))
      .filter((uri) => namespace === 'awk' || namespaces[uri].has(namespace))
      .flatMap((uri) =>
        symbols[uri]
          .get(name)!
          .filter((s) => s.containerName === containerName)
          .map((s) => s.location),
      )
  }
}
