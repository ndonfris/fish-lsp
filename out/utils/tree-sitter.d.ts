import { Position } from 'vscode-languageserver-textdocument';
import { Range, URI } from 'vscode-languageserver/node';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
/**
 * Returns an array for all the nodes in the tree (@see also nodesGen)
 *
 * @param {SyntaxNode} root - the root node to search from
 * @returns {SyntaxNode[]} all children of the root node (flattend)
 */
export declare function getNodes(root: SyntaxNode): SyntaxNode[];
export declare function getNodeText(node: SyntaxNode | null): string;
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
export declare function findParent(start: SyntaxNode, predicate: (n: SyntaxNode) => boolean): SyntaxNode | null;
//# sourceMappingURL=tree-sitter.d.ts.map