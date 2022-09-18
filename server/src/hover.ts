import {
  Hover,
  Position,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver/node'
import { SyntaxNode } from 'web-tree-sitter'
import { getFunctionHint, getVariableHint } from './hints'
import { Context, SymbolsMap } from './interfaces'
import { getFinalSymbolByPosition, getNearestPrecedingSymbol } from './symbols'
import { getNodeAtRange, isAssignment, isBlock, isIdentifier, isParamList } from './utils'

export function getFunctionHoverResult(
  context: Context,
  nodeName: string,
  namespace: string,
  uri: string,
): Hover | null {
  const { dependencies, symbols, namespaces, trees } = context

  const allDeps = [...dependencies.getLinkedUris(uri)].filter(
    (u) => namespace === 'awk' || namespaces[u]?.has(namespace),
  )

  let funcDefinitionSymbol: SymbolInformation | undefined

  for (const uri of allDeps) {
    const symbolInfos = symbols[uri]?.get(nodeName)

    if (symbolInfos) {
      funcDefinitionSymbol = symbolInfos.find(
        (si) => si.kind === SymbolKind.Function && si.containerName === namespace,
      )

      if (funcDefinitionSymbol) break
    }
  }

  if (!funcDefinitionSymbol) return null

  const funcDefinitionNode = getNodeAtRange(
    trees[funcDefinitionSymbol.location.uri],
    funcDefinitionSymbol.location.range,
  )!

  return {
    contents: {
      kind: 'markdown',
      value: getFunctionHint(funcDefinitionNode),
    },
  }
}

function getSymbolInfoForName(
  nodeName: string,
  namespace: string,
  symbolsMap: SymbolsMap,
): SymbolInformation[] {
  if (!symbolsMap.has(nodeName)) return []

  return symbolsMap
    .get(nodeName)!
    .filter(
      (si) =>
        si.containerName === namespace || si.containerName?.startsWith(`${namespace}::`),
    )
}

export function getIdentifierHoverResult(
  context: Context,
  nodeName: string,
  namespace: string,
  uri: string,
  position: Position,
): Hover | null {
  const { trees, symbols, namespaces, dependencies } = context

  let nearestSymbol: SymbolInformation | null = null
  let definitionNode: SyntaxNode

  const symbolInfos = getSymbolInfoForName(nodeName, namespace, symbols[uri])

  if (symbolInfos.length) {
    nearestSymbol = getNearestPrecedingSymbol(position, symbolInfos)
  }

  if (nearestSymbol) {
    definitionNode = getNodeAtRange(
      trees[nearestSymbol.location.uri],
      nearestSymbol.location.range,
    )!

    // Prefer assignment over simple declaration
    if (!isAssignment(definitionNode)) {
      nearestSymbol = null
    }
  }

  if (!nearestSymbol) {
    const uriWithFinalDefinition = [...dependencies.getAllDepthFirst(uri)]
      .filter((u) => namespace === 'awk' || namespaces[u]?.has(namespace))
      .filter((u) => symbols[u])
      .reverse()
      .find((u) => getSymbolInfoForName(nodeName, namespace, symbols[u]).length)

    if (!uriWithFinalDefinition) return null

    nearestSymbol = getFinalSymbolByPosition(
      getSymbolInfoForName(nodeName, namespace, symbols[uriWithFinalDefinition]),
    )
  }

  if (!nearestSymbol) return null

  definitionNode = getNodeAtRange(
    trees[nearestSymbol.location.uri],
    nearestSymbol.location.range,
  )!

  return {
    contents: {
      kind: 'markdown',
      value: getVariableHint(
        getDefinitionText(definitionNode),
        nearestSymbol.location.uri,
      ),
    },
  }
}

function getDefinitionText(node: SyntaxNode): string {
  if (isIdentifier(node) && node.parent) {
    if (isParamList(node.parent)) {
      const funcDefNode = node.parent.parent!
      const firstLineOfText = funcDefNode.text.split('\n')[0]

      return firstLineOfText.includes(')')
        ? firstLineOfText.replace(/{/, '').trim()
        : `${funcDefNode.children[0].text} ${funcDefNode.children[1].text} (...${node.text})`
    }

    if (isBlock(node.parent)) {
      const offset = node.startPosition.row - node.parent.startPosition.row

      return node.parent.text
        .split('\n')
        .filter((_, i) => offset - 1 <= i && i <= offset + 1)
        .join('\n')
    }

    return node.parent.text.split('\n')[0].trim()
  }

  return node.text.trim()
}
