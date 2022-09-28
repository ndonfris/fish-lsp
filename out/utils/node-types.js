"use strict";
// use this file to determine node types from ./tree-sitter
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLastVariableRefrence = exports.findFunctionScope = exports.hasParentFunction = exports.findGlobalNodes = exports.findDefinedVariable = exports.isVariableDefintion = exports.findParentCommand = exports.isVariable = exports.isStatement = exports.isCommand = exports.isFunctionDefinintion = exports.isComment = void 0;
const tree_sitter_1 = require("./tree-sitter");
function isComment(node) {
    return node.type == 'comment';
}
exports.isComment = isComment;
function isFunctionDefinintion(node) {
    return node.type == 'function_definition';
}
exports.isFunctionDefinintion = isFunctionDefinintion;
function isCommand(node) {
    return [
        'command',
        'test_command'
    ].includes(node.type);
}
exports.isCommand = isCommand;
function isStatement(node) {
    return [
        'for_statement',
        'switch_statement',
        'while_statement',
        'if_statement',
        'else_clause',
        'else_if_clause',
    ].includes(node.type);
}
exports.isStatement = isStatement;
/*
 * Checks for nodes which should stop the search for
 * command nodes, used in findParentCommand()
 */
function isBeforeCommand(node) {
    return [
        'file_redirect',
        'redirect',
        'redirected_statement',
        'conditional_execution',
        'stream_redirect',
        'pipe',
    ].includes(node.type) || isFunctionDefinintion(node) || isStatement(node);
}
function isVariable(node) {
    if (isVariableDefintion(node)) {
        return true;
    }
    else {
        return ["variable_expansion", "variable_name"].includes(node.type);
    }
}
exports.isVariable = isVariable;
/**
 * finds the parent command of the current node
 *
 * @param {SyntaxNode} node - the node to check for its parent
 * @returns {SyntaxNode | null} command node or null
 */
function findParentCommand(node) {
    let currentNode = node;
    while (currentNode.parent != null) {
        if (isCommand(currentNode)) {
            return currentNode;
        }
        else if (isBeforeCommand(currentNode)) {
            return null;
        }
        currentNode = currentNode.parent;
    }
    return null;
}
exports.findParentCommand = findParentCommand;
function isVariableDefintion(node) {
    var _a, _b, _c;
    if (isCommand(node) && ((_a = node.child(0)) === null || _a === void 0 ? void 0 : _a.text) == 'set') {
        return true;
    }
    else {
        const parent = findParentCommand(node);
        if (!parent) {
            return false;
        }
        if (isCommand(parent) && ((_b = parent === null || parent === void 0 ? void 0 : parent.child(0)) === null || _b === void 0 ? void 0 : _b.text) == 'set') {
            return ((_c = findDefinedVariable(parent)) === null || _c === void 0 ? void 0 : _c.text) == (node === null || node === void 0 ? void 0 : node.text);
        }
        return false;
    }
}
exports.isVariableDefintion = isVariableDefintion;
/**
 * @param {SyntaxNode} node - finds the node in a fish command that will
 *                            contain the variable defintion
 *
 * @return {SyntaxNode | null} variable node that was found
 **/
function findDefinedVariable(node) {
    let parent = findParentCommand(node);
    if (!parent)
        return null;
    const children = parent.children;
    let i = 1;
    let child = children[i];
    while (child != undefined) {
        if (!child.text.startsWith('-')) {
            return child;
        }
        if (i == children.length - 1) {
            return null;
        }
        child = children[i++];
    }
    return child;
}
exports.findDefinedVariable = findDefinedVariable;
// global nodes are nodes that are not defined in a function
// (i.e. stuff in config.fish)
function findGlobalNodes(rootNode) {
    const globalNodes = [];
    //const allNodes = 
    //    getNodes(rootNode)
    //    .filter(currentNode => !hasParentFunction(currentNode))
    const allNodes = [
        ...(0, tree_sitter_1.getNodes)(rootNode)
            .filter(n => !hasParentFunction(n))
    ].filter(n => n.type != 'program');
    return allNodes;
}
exports.findGlobalNodes = findGlobalNodes;
function hasParentFunction(node) {
    var currentNode = node;
    while (currentNode != null) {
        if (isFunctionDefinintion(currentNode) || currentNode.type == 'function') {
            return true;
        }
        if (currentNode.parent == null) {
            return false;
        }
        currentNode = currentNode === null || currentNode === void 0 ? void 0 : currentNode.parent;
    }
    return false;
}
exports.hasParentFunction = hasParentFunction;
function findFunctionScope(node) {
    while (node.parent != null) {
        if (isFunctionDefinintion(node)) {
            return node;
        }
        node = node.parent;
    }
    return node;
}
exports.findFunctionScope = findFunctionScope;
function findLastVariableRefrence(node) {
    let currentNode = node.parent || node;
    while (!isFunctionDefinintion(currentNode) && currentNode != null) {
        let lastRefrence;
        for (const childNode of (0, tree_sitter_1.getNodes)(currentNode)) {
            if (isVariableDefintion(currentNode)) {
                const variableDef = findDefinedVariable(childNode);
                if ((variableDef === null || variableDef === void 0 ? void 0 : variableDef.text) == currentNode.text && variableDef != currentNode) {
                    return variableDef;
                }
            }
        }
        if (currentNode.parent == null) {
            return undefined;
        }
        currentNode = currentNode.parent;
    }
    return undefined;
}
exports.findLastVariableRefrence = findLastVariableRefrence;
/*
 * echo $hello_world
 *           ^--- variable_name
 * fd --type f
 *        ^------- word
 *           ^--- word
 */
function vaildCommandArgument(node) {
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
    ].includes(node.type);
}
function isCommandArg(node) {
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
    ].includes(node.type);
}
//# sourceMappingURL=node-types.js.map