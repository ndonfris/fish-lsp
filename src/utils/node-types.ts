// use this file to determine node types from ./tree-sitter
import {RemoteConsole} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter'
import {ancestorMatch, findFirstParent, findFirstSibling, firstAncestorMatch, getChildNodes, getParentNodes, getSiblingNodes} from './tree-sitter';

/** 
 * fish shell comment: '# ...'                    
 */
export function isComment(node: SyntaxNode): boolean {
    return node.type == 'comment';
}

/**
 * function some_fish_func
 *     ...
 * end
 * @see isFunctionDefinitionName()
 */
export function isFunctionDefinition(node: SyntaxNode): boolean {
    return node.type == 'function_definition';
}


/**
 * checks for all fish types of SyntaxNodes that are commands.
 */
export function isCommand(node: SyntaxNode): boolean {
    return [
        'command',
        'test_command',
        'command_substitution',
    ].includes(node.type);
}

/**
 * essentailly avoids having to null check functionDefinition nodes for having a function
 * name, since 
 *
 * @param {SyntaxNode} node - the node to check
 * @returns {boolean} true if the node is the firstNamedChild of a function_definition
 */
export function isFunctionDefinitionName(node: SyntaxNode): boolean {
    const parent = node.parent;
    const funcName = parent?.firstNamedChild
    if (!parent || !funcName) return false;
    if (!isFunctionDefinition(parent)) return false;
    return node.type == 'word' && node.equals(funcName);
}

// isVariableDefinition || isFunctionDefinitionName
export function isDefinition(node: SyntaxNode): boolean {
    return isFunctionDefinitionName(node) || isVariableDefinition(node);
}

/**
 * checks if a node is the firstNamedChild of a command
 */
export function isCommandName(node: SyntaxNode) : boolean {
    const parent = node.parent || node;
    const cmdName = parent?.firstNamedChild || node?.firstNamedChild;
    if (!parent || !cmdName) return false;
    if (!isCommand(parent)) return false;
    return node.type == 'word' && node.equals(cmdName);
}

/**
 * the root node of a fish script 
 */
export function isProgram(node: SyntaxNode): boolean {
    return node.type == 'program' || node.parent == null;
}

export function isError(node: SyntaxNode | null = null): boolean {
    if (node ) {
        return node.type == 'ERROR';
    }
    return false;
}

export function isForLoop(node: SyntaxNode): boolean {
    return node.type === 'for_statement'
}

export function isIfStatement(node: SyntaxNode): boolean {
    return node.type === 'if_statement'
}

export function isElseStatement(node: SyntaxNode): boolean {
    return node.type === 'else_clause'
}

// strict check for if statement or else clauses
export function isConditional(node: SyntaxNode) : boolean {
    return ['if_statement', 'else_if_clause', 'else_clause'].includes(node.type)
}

export function isPossibleUnreachableStatement(node: SyntaxNode) : boolean {
    if (isIfStatement(node)) {
        return node.lastNamedChild?.type === 'else_clause'
    } else if (node.type === 'for_statement') {
        return true;
    } else if (node.type === 'switch_statement') {
        return false;
    }
    return false;
}

export function isClause(node: SyntaxNode): boolean {
    return [
        'case_clause',
        'else_clause',
        'else_if_clause',
    ].includes(node.type);
}

/**
 * statements contain clauses
 */
export function isStatement(node: SyntaxNode): boolean {
    return [
        'for_statement',
        'switch_statement',
        'while_statement',
        'if_statement',
    ].includes(node.type);
}

/**
 * since statement SyntaxNodes contains clauses, treats statements and clauses the same:
 * if ...           - if_statement 
 * else if ...      --- else_if_clause
 * else ...         --- else_clause 
 * end;
 */
export function isBlock(node: SyntaxNode): boolean {
    return isClause(node) || isStatement(node);
}

export function isEnd(node: SyntaxNode): boolean {
    return node.type == 'end';
}

/**
 * Any SyntaxNode that will enclose a new local scope: 
 *      Program, Function, if, for, while
 */
export function isScope(node: SyntaxNode): boolean {
    return isProgram(node) || isFunctionDefinition(node) || isStatement(node)
}

export function isNewline(node: SyntaxNode): boolean {
    return node.type == '\n';
}

export function isString(node: SyntaxNode) {
    return [
        'double_quote_string',
        'single_quote_string',
    ].includes(node.type)
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
    ].includes(node.type) || isFunctionDefinition(node) || isStatement(node);
}

export function isVariable(node: SyntaxNode) {
    if (isVariableDefinition(node)) {
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
export function findParentCommand(node?: SyntaxNode): SyntaxNode | null {
    let currentNode: SyntaxNode | null | undefined = node;
    if (!currentNode) {
        return null;
    }
    while (currentNode !== null) {
        if (isCommand(currentNode)) {
            return currentNode;
        }
        currentNode = currentNode.parent;
    }
    return null;
}

/**
 * finds the parent function of the current node
 *
 * @param {SyntaxNode} node - the node to check for its parent
 * @returns {SyntaxNode | null} command node or null
 */
export function findParentFunction(node?: SyntaxNode): SyntaxNode | null {
    let currentNode: SyntaxNode | null | undefined = node;
    if (!currentNode) {
        return null;
    }
    while (currentNode !== null) {
        if (isFunctionDefinition(currentNode)) {
            return currentNode;
        }
        currentNode = currentNode.parent;
    }
    return null;
}


const defintionKeywords = ['set', 'read', 'function', 'for']

export function findParentVariableDefintionKeyword(node?: SyntaxNode): SyntaxNode | null {
    const currentNode: SyntaxNode | null | undefined = node;
    const parent = currentNode?.parent;
    if (!currentNode || !parent) {
        return null;
    }
    //const oKeyword = currentNode.previousNamedSibling?.text.trim() || "";
    const varKeyword = parent.firstChild?.text.trim() || "";
    if (!varKeyword) return null;
    //console.log(`oKeyword: ${oKeyword}, varKeyword: ${varKeyword}`)
    if (defintionKeywords.includes(varKeyword)) {
        //console.log(`varKeyword: ${varKeyword}, node: ${currentNode.text}`)
        return parent;
    }
    return null;
}

/**
 * checks if a node is a variable defintion. Current syntax tree from tree-sitter-fish will
 * only tokenize variable names if they are defined in a for loop. Otherwise, they are tokenized
 * with the node type of 'name'. Currently does not support argparse.
 *
 * @param {SyntaxNode} node - the node to check if it is a variable defintion
 * @returns {boolean} true if the node is a variable defintion, false otherwise
 */
export function isVariableDefinition(node: SyntaxNode): boolean {
    if (isFunctionDefinition(node) || isCommand(node) || isCommandName(node) || defintionKeywords.includes(node.firstChild?.text || "")) {
        return false;
    } 
    const parent = findParentVariableDefintionKeyword(node);
    if (!parent) return false;
    switch (parent.firstChild?.text) {
        case 'set':
            const setVar = findSetDefinedVariable(parent);
            return setVar !== null ? node.equals(setVar) : false;
        case 'read':
            return findReadVariables(parent).filter(n => n.equals(node)).length > 0;
        case 'function':
            return findArgumentFlag(parent).filter(n => n.equals(node)).length > 0;
        case 'for':
            const forVar = findForLoopVariable(parent);
            return forVar !== null ? node.equals(forVar) : false;
        default:          
            return false; 
    }
}

function findParentForScope(currentNode: SyntaxNode, switchFound: VariableScope | "") : SyntaxNode | null {
    switch (switchFound) {
        case 'local': 
            return firstAncestorMatch(currentNode, (n) => isStatement(n) || isFunctionDefinition(n) || isProgram(n));
        case 'function':
            return firstAncestorMatch(currentNode, (n) => isFunctionDefinition(n));
        case '':
            return firstAncestorMatch(currentNode, (n) => isFunctionDefinition(n) || isProgram(n));
        case 'universal':
        case 'global':
        case 'export':
            return firstAncestorMatch(currentNode, (n) => isProgram(n));
        default:
            return null;
    }
}

export function findEnclosingVariableScope(currentNode: SyntaxNode): SyntaxNode | null {
    if (!isVariableDefinition(currentNode)) return null
    const parent = findParentVariableDefintionKeyword(currentNode);
    const switchFound = findSwitchForVariable(currentNode);
    //console.log(`switchFound: ${switchFound}`)
    if (!parent) return null;
    switch (parent.firstChild?.text) {
        case 'set':
            return findParentForScope(currentNode, switchFound); // implement firstAncestorMatch for array of functions 
        case 'read':
            return findParentForScope(currentNode, switchFound);
        case 'function':
            return parent;
        case 'for':
            return parent;
        default:          
            return null; 
    }

}

export function findForLoopVariable(node: SyntaxNode) : SyntaxNode | null{
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (child.type === 'variable_name') {
            return child
        }
    }
    return null;
}

/**
 * @param {SyntaxNode} node - finds the node in a fish command that will
 *                            contain the variable defintion 
 *
 * @return {SyntaxNode | null} variable node that was found    
 **/
export function findSetDefinedVariable(node: SyntaxNode): SyntaxNode | null {
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

//// for function variables

/** 
 * for function variable defintions
 * @param {SyntaxNode} node - finds the node in a fish command that will
 * @return {SyntaxNode[]} variable nodes that were found
 */
function findArgumentFlag(node: SyntaxNode) : SyntaxNode[] {
    const flags : SyntaxNode[] = [];
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (isArgFlags(child)) {
            let varName = child.nextSibling;
            while (varName !== null && varName.type === 'word' && !varName.text.startsWith("-")) {
                flags.push(varName)
                varName = varName.nextSibling
            }
        }
    }
    return flags;
}

function isArgFlags(node: SyntaxNode) {
    return node.type === 'word'
        ? node.text === '--argument-names' || node.text === '-a'
        : false;
}

export type VariableScope = 'global' | 'local' | 'universal' | 'export' | 'unexport' | 'function' 
export const VariableScopeFlags: {[flag: string]: VariableScope} = {
    '-g': 'global',
    '--global': 'global',
    '-l': 'local',
    '--local': 'local',
    '-U': 'universal',
    '--universal': 'universal',
    '-x': 'export',
    '-gx': 'global',
    '--export': 'export',
    '-u': 'unexport',
    '--unexport': 'unexport',
}


//// for read variables
function findLastFlag(nodes: SyntaxNode[]) {
    let maxIdx = 0;
    for (let i = 0; i < nodes.length; i++) {
        const child = nodes[i]
        if (child.text.startsWith('-')) {
            maxIdx = Math.max(i, maxIdx)
        }
    }
    return maxIdx;
}

function findSwitchForVariable(node: SyntaxNode) : VariableScope | "" {
    let current: SyntaxNode | null = node;
    while (current !== null) {
        if (VariableScopeFlags[current.text] !== undefined) {
            return VariableScopeFlags[current.text]
        } else if (current.text.startsWith("-")) {
            return ""
        }
        current = current.previousSibling
    }
    return "function"
}

export function findReadVariables(node: SyntaxNode) {
    const variables : SyntaxNode[] = [];
    const lastFlag = findLastFlag(node.children);
    variables.push(...node.children.slice(lastFlag + 1).filter(n => n.type === 'word'))
    const possibleFlags = node.children.slice(0, lastFlag + 1)
    for (let i = 0; i < possibleFlags.length; i++) {
        const child = possibleFlags[i]
        if (VariableScopeFlags[child.text] !== undefined) { 
            i++;
            while (i < possibleFlags.length && possibleFlags[i].type === 'word') {
                if (possibleFlags[i].text.startsWith('-')) {
                    break;
                } else {
                    variables.unshift(possibleFlags[i])
                }
                i++;
            }
        }
    }
    return variables;
}

export function hasParentFunction(node: SyntaxNode) {
    var currentNode: SyntaxNode = node;
    while (currentNode != null) {
        if (isFunctionDefinition(currentNode) || currentNode.type == 'function') {
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
        if (isFunctionDefinition(node)) {
            return node;
        }
        node = node.parent;
    }
    return node
}

// node1 encloses node2
export function scopeCheck(node1: SyntaxNode , node2: SyntaxNode) : boolean {
    const scope1 = findFunctionScope(node1);
    const scope2 = findFunctionScope(node2);
    if (isProgram(scope1)) {
        return true;
    }
    return scope1 == scope2;
}

export function isLocalVariable(node: SyntaxNode, console: RemoteConsole) {
    const parents = getParentNodes(node)
    const pCmd = parents[1]
    //if (pCmd.child(0)?.text === 'read' || pCmd.child(0)?.text === 'set') {
    //    console.log(pCmd.text)
    //}
}

export function wordNodeIsCommand(node: SyntaxNode) {
    if (node.type !== 'word') return false; 
    return node.parent ? isCommand(node.parent) && node.parent.firstChild?.text === node.text : false
}

export function isSwitchStatement(node: SyntaxNode) {
    return node.type === 'switch_statement'
}

export function isCaseClause(node: SyntaxNode) {
    return node.type === 'case_clause'
}    

export function isReturn(node: SyntaxNode) {
    //return node.type === 'return' && node.firstChild?.text === 'return'
    return node.type === 'return' 
}

export function isConditionalCommand(node: SyntaxNode) {
    return node.type === 'conditional_execution' 
}


// @TODO: see ./tree-sitter.ts -> getRangeWithPrecedingComments(),
//        for implementation of chained returns of conditional_executions
export function chainedCommandGroup(node: SyntaxNode) : SyntaxNode[] {
    return []
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

export function isCommandFlag(node: SyntaxNode) {
    return [
        'test_option',
        'word',
        'escape_sequence',
    ].includes(node.type) || node.text.startsWith('-') || findParentCommand(node) !== null;
}


export function isRegexArgument(n: SyntaxNode): boolean {
    return n.text === '--regex' || n.text === '-r';
}

export function isQuoteString(n: SyntaxNode): boolean {
    return [
        'double_quote_string',
        'single_quote_string',
    ].includes(n.type);
}
