"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodesGen = exports.isNodeWithinRange = exports.isPositionWithinRange = exports.isFishExtension = exports.getPrecedingComments = exports.pointToPosition = exports.positionToPoint = exports.getDependencyUrl = exports.getNodeAtRange = exports.getNodeAt = exports.findNodeAt = exports.getRange = exports.descendantMatch = exports.ancestorMatch = exports.nodeIsBefore = exports.getNodeText = exports.getParentNodes = exports.getChildNodes = void 0;
//import { existsSync } from 'fs'
const path_1 = require("path");
const node_1 = require("vscode-languageserver/node");
const url_1 = require("url");
const fs_extra_1 = require("fs-extra");
const node_types_1 = require("./node-types");
/**
 * Returns an array for all the nodes in the tree (@see also nodesGen)
 *
 * @param {SyntaxNode} root - the root node to search from
 * @returns {SyntaxNode[]} all children of the root node (flattend)
 */
function getChildNodes(root) {
    let queue = [root];
    let result = [];
    while (queue.length) {
        let current = queue.shift();
        if (current)
            result.push(current);
        if (current && current.children)
            queue.unshift(...current.children);
    }
    return result;
}
exports.getChildNodes = getChildNodes;
/**
 * Gets path to root starting where index 0 is child node passed in.
 * Format: [child, child.parent, ..., root]
 *
 * @param {SyntaxNode} child - the lowest child of root
 * @returns {SyntaxNode[]} an array of ancestors to the descendent node passed in.
 */
function getParentNodes(child) {
    const result = [child];
    let current = child.parent;
    while (current !== null) {
        // result.unshift(current); // unshift would be used for [root, ..., child]
        result.push(current);
        current = current.parent;
    }
    return result;
}
exports.getParentNodes = getParentNodes;
// some nodes (such as commands) to get their text, you will need 
// the first named child.
// other nodes (such as flags) need just the actual text.
function getNodeText(node) {
    var _a;
    if (!node) {
        return "";
    }
    if ((0, node_types_1.isFunctionDefinintion)(node)) {
        return ((_a = node.child(1)) === null || _a === void 0 ? void 0 : _a.text) || "";
    }
    if ((0, node_types_1.isVariableDefintion)(node)) {
        const defVar = (0, node_types_1.findDefinedVariable)(node);
        return defVar.text || "";
    }
    return (node.text != null) ? node.text.trim() : "";
}
exports.getNodeText = getNodeText;
/**
 * Checks that arg0 is located before arg1 in parse tree. False
 * when params are the same node
 *
 * @param {SyntaxNode} firstNode - a node that is positioned left or above second node
 * @param {SyntaxNode} secondNode - some node after first node
 * @returns {boolean} - true only when first param is located before second param
 */
function nodeIsBefore(firstNode, secondNode) {
    if (firstNode.startPosition.row === secondNode.startPosition.row) {
        return firstNode.startPosition.column < secondNode.startPosition.column
            && firstNode.text !== secondNode.text;
    }
    else {
        return firstNode.startPosition.row < secondNode.startPosition.row;
    }
}
exports.nodeIsBefore = nodeIsBefore;
function ancestorMatch(start, predicate) {
    const ancestors = getParentNodes(start) || [];
    return ancestors
        .filter(ancestor => predicate(ancestor))
        .filter(ancestor => ancestor !== start);
}
exports.ancestorMatch = ancestorMatch;
function descendantMatch(start, predicate) {
    const descendants = [];
    descendants.push(...getChildNodes(start));
    return descendants
        .filter(descendant => predicate(descendant))
        .filter(descendent => descendent !== start);
}
exports.descendantMatch = descendantMatch;
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
function getRange(node) {
    return node_1.Range.create(node.startPosition.row, node.startPosition.column, node.endPosition.row, node.endPosition.column);
}
exports.getRange = getRange;
/**
 * findNodeAt() - handles moving backwards if the cursor is not currently on a node (safer version of getNodeAt)
 */
function findNodeAt(tree, line, column) {
    if (!tree.rootNode)
        return null;
    let currentCol = column;
    let currentLine = line;
    while (currentLine > 0) {
        let currentNode = tree.rootNode.descendantForPosition({ row: currentLine, column: currentCol });
        if (currentNode) {
            return currentNode;
        }
        currentCol--;
    }
    return tree.rootNode.descendantForPosition({ row: line, column });
}
exports.findNodeAt = findNodeAt;
/**
 * getNodeAt() - handles moving backwards if the cursor i
 */
function getNodeAt(tree, line, column) {
    if (!tree.rootNode)
        return null;
    return tree.rootNode.descendantForPosition({ row: line, column });
}
exports.getNodeAt = getNodeAt;
function getNodeAtRange(tree, range) {
    if (!tree.rootNode)
        return null;
    return tree.rootNode.descendantForPosition(positionToPoint(range.start), positionToPoint(range.end));
}
exports.getNodeAtRange = getNodeAtRange;
function getDependencyUrl(node, baseUri) {
    var _a;
    let filename = node.children[1].text.replaceAll('"', '');
    if (!filename.endsWith('.fish')) {
        filename += '.fish';
    }
    const paths = ((_a = process.env.PATH) === null || _a === void 0 ? void 0 : _a.split(':')) || [];
    for (const p of paths) {
        const url = (0, url_1.pathToFileURL)((0, path_1.join)(p, filename));
        if ((0, fs_extra_1.existsSync)(url))
            return url;
    }
    return new URL(filename, baseUri);
}
exports.getDependencyUrl = getDependencyUrl;
function positionToPoint(pos) {
    return {
        row: pos.line,
        column: pos.character,
    };
}
exports.positionToPoint = positionToPoint;
function pointToPosition(point) {
    return {
        line: point.row,
        character: point.column,
    };
}
exports.pointToPosition = pointToPosition;
function getPrecedingComments(node) {
    if (!node)
        return '';
    let comment = [];
    let currentNode = node.previousNamedSibling;
    while ((currentNode === null || currentNode === void 0 ? void 0 : currentNode.type) === 'comment') {
        comment.unshift(currentNode.text.replaceAll(/#+\s?/g, ''));
        currentNode = currentNode.previousNamedSibling;
    }
    return comment.join('\n');
}
exports.getPrecedingComments = getPrecedingComments;
function isFishExtension(path) {
    const ext = (0, path_1.extname)(path).toLowerCase();
    return ext === '.fish';
}
exports.isFishExtension = isFishExtension;
function isPositionWithinRange(position, range) {
    const doesStartInside = position.line > range.start.line ||
        (position.line === range.start.line && position.character >= range.start.character);
    const doesEndInside = position.line < range.end.line ||
        (position.line === range.end.line && position.character <= range.end.character);
    return doesStartInside && doesEndInside;
}
exports.isPositionWithinRange = isPositionWithinRange;
function isNodeWithinRange(node, range) {
    const doesStartInside = node.startPosition.row > range.start.line ||
        (node.startPosition.row === range.start.line &&
            node.startPosition.column >= range.start.character);
    const doesEndInside = node.endPosition.row < range.end.line ||
        (node.endPosition.row === range.end.line &&
            node.endPosition.column <= range.end.character);
    return doesStartInside && doesEndInside;
}
exports.isNodeWithinRange = isNodeWithinRange;
function* nodesGen(node) {
    const queue = [node];
    while (queue.length) {
        const n = queue.shift();
        if (!n)
            return;
        if (n.children.length) {
            queue.unshift(...n.children);
        }
        yield n;
    }
}
exports.nodesGen = nodesGen;
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
//# sourceMappingURL=tree-sitter.js.map