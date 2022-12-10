//import { existsSync } from 'fs'
import { extname, join } from 'path'
//import { pathToFileURL, URL } from 'url'
import { Position } from 'vscode-languageserver-textdocument'
import { Range, URI } from 'vscode-languageserver/node'
import { Point, SyntaxNode, Tree } from 'web-tree-sitter'
import {pathToFileURL} from 'url'; // typescript-langauge-server -> https://github.com/typescript-language-server/typescript-language-server/blob/master/src/document.ts
import vscodeUri from 'vscode-uri'; // typescript-langauge-server -> https://github.com/typescript-language-server/typescript-language-server/blob/master/src/document.ts 
import {existsSync} from 'fs-extra';
import {findSetDefinedVariable, findParentCommand, isFunctionDefinition, isVariableDefintion} from './node-types';

/**
 * Returns an array for all the nodes in the tree (@see also nodesGen)
 *
 * @param {SyntaxNode} root - the root node to search from 
 * @returns {SyntaxNode[]} all children of the root node (flattend)
 */
export function getChildNodes(root: SyntaxNode): SyntaxNode[] {
    let queue: SyntaxNode[] = [root]
    let result: SyntaxNode[] = []
    while (queue.length) {
        let current : SyntaxNode | undefined = queue.shift()
        if (current) result.push(current)
        if (current && current.children) queue.unshift(...current.children)
    }
    return result
}

/**
 * Gets path to root starting where index 0 is child node passed in.
 * Format: [child, child.parent, ..., root]
 *
 * @param {SyntaxNode} child - the lowest child of root
 * @returns {SyntaxNode[]} an array of ancestors to the descendent node passed in.
 */
export function getParentNodes(child: SyntaxNode): SyntaxNode[] {
    const result: SyntaxNode[] = [child]
    let current: SyntaxNode | null = child.parent;
    while (current !== null) {
        // result.unshift(current); // unshift would be used for [root, ..., child]
        result.push(current);
        current = current.parent;
    }
    //if (child.parent === null) {
    //    current = child.previousSibling;
    //    while (current) {
    //        result.push(current);
    //        current = current.previousSibling;
    //    }
    //}
    return result
}


// some nodes (such as commands) to get their text, you will need 
// the first named child.
// other nodes (such as flags) need just the actual text.
export function getNodeText(node: SyntaxNode | null): string {
    if (!node) {
        return ""
    }
    if (isFunctionDefinition(node)) {
        return node.child(1)?.text || ""
    }
    if (isVariableDefintion(node)) {
        const defVar = findSetDefinedVariable(node)!
        return defVar.text || "";
    }
    return (node.text != null) ? node.text.trim() : ""
}

export function firstAncestorMatch(
  start: SyntaxNode,
  predicate: (n: SyntaxNode) => boolean,
): SyntaxNode | null {
    const ancestors = getParentNodes(start) || [];
    if (ancestors.length <= 1) {
        return predicate(start) ? start : null;
    }
    for (const p of ancestors) {
        //for (const neighbor of getChildNodes(p)) {}
        if (!predicate(p)) continue;
        return p;
    }
    return null
        //.filter(ancestor => ancestor !== start)
}

/**
 * finds all ancestors (parent nodes) of a node that match a predicate
 *
 * @param {SyntaxNode} start - the leaf/deepest child node to start searching from
 * @param {(n: SyntaxNode) => boolean} predicate - a function that returns true if the node matches
 * @param {boolean} [inclusive] - if true, the start node can be included in the results
 * @returns {SyntaxNode[]} - an array of nodes that match the predicate
 */
export function ancestorMatch(
    start: SyntaxNode,
    predicate: (n: SyntaxNode) => boolean,
    inclusive: boolean = true,
): SyntaxNode[] {
    const ancestors = getParentNodes(start) || [];
    const searchNodes : SyntaxNode[] = []
    for (const p of ancestors) {
        searchNodes.push(...getChildNodes(p));
    }
    const results: SyntaxNode[] = searchNodes.filter(neighbor => predicate(neighbor)) 
    return inclusive ? results : results.filter(ancestor => ancestor !== start)
}

/**
 * searches for all children nodes that match the predicate passed in
 *
 * @param {SyntaxNode} start - the root node to search from
 * @param {(n: SyntaxNode) => boolean} predicate - a function that returns a bollean
 * incating whether the node passed in matches the search criteria
 *  @param {boolean} inclusive: boolean = true,
 * @returns {SyntaxNode[]} - all child nodes that match the predicate
 */
export function descendantMatch(
    start: SyntaxNode,
    predicate: (n: SyntaxNode) => boolean,
    inclusive = true
) : SyntaxNode[] {
    const descendants: SyntaxNode[] = []
    descendants.push(...getChildNodes(start))
    const results = descendants.filter(descendant => predicate(descendant))
    return inclusive? results : results.filter(r => r !== start)
}


/**
 * uses nodesGen to build an array.
 *
 * @param {SyntaxNode} node - the root node of a document (where to begin search) 
 * @returns {SyntaxNode[]} - all nodes seen in the document.
 */
//function getChildrenArray(node: SyntaxNode): SyntaxNode[] {
//    let root =  nodesGen(node);
//    const result: SyntaxNode[] = [];
//
//    var currNode = root.next();
//    while (!currNode.done) {
//        if (currNode.value) {
//            result.push(currNode.value)
//        }
//        currNode = root.next()
//    }
//    return result
//}
//
//function _findNodes(root: SyntaxNode): SyntaxNode[] {
//    let queue: SyntaxNode[] = [root]
//    let result: SyntaxNode[] = []
//
//    while (queue.length) {
//        let current : SyntaxNode | undefined = queue.pop();
//        if (current && current.namedChildCount > 0) {
//            result.push(current)
//            queue.unshift(...current.namedChildren.filter(child => child))
//        } else if (current && current.childCount > 0){
//            result.push(current)
//            queue.unshift(...current.children)
//        } else {
//            continue
//        }
//    }
//    return result
//}

export function getRange(node: SyntaxNode): Range {
  return Range.create(
    node.startPosition.row,
    node.startPosition.column,
    node.endPosition.row,
    node.endPosition.column,
  )
}

/**
 * findNodeAt() - handles moving backwards if the cursor is not currently on a node (safer version of getNodeAt)
 */
export function findNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null {
    if (!tree.rootNode) return null

    let currentCol = column;
    let currentLine = line;

    while (currentLine > 0) {
        let currentNode = tree.rootNode.descendantForPosition({row: currentLine, column: currentCol})
        if (currentNode) {
            return currentNode;
        }
        currentCol--;
    }
    return tree.rootNode.descendantForPosition({ row: line, column })
}

/**
 * getNodeAt() - handles moving backwards if the cursor i
 */
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

export function getDependencyUrl(node: SyntaxNode, baseUri: string): URL {
  let filename = node.children[1].text.replaceAll('"', '')

  if (!filename.endsWith('.fish')) {
    filename += '.fish'
  }

  const paths = process.env.PATH?.split(':') || []

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

export function isFishExtension(path: URI | string): boolean {
    const ext = extname(path).toLowerCase()
    return ext === '.fish'
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





// Check out awk-language-server: 
//     • https://github.com/Beaglefoot/awk-language-server/tree/master/server/src/utils.ts
//     • https://github.com/bash-lsp/bash-language-server/blob/main/server/src/util/tree-sitter.ts
//
//export function getQueriesList(queriesRawText: string): string[] {
//  const result: string[] = []
//
//  let openParenCount = 0
//  let openBracketCount = 0
//  let isQuoteCharMet = false
//  let isComment = false
//  let currentQuery = ''
//
//  for (const char of queriesRawText) {
//    if (char === '"') isQuoteCharMet = !isQuoteCharMet
//    if (isQuoteCharMet) {
//      currentQuery += char
//      continue
//    } else if (!isQuoteCharMet && char === ';') isComment = true
//    else if (isComment && char !== '\n') continue
//    else if (char === '(') openParenCount++
//    else if (char === ')') openParenCount--
//    else if (char === '[') openBracketCount++
//    else if (char === ']') openBracketCount--
//    else if (char === '\n') {
//      isComment = false
//
//      if (!openParenCount && !openBracketCount && currentQuery) {
//        result.push(currentQuery.trim())
//        currentQuery = ''
//      }
//
//      continue
//    }
//
//    if (!isComment) currentQuery += char
//  }
//
//  return result
//}

