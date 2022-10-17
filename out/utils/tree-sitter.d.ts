import { Position } from 'vscode-languageserver-textdocument';
import { Range, URI } from 'vscode-languageserver/node';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
/**
 * Returns an array for all the nodes in the tree (@see also nodesGen)
 *
 * @param {SyntaxNode} root - the root node to search from
 * @returns {SyntaxNode[]} all children of the root node (flattend)
 */
export declare function getChildNodes(root: SyntaxNode): SyntaxNode[];
/**
 * Gets path to root starting where index 0 is child node passed in.
 * Format: [child, child.parent, ..., root]
 *
 * @param {SyntaxNode} child - the lowest child of root
 * @returns {SyntaxNode[]} an array of ancestors to the descendent node passed in.
 */
export declare function getParentNodes(child: SyntaxNode): SyntaxNode[];
export declare function getNodeText(node: SyntaxNode | null): string;
/**
 * Checks that arg0 is located before arg1 in parse tree. False
 * when params are the same node
 *
 * @param {SyntaxNode} firstNode - a node that is positioned left or above second node
 * @param {SyntaxNode} secondNode - some node after first node
 * @returns {boolean} - true only when first param is located before second param
 */
export declare function nodeIsBefore(firstNode: SyntaxNode, secondNode: SyntaxNode): boolean;
export declare function ancestorMatch(start: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode[];
export declare function descendantMatch(start: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode[];
/**
 * uses nodesGen to build an array.
 *
 * @param {SyntaxNode} node - the root node of a document (where to begin search)
 * @returns {SyntaxNode[]} - all nodes seen in the document.
 */
export declare function getRange(node: SyntaxNode): Range;
/**
 * findNodeAt() - handles moving backwards if the cursor is not currently on a node (safer version of getNodeAt)
 */
export declare function findNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null;
/**
 * getNodeAt() - handles moving backwards if the cursor i
 */
export declare function getNodeAt(tree: Tree, line: number, column: number): SyntaxNode | null;
export declare function getNodeAtRange(tree: Tree, range: Range): SyntaxNode | null;
export declare function getDependencyUrl(node: SyntaxNode, baseUri: string): URL;
export declare function positionToPoint(pos: Position): Point;
export declare function pointToPosition(point: Point): Position;
export declare function getPrecedingComments(node: SyntaxNode | null): string;
export declare function isFishExtension(path: URI | string): boolean;
export declare function isPositionWithinRange(position: Position, range: Range): boolean;
export declare function isNodeWithinRange(node: SyntaxNode, range: Range): boolean;
export declare function nodesGen(node: SyntaxNode): Generator<SyntaxNode, void, unknown>;
//# sourceMappingURL=tree-sitter.d.ts.map