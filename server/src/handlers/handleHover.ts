import { Hover, HoverParams } from 'vscode-languageserver/node'
import { SyntaxNode } from 'web-tree-sitter'
import { getBuiltinHints } from '../hints'
import { getFunctionHoverResult, getIdentifierHoverResult } from '../hover'
import { Context } from '../interfaces'
import { getName, getNamespace, getNodeAt } from '../utils'

function isFunction(node: SyntaxNode): boolean {
  const parent =
    node.parent?.type === 'ns_qualified_name' ? node.parent.parent : node.parent

  if (!parent) return false

  return ['func_call', 'func_def'].includes(parent.type)
}

export function getHoverHandler(context: Context) {
  const { trees, namespaces, docs } = context

  return function handleHover(params: HoverParams): Hover | null {
    const { uri } = params.textDocument
    const { line, character } = params.position

    let node = getNodeAt(trees[uri], line, character)

    if (!node) return null

    if (node.type === 'string' && node.parent?.type === 'array_ref') {
      node = node.parent
    }

    const name = getName(node)

    if (!name) return null

    const builtins = getBuiltinHints(docs)

    if (builtins[name]) {
      return { contents: { kind: 'markdown', value: builtins[name] } }
    }

    const ns = getNamespace(node, namespaces[uri] || new Map())

    if (isFunction(node)) {
      return getFunctionHoverResult(context, name, ns, uri)
    }

    if (node.type === 'identifier') {
      return getIdentifierHoverResult(context, name, ns, uri, params.position)
    }

    return null
  }
}
