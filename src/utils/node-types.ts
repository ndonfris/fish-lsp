import { SyntaxNode } from 'web-tree-sitter';
import { ancestorMatch, findChildNodes, findFirstParent, findFirstNamedSibling, firstAncestorMatch, getChildNodes, getParentNodes, getSiblingNodes, getLeafs } from './tree-sitter';
import * as VariableTypes from './variable-syntax-nodes';

/**
 * fish shell comment: '# ...'
 */
export function isComment(node: SyntaxNode): boolean {
  return node.type === 'comment' && !isShebang(node);
}

export function isShebang(node: SyntaxNode) {
  const parent = node.parent;
  if (!parent || !isProgram(parent)) {
    return false;
  }
  const firstLine = parent.firstChild;
  if (!firstLine) {
    return false;
  }
  if (!node.equals(firstLine)) {
    return false;
  }
  return (
    firstLine.type === 'comment' &&
        firstLine.text.startsWith('#!') &&
        firstLine.text.includes('fish')
  );
}

/**
 * function some_fish_func
 *     ...
 * end
 * @see isFunctionDefinitionName()
 */
export function isFunctionDefinition(node: SyntaxNode): boolean {
  return node.type === 'function_definition';
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
  const funcName = parent?.firstNamedChild;
  if (!parent || !funcName) {
    return false;
  }
  if (!isFunctionDefinition(parent)) {
    return false;
  }
  return node.type === 'word' && node.equals(funcName);
}

/**
 * isVariableDefinitionName() || isFunctionDefinitionName()
 */
export function isDefinition(node: SyntaxNode): boolean {
  return isFunctionDefinitionName(node) || isVariableDefinitionName(node);
}

/**
 * checks if a node is the firstNamedChild of a command
 */
export function isCommandName(node: SyntaxNode) : boolean {
  const parent = node.parent || node;
  const cmdName = parent?.firstNamedChild || node?.firstNamedChild;
  if (!parent || !cmdName) {
    return false;
  }
  if (!isCommand(parent)) {
    return false;
  }
  return node.type === 'word' && node.equals(cmdName);
}

/**
 * the root node of a fish script
 */
export function isProgram(node: SyntaxNode): boolean {
  return node.type === 'program' || node.parent === null;
}

export function isError(node: SyntaxNode | null = null): boolean {
  if (node) {
    return node.type === 'ERROR';
  }
  return false;
}

export function isForLoop(node: SyntaxNode): boolean {
  return node.type === 'for_statement';
}

export function isIfStatement(node: SyntaxNode): boolean {
  return node.type === 'if_statement';
}

export function isElseStatement(node: SyntaxNode): boolean {
  return node.type === 'else_clause';
}

// strict check for if statement or else clauses
export function isConditional(node: SyntaxNode) : boolean {
  return ['if_statement', 'else_if_clause', 'else_clause'].includes(node.type);
}

export function isIfOrElseIfConditional(node: SyntaxNode) : boolean {
  return ['if_statement', 'else_if_clause'].includes(node.type);
}

export function isPossibleUnreachableStatement(node: SyntaxNode) : boolean {
  if (isIfStatement(node)) {
    return node.lastNamedChild?.type === 'else_clause';
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
    'begin_statement',
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
  return node.type === 'end';
}

//export function isLocalBlock(node: SyntaxNode): boolean {
//return ['begin_statement'].includes(node.type);
//}

/**
 * Any SyntaxNode that will enclose a new local scope:
 *      Program, Function, if, for, while
 */
export function isScope(node: SyntaxNode): boolean {
  return isProgram(node) || isFunctionDefinition(node) || isStatement(node); // || isLocalBlock(node)//
}

export function isSemicolon(node: SyntaxNode): boolean {
  return node.type === ';' && node.text === ';';
}

export function isNewline(node: SyntaxNode): boolean {
  return node.type === '\n';
}

export function isBlockBreak(node: SyntaxNode): boolean {
  return isEnd(node) || isSemicolon(node) || isNewline(node);
}

export function isString(node: SyntaxNode) {
  return [
    'double_quote_string',
    'single_quote_string',
  ].includes(node.type);
}

export function isStringCharacter(node: SyntaxNode) {
  return [
    "'",
    '"',
  ].includes(node.type);
}

export function isEndStdinCharacter(node: SyntaxNode) {
  return '--' === node.text && node.type === 'word';
}

export function isLongOption(node: SyntaxNode): boolean {
  return node.text.startsWith('--') && !isEndStdinCharacter(node);
}

export function isShortOption(node: SyntaxNode): boolean {
  return node.text.startsWith('-') && !isLongOption(node);
}
export function isOption(node: SyntaxNode): boolean {
  return isShortOption(node) || isLongOption(node);
}

export function isPipe(node: SyntaxNode): boolean {
  return node.type === 'pipe';
}

export function gatherSiblingsTillEol(node: SyntaxNode): SyntaxNode[] {
  const siblings = [];
  let next = node.nextSibling;
  while (next && !isNewline(next)) {
    siblings.push(next);
    next = next.nextSibling;
  }
  return siblings;
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
  ].includes(node.type) || isFunctionDefinition(node) || isStatement(node) || isSemicolon(node) || isNewline(node) || isEnd(node);
}

export function isVariable(node: SyntaxNode) {
  if (isVariableDefinition(node)) {
    return true;
  } else {
    return ['variable_expansion', 'variable_name'].includes(node.type);
  }
}

/**
 * finds the parent command of the current node
 *
 * @param {SyntaxNode} node - the node to check for its parent
 * @returns {SyntaxNode | null} command node or null
 */
export function findPreviousSibling(node?: SyntaxNode): SyntaxNode | null {
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

const defintionKeywords = ['set', 'read', 'function', 'for'];

// TODO: check if theres a child node that is a variable definition -> return full command
export function isVariableDefinitionCommand(node: SyntaxNode): boolean {
  if (!isCommand(node)) {
    return false;
  }
  const command = node.firstChild?.text.trim() || '';
  if (defintionKeywords.includes(command)) {
    return true;
  }
  // if (isCommand(node) && defintionKeywords.includes(node.firstChild?.text || '')) {
  //     const variableDef = findChildNodes(node, isVariableDefinition)
  //     if (variableDef.length > 0) {
  //         return true;
  //     }
  // }
  return false;
}

export function findParentVariableDefintionKeyword(node?: SyntaxNode): SyntaxNode | null {
  const currentNode: SyntaxNode | null | undefined = node;
  const parent = currentNode?.parent;
  if (!currentNode || !parent) {
    return null;
  }
  const varKeyword = parent.firstChild?.text.trim() || '';
  if (!varKeyword) {
    return null;
  }
  if (defintionKeywords.includes(varKeyword)) {
    return parent;
  }
  return null;
}

export function refinedFindParentVariableDefinitionKeyword(node?: SyntaxNode): SyntaxNode | null {
  const currentNode: SyntaxNode | null | undefined = node;
  const parent = currentNode?.parent;
  if (!currentNode || !parent) {
    return null;
  }
  const varKeyword = parent.firstChild?.text.trim() || '';
  if (!varKeyword) {
    return null;
  }
  if (defintionKeywords.includes(varKeyword)) {
    return parent.firstChild!;
  }
  return null;
}

// @TODO: replace isVariableDefinition with this
export function isVariableDefinitionName(node: SyntaxNode): boolean {
  if (isFunctionDefinition(node) ||
        isCommand(node) ||
        isCommandName(node) ||
        defintionKeywords.includes(node.firstChild?.text || '') ||
        !VariableTypes.isPossible(node)
  ) {
    return false;
  }
  const keyword = refinedFindParentVariableDefinitionKeyword(node);
  if (!keyword) {
    return false;
  }
  const siblings = VariableTypes.gatherVariableSiblings(keyword);
  switch (keyword.text) {
    case 'set':
      return VariableTypes.isSetDefinitionNode(siblings, node);
    case 'read':
      return VariableTypes.isReadDefinitionNode(siblings, node);
    case 'function':
      return VariableTypes.isFunctionArgumentDefinitionNode(siblings, node);
    case 'for':
      return VariableTypes.isForLoopDefinitionNode(siblings, node);
    default:
      return false;
  }
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
  return isVariableDefinitionName(node);
}

function findParentForScope(currentNode: SyntaxNode, switchFound: VariableScope | '') : SyntaxNode | null {
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
  if (!isVariableDefinition(currentNode)) {
    return null;
  }
  const parent = findParentVariableDefintionKeyword(currentNode);
  const switchFound = findSwitchForVariable(currentNode);
  //console.log(`switchFound: ${switchFound}`)
  if (!parent) {
    return null;
  }
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

export function findForLoopVariable(node: SyntaxNode) : SyntaxNode | null {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child?.type === 'variable_name') {
      return child;
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
  const parent = findParentCommand(node);
  if (!parent) {
    return null;
  }

  const children: SyntaxNode[] = parent.children;

  let i = 1;
  let child : SyntaxNode = children[i]!;

  while (child !== undefined) {
    if (!child.text.startsWith('-')) {
      return child;
    }
    if (i === children.length - 1) {
      return null;
    }
    child = children[i++]!;
  }

  return child;
}

//// for function variables

function isArgFlags(node: SyntaxNode) {
  return node.type === 'word'
    ? node.text === '--argument-names' || node.text === '-a'
    : false;
}

export type VariableScope = 'global' | 'local' | 'universal' | 'export' | 'unexport' | 'function';
export const VariableScopeFlags: {[flag: string]: VariableScope;} = {
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
};

//// for read variables
function findLastFlag(nodes: SyntaxNode[]) {
  let maxIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    if (child?.text.startsWith('-')) {
      maxIdx = Math.max(i, maxIdx);
    }
  }
  return maxIdx;
}

function findSwitchForVariable(node: SyntaxNode) : VariableScope | '' {
  let current: SyntaxNode | null = node;
  while (current !== null) {
    if (VariableScopeFlags[current.text] !== undefined) {
      return VariableScopeFlags[current.text] || '';
    } else if (current.text.startsWith('-')) {
      return '';
    }
    current = current.previousSibling;
  }
  return 'function';
}

export function findReadVariables(node: SyntaxNode) {
  const variables : SyntaxNode[] = [];
  const lastFlag = findLastFlag(node.children);
  variables.push(...node.children.slice(lastFlag + 1).filter(n => n.type === 'word'));
  const possibleFlags = node.children.slice(0, lastFlag + 1);
  for (let i = 0; i < possibleFlags.length; i++) {
    const child = possibleFlags[i];
    if (VariableScopeFlags[child?.text || ''] !== undefined) {
      i++;
      while (i < possibleFlags.length && possibleFlags[i]?.type === 'word') {
        if (possibleFlags[i]?.text.startsWith('-')) {
          break;
        } else {
          variables.unshift(possibleFlags[i]!);
        }
        i++;
      }
    }
  }
  return variables;
}

export function hasParentFunction(node: SyntaxNode) {
  let currentNode: SyntaxNode = node;
  while (currentNode !== null) {
    if (isFunctionDefinition(currentNode) || currentNode.type === 'function') {
      return true;
    }
    if (currentNode.parent === null) {
      return false;
    }
    currentNode = currentNode?.parent;
  }
  return false;
}

export function findFunctionScope(node: SyntaxNode) {
  while (node.parent !== null) {
    if (isFunctionDefinition(node)) {
      return node;
    }
    node = node.parent;
  }
  return node;
}

// node1 encloses node2
export function scopeCheck(node1: SyntaxNode, node2: SyntaxNode) : boolean {
  const scope1 = findFunctionScope(node1);
  const scope2 = findFunctionScope(node2);
  if (isProgram(scope1)) {
    return true;
  }
  return scope1 === scope2;
}

export function isLocalVariable(node: SyntaxNode) {
  const parents = getParentNodes(node);
  //if (pCmd.child(0)?.text === 'read' || pCmd.child(0)?.text === 'set') {
  //    console.log(pCmd.text)
  //}
}

export function wordNodeIsCommand(node: SyntaxNode) {
  if (node.type !== 'word') {
    return false;
  }
  return node.parent ? isCommand(node.parent) && node.parent.firstChild?.text === node.text : false;
}

export function isSwitchStatement(node: SyntaxNode) {
  return node.type === 'switch_statement';
}

export function isCaseClause(node: SyntaxNode) {
  return node.type === 'case_clause';
}

export function isReturn(node: SyntaxNode) {
  return node.type === 'return' && node.firstChild?.text === 'return';
  //return node.type === 'return'
}

export function isConditionalCommand(node: SyntaxNode) {
  return node.type === 'conditional_execution';
}

// @TODO: see ./tree-sitter.ts -> getRangeWithPrecedingComments(),
//        for implementation of chained returns of conditional_executions
export function chainedCommandGroup() : SyntaxNode[] {
  return [];
}

/*
 * echo $hello_world
 *           ^--- variable_name
 * fd --type f
 *        ^------- word
 *           ^--- word
 */

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

export function isUnmatchedStringCharacter(node: SyntaxNode) {
  if (!isStringCharacter(node)) {
    return false;
  }
  if (node.parent && isString(node.parent)) {
    return false;
  }
  return true;
}

export function isPartialForLoop(node: SyntaxNode) {
  const semiCompleteForLoop = ['for', 'i', 'in', '_'];
  const errorNode = node.parent;
  if (node.text === 'for' && node.type === 'for') {
    if (!errorNode) {
      return true;
    }
    if (getLeafs(errorNode).length < semiCompleteForLoop.length) {
      return true;
    }
    return false;
  }
  if (!errorNode) {
    return false;
  }
  return (
    errorNode.hasError &&
        errorNode.text.startsWith('for') &&
        !errorNode.text.includes(' in ')
  );
}
