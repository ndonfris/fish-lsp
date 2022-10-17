// use this file to determine node types from ./tree-sitter

import { SyntaxNode } from 'web-tree-sitter'
import {getChildNodes} from './tree-sitter';


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
export function isBeforeCommand(node: SyntaxNode) {
    return [
        'file_redirect',
        'redirect',
        'redirected_statement',
        'conditional_execution',
        'stream_redirect',
        'pipe',
    ].includes(node.type) || isFunctionDefinintion(node) || isStatement(node);
}

export function isVariable(node: SyntaxNode) {
    if (isVariableDefintion(node)) {
        return true;
    } else {
        return ["variable_expansion", "variable_name"].includes(node.type);
    }
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
// isBeforeCommand() is probably not necessary:
// for example:
//      echo -n "$asdf"
//        | ^
//        | ---- children
//        |
//        ---- parent
//


export function isVariableDefintion(node: SyntaxNode): boolean {
    if (isCommand(node) && node.child(0)?.text == 'set') {
        return true;
    } else {
        const parent = findParentCommand(node)
        if (!parent) {
            return false;
        } 
        if (isCommand(parent) && parent?.child(0)?.text == 'set') {
            return findDefinedVariable(parent)?.text == node?.text; 
        }
        return false;
    }
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

    const children: SyntaxNode[] = parent.children

    let i = 1;
    let child : SyntaxNode = children[i]!;

    while (child != undefined) {
        if (!child.text.startsWith('-')) {
            return child
        }
        if (i == children.length - 1) {
            return null
        }
        child = children[i++]!;
    }

    return child;
}

// global nodes are nodes that are not defined in a function
// (i.e. stuff in config.fish)
export function findGlobalNodes(rootNode: SyntaxNode) {
    const globalNodes : SyntaxNode[] = []
    //const allNodes = 
    //    getNodes(rootNode)
    //    .filter(currentNode => !hasParentFunction(currentNode))
    const allNodes = [ 
        ...getChildNodes(rootNode)
            .filter(n => !hasParentFunction(n))
    ].filter(n => n.type != 'program')
    return allNodes
}

export function hasParentFunction(node: SyntaxNode) {
    var currentNode: SyntaxNode = node;
    while (currentNode != null) {
        if (isFunctionDefinintion(currentNode) || currentNode.type == 'function') {
            return true
        }
        if (currentNode.parent == null) {
            return false;
        }
        currentNode = currentNode?.parent;
    }
    return false;
}

export function findFunctionScope(node: SyntaxNode) {
    while (node.parent != null) {
        if (isFunctionDefinintion(node)) {
            return node;
        }
        node = node.parent;
    }
    return node
}

export function findLastVariableRefrence(node: SyntaxNode) {
    let currentNode = node.parent || node;
    while (!isFunctionDefinintion(currentNode) && currentNode != null) {
        let lastRefrence: SyntaxNode;
        for (const childNode of getChildNodes(currentNode)) {
            if (isVariableDefintion(currentNode)) {
                const variableDef = findDefinedVariable(childNode)
                if (variableDef?.text == currentNode.text && variableDef != currentNode) {
                    return variableDef;
                }
            }
        }
        if (currentNode.parent == null) {
            return undefined
        }
        currentNode = currentNode.parent;
    }
    return undefined;
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


