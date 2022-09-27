"use strict";
// use this file to determine node types from ./tree-sitter
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDefinedVariable = exports.isVariableDefintion = exports.findParentCommand = exports.isVariable = exports.isStatement = exports.isCommand = exports.isFunctionDefinintion = exports.isComment = void 0;
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
        return node.type === 'variable_expansion';
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
    var _a, _b;
    if (isCommand(node) && ((_a = node.child(0)) === null || _a === void 0 ? void 0 : _a.text) == 'set') {
        return true;
    }
    else {
        const parent = findParentCommand(node);
        if (!parent) {
            return false;
        }
        if (isCommand(parent) && ((_b = parent === null || parent === void 0 ? void 0 : parent.child(0)) === null || _b === void 0 ? void 0 : _b.text) == 'set') {
            return findDefinedVariable(parent) == node;
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
        if (i == children.length) {
            return null;
        }
        child = children[i++];
    }
    return child;
}
exports.findDefinedVariable = findDefinedVariable;
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