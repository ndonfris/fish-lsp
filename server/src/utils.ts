import { existsSync } from 'fs'
import { extname, join } from 'path'
import { pathToFileURL, URL } from 'url'
import { Position } from 'vscode-languageserver-textdocument'
import { Range, URI } from 'vscode-languageserver/node'
import { Point, SyntaxNode, Tree } from 'web-tree-sitter'
import { NamespaceMap } from './interfaces'

export function* nodesGen(node: SyntaxNode) {
  const queue: SyntaxNode[] = [node]

  while (queue.length) {
    const n = queue.shift()

    if (!n) return

    if (n.children.length) {
      queue.unshift(...n.children)
    }

    yield n
  }
}

export function findParent(
  start: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
): SyntaxNode | null {
  let node = start.parent

  while (node !== null) {
    if (predicate(node)) return node

    node = node.parent
  }

  return null
}

export function getRange(node: SyntaxNode): Range {
  return Range.create(
    node.startPosition.row,
    node.startPosition.column,
    node.endPosition.row,
    node.endPosition.column,
  )
}

export function getNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null {
  if (!tree.rootNode) return null

  return tree.rootNode.descendantForPosition({ row: line, column })
}

export function getNodeAtRange(tree: Tree, range: Range): SyntaxNode | null {
  if (!tree.rootNode) return null

  return tree.rootNode.descendantForPosition(
    positionToPoint(range.start),
    positionToPoint(range.end),
  )
}

/** Get textual representation of the node (variable name, field & array reference, but not function name) */
export function getName(node: SyntaxNode): string | null {
  if (!node) return null
  if (node.childCount) {
    if (!['field_ref', 'array_ref'].includes(node.type)) return null
  }

  return node.text.trim() || null
}

export function getFunctionName(node: SyntaxNode): string {
  return node.descendantsOfType('identifier')[0].text.trim()
}

export function isDefinition(node: SyntaxNode): boolean {
  if (['assignment_exp', 'func_def', 'for_in_statement'].includes(node.type)) return true
  if (node.type === 'getline_input' && node.firstNamedChild) return true
  return false
}

export function isParamList(node: SyntaxNode): boolean {
  return node.type === 'param_list'
}

export function isReference(node: SyntaxNode): boolean {
  return ['array_ref', 'field_ref', 'identifier'].includes(node.type)
}

export function isInclude(node: SyntaxNode): boolean {
  return node.type === 'directive' && node?.firstChild?.text === '@include'
}

export function isFunction(node: SyntaxNode): boolean {
  return node.type === 'func_def' || node.type === 'func_call'
}

export function isIdentifier(node: SyntaxNode): boolean {
  return node.type === 'identifier'
}

export function findReferences(
  startingNode: SyntaxNode,
  startingNamespaces: NamespaceMap,
  searchedNode: SyntaxNode,
  searchedNamespaces: NamespaceMap,
): Range[] {
  const result: Range[] = []
  const name = getName(searchedNode)
  const ns = getNamespace(searchedNode, searchedNamespaces)

  for (const node of nodesGen(startingNode)) {
    if (!isReference(node) && !isDefinition(node)) continue

    if (getName(node) === name && getNamespace(node, startingNamespaces) === ns)
      result.push(getRange(node))
  }

  return result
}

export function getQueriesList(queriesRawText: string): string[] {
  const result: string[] = []

  let openParenCount = 0
  let openBracketCount = 0
  let isQuoteCharMet = false
  let isComment = false
  let currentQuery = ''

  for (const char of queriesRawText) {
    if (char === '"') isQuoteCharMet = !isQuoteCharMet
    if (isQuoteCharMet) {
      currentQuery += char
      continue
    } else if (!isQuoteCharMet && char === ';') isComment = true
    else if (isComment && char !== '\n') continue
    else if (char === '(') openParenCount++
    else if (char === ')') openParenCount--
    else if (char === '[') openBracketCount++
    else if (char === ']') openBracketCount--
    else if (char === '\n') {
      isComment = false

      if (!openParenCount && !openBracketCount && currentQuery) {
        result.push(currentQuery.trim())
        currentQuery = ''
      }

      continue
    }

    if (!isComment) currentQuery += char
  }

  return result
}

export function getDependencyUrl(node: SyntaxNode, baseUri: string): URL {
  let filename = node.children[1].text.replaceAll('"', '')

  if (!filename.endsWith('.awk') && !filename.endsWith('.gawk')) {
    // The way GAWK behaves
    filename += '.awk'
  }

  const paths = process.env.AWKPATH?.split(':') || []

  for (const p of paths) {
    const url = pathToFileURL(join(p, filename))

    if (existsSync(url)) return url
  }

  return new URL(filename, baseUri)
}

export function positionToPoint(pos: Position): Point {
  return {
    row: pos.line,
    column: pos.character,
  }
}

export function pointToPosition(point: Point): Position {
  return {
    line: point.row,
    character: point.column,
  }
}

export function getFunctionSignature(node: SyntaxNode): string {
  if (!isFunction(node)) {
    throw new Error(`Node type ${node.type} is not a function`)
  }

  const params = node
    .descendantsOfType('param_list')[0]
    ?.text?.replaceAll(/#.*/g, '')
    ?.replaceAll(/\s+/g, ' ')

  return `${(node.firstNamedChild as SyntaxNode).text}(${params || ''})`
}

export function getPrecedingComments(node: SyntaxNode | null): string {
  if (!node) return ''

  let comment: string[] = []
  let currentNode = node.previousNamedSibling

  while (currentNode?.type === 'comment') {
    comment.unshift(currentNode.text.replaceAll(/#+\s?/g, ''))
    currentNode = currentNode.previousNamedSibling
  }

  return comment.join('\n')
}

/** Get function node if given node is defined among its parameters */
export function getParentFunction(node: SyntaxNode): SyntaxNode | null {
  const parentFunc = findParent(node, (p) => p.type === 'func_def')

  if (!parentFunc) return null

  const paramList =
    parentFunc.namedChildren[1].type === 'param_list' ? parentFunc.namedChildren[1] : null

  if (!paramList) return null

  const name = getName(node)

  if (!name) return null

  for (const param of paramList.children) {
    if (name === getName(param)) return parentFunc
  }

  return null
}

/** Get function name if node is defined among its parameters */
export function getParentFunctionName(node: SyntaxNode): string | null {
  const parentFunc = getParentFunction(node)

  return parentFunc ? getName(parentFunc.firstNamedChild!) : null
}

export function isLoop(node: SyntaxNode): boolean {
  return [
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_while_statement',
  ].includes(node.type)
}

export function isSwitch(node: SyntaxNode): boolean {
  return node.type === 'switch_statement'
}

export function isAwkExtension(path: URI | string): boolean {
  const ext = extname(path).toLowerCase()
  return ext === '.awk' || ext === '.gawk'
}

export function isBlock(node: SyntaxNode): boolean {
  return node.type === 'block'
}

export function isNamespace(node: SyntaxNode): boolean {
  return node.type === 'directive' && node.firstChild!.text === '@namespace'
}

export function isPositionWithinRange(position: Position, range: Range): boolean {
  const doesStartInside =
    position.line > range.start.line ||
    (position.line === range.start.line && position.character >= range.start.character)

  const doesEndInside =
    position.line < range.end.line ||
    (position.line === range.end.line && position.character <= range.end.character)

  return doesStartInside && doesEndInside
}

export function isNodeWithinRange(node: SyntaxNode, range: Range): boolean {
  const doesStartInside =
    node.startPosition.row > range.start.line ||
    (node.startPosition.row === range.start.line &&
      node.startPosition.column >= range.start.character)

  const doesEndInside =
    node.endPosition.row < range.end.line ||
    (node.endPosition.row === range.end.line &&
      node.endPosition.column <= range.end.character)

  return doesStartInside && doesEndInside
}

/** Get namespace which node belongs to */
export function getNamespace(node: SyntaxNode, namespaces: NamespaceMap): string {
  if (isIdentifier(node) && node.previousNamedSibling?.type === 'namespace')
    return node.previousNamedSibling.text

  for (const [ns, range] of namespaces) {
    if (isNodeWithinRange(node, range)) return ns
  }

  return 'awk'
}

export function isAssignment(node: SyntaxNode): boolean {
  return [
    'assignment_exp',
    'update_exp',
    'for_in_statement',
    'getline_input',
    'getline_file',
  ].includes(node.type)
}

/** Get namespace name on directive node */
export function getNamespaceName(node: SyntaxNode): string {
  return node.lastChild!.text.slice(1, -1)
}
