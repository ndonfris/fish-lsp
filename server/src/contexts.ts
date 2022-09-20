import { SyntaxNode } from 'web-tree-sitter'
import {getChildrenArray} from './utils/tree-sitter';

export function isComment(node: SyntaxNode): boolean {
    return node.type == 'comment';
}

export function isFunctionDefinintion(node: SyntaxNode): boolean {
    return node.type == 'function_definition';
}

export function isCommand(node: SyntaxNode): boolean {
    return [
        'command',
        'test_command'
    ].includes(node.type);
}

export function isStatement(node: SyntaxNode): boolean {
    return [
        'for_statement',
        'switch_statement',
        'while_statement',
        'if_statement',
        'else_clause',
        'else_if_clause',
    ].includes(node.type);
}


/*
 * Checks for nodes which should stop the search for 
 * command nodes, used in findParentCommand()
 */
function isBeforeCommand(node: SyntaxNode) {
    return [
        'file_redirect',
        'redirect',
        'redirected_statement',
        'conditional_execution',
        'stream_redirect',
        'pipe',
    ].includes(node.type) || isFunctionDefinintion(node) || isStatement(node);
}

/**
 * finds the parent command of the current node
 *
 * @param {SyntaxNode} node - the node to check for its parent
 * @returns {SyntaxNode | null} command node or null
 */
export function findParentCommand(node: SyntaxNode): SyntaxNode | null {
    let currentNode: SyntaxNode = node;
    while (currentNode.parent != null) {
        if (isCommand(currentNode)) {
            return currentNode;
        } else if (isBeforeCommand(currentNode)) {
            return null
        }
        currentNode = currentNode.parent;
    }
    return null;
}


export function isVariableDefintion(node: SyntaxNode): boolean {
    return isCommand(node) && node.child(0)?.text == 'set'
}

/**
 * @param {SyntaxNode} node - finds the node in a fish command that will
 *                            contain the variable defintion 
 *
 * @return {SyntaxNode | null} variable node that was found    
 **/
export function findDefinedVariable(node: SyntaxNode): SyntaxNode | null {
    let parent = findParentCommand(node);
    if (!parent) return null;

    const children: SyntaxNode[] = getChildrenArray(parent)

    let i = 1;
    let child : SyntaxNode = children[i]!;

    while (child != undefined && child.text.startsWith('-')) {
        if (i == children.length) {
            return null
        }
        child = children[i++]!;
    }

    return child;
}


/*
 * echo $hello_world 
 *           ^--- variable_name
 * fd --type f
 *        ^------- word
 *           ^--- word
 */
function vaildCommandArgument(node: SyntaxNode) {
    return [
        'variable_expansion',
        'variable_name',
        'argument',
        'escape_sequence',
        'word',
        'double_quote_string',
        'single_quote_string',
        'test_option',
        'integer',
        'concatenation',
        'list_element_access',
        'index',
    ].includes(node.type)
}

function isCommandArg(node: SyntaxNode) {
    return [
        'word',
        'variable_name',
        'variable_expansion',
        'word',
        'double_quote_string',
        'single_quote_string',
        'integer',
        'concatenation',
        'list_element_access',
        'index',
    ].includes(node.type)
}


