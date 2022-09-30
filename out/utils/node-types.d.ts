import { SyntaxNode } from 'web-tree-sitter';
export declare function isComment(node: SyntaxNode): boolean;
export declare function isFunctionDefinintion(node: SyntaxNode): boolean;
export declare function isCommand(node: SyntaxNode): boolean;
export declare function isStatement(node: SyntaxNode): boolean;
export declare function isBeforeCommand(node: SyntaxNode): boolean;
export declare function isVariable(node: SyntaxNode): boolean;
/**
 * finds the parent command of the current node
 *
 * @param {SyntaxNode} node - the node to check for its parent
 * @returns {SyntaxNode | null} command node or null
 */
export declare function findParentCommand(node: SyntaxNode): SyntaxNode | null;
export declare function isVariableDefintion(node: SyntaxNode): boolean;
/**
 * @param {SyntaxNode} node - finds the node in a fish command that will
 *                            contain the variable defintion
 *
 * @return {SyntaxNode | null} variable node that was found
 **/
export declare function findDefinedVariable(node: SyntaxNode): SyntaxNode | null;
export declare function findGlobalNodes(rootNode: SyntaxNode): SyntaxNode[];
export declare function hasParentFunction(node: SyntaxNode): boolean;
export declare function findFunctionScope(node: SyntaxNode): SyntaxNode;
export declare function findLastVariableRefrence(node: SyntaxNode): SyntaxNode | undefined;
//# sourceMappingURL=node-types.d.ts.map