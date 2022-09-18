import { TextDocument } from 'vscode-languageserver-textdocument'
import { Range, SymbolInformation, SymbolKind } from 'vscode-languageserver/node'
import { SyntaxNode, Tree } from 'web-tree-sitter'
import { Documentation } from './documentation'
import { getBuiltinHints } from './hints'
import { Context, NamespaceMap, SymbolsMap } from './interfaces'
import {
  getDependencyUrl,
  getName,
  getRange,
  isDefinition,
  getParentFunctionName,
  isIdentifier,
  isInclude,
  isParamList,
  nodesGen,
  getParentFunction,
  isNamespace,
  pointToPosition,
  getNamespace,
  getNamespaceName,
} from './utils'

const kinds: { [tree_sitter_type: string]: SymbolKind } = {
  func_def: SymbolKind.Function,
  assignment_exp: SymbolKind.Variable,
  for_in_statement: SymbolKind.Variable,
  getline_input: SymbolKind.Variable,
  param_list: SymbolKind.Variable,
  identifier: SymbolKind.Variable,
}

function getSymbolInfoFromDefinition(node: SyntaxNode, uri: string): SymbolInformation {
  const identifier = node.descendantsOfType('identifier')[0]
  const name = identifier.text

  return SymbolInformation.create(name, kinds[node.type], getRange(node), uri)
}

function getSymbolInfoFromParam(node: SyntaxNode, uri: string): SymbolInformation {
  return SymbolInformation.create(
    getName(node)!,
    kinds[node.type],
    getRange(node),
    uri,
    getParentFunctionName(node)!,
  )
}

function getSymbolInfo(node: SyntaxNode, uri: string): SymbolInformation | null {
  if (!node.parent) return null

  if (isParamList(node.parent)) {
    return getSymbolInfoFromParam(node, uri)
  }

  if (getParentFunction(node)) return null

  if (isDefinition(node.parent)) {
    return getSymbolInfoFromDefinition(node.parent, uri)
  }

  if (!['func_call'].includes(node.parent.type)) {
    return SymbolInformation.create(getName(node)!, kinds[node.type], getRange(node), uri)
  }

  return null
}

function isKnownSymbol(
  symbols: SymbolInformation[],
  symbolInfo: SymbolInformation,
): boolean {
  for (const symbol of symbols) {
    if (
      symbol.name === symbolInfo.name &&
      symbol.containerName === symbolInfo.containerName
    )
      return true
  }
  return false
}

function getNamespaceMap(tree: Tree): NamespaceMap {
  const result: NamespaceMap = new Map()
  const namespaces = tree.rootNode.namedChildren.filter(isNamespace) || []

  namespaces.forEach((ns, i) => {
    const nextNs = namespaces[i + 1]
    const name = ns.lastChild!.text.slice(1, -1)
    const range = Range.create(
      pointToPosition(ns.startPosition),
      pointToPosition(nextNs?.startPosition || tree.rootNode.endPosition),
    )

    result.set(name, range)
  })

  return result
}

export function analyze(
  context: Context,
  document: TextDocument,
  docs: Documentation,
): {
  tree: Tree
  symbols: SymbolsMap
  namespaces: NamespaceMap
  document: TextDocument
  dependencyUris: string[]
} {
  const tree = context.parser.parse(document.getText())
  const symbols: SymbolsMap = new Map()
  const namespaces: NamespaceMap = getNamespaceMap(tree)

  const dependencyUris: string[] = []

  for (const node of nodesGen(tree.rootNode)) {
    if (isInclude(node) && node.childCount === 2) {
      const url = getDependencyUrl(node, document.uri)
      dependencyUris.push(url.href)
    }

    if (isNamespace(node)) {
      const name = getNamespaceName(node)
      const symbolInfo = SymbolInformation.create(
        name,
        SymbolKind.Namespace,
        namespaces.get(name)!,
        document.uri,
      )

      if (!symbols.get(symbolInfo.name)) symbols.set(symbolInfo.name, [])

      symbols.get(symbolInfo.name)!.push(symbolInfo)

      continue
    }

    if (!isIdentifier(node)) continue

    const symbolInfo = getSymbolInfo(node, document.uri)

    if (!symbolInfo) continue

    const ns = getNamespace(node, namespaces)

    symbolInfo.containerName = symbolInfo.containerName
      ? `${ns}::${symbolInfo.containerName}`
      : ns

    if (getBuiltinHints(docs)[symbolInfo.name]) continue
    if (isKnownSymbol(symbols.get(symbolInfo.name) || [], symbolInfo)) continue

    if (!symbols.get(symbolInfo.name)) symbols.set(symbolInfo.name, [])

    symbols.get(symbolInfo.name)!.push(symbolInfo)
  }

  return {
    tree,
    symbols,
    namespaces,
    document,
    dependencyUris,
  }
}
