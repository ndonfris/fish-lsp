import { SyntaxNode } from 'web-tree-sitter';
import { getLeafNodes } from './tree-sitter';
import { VariableDefinitionKeywords } from '../parsing/barrel';
import { Option, isMatchingOption } from '../parsing/options';
import { isVariableDefinitionName, isFunctionDefinitionName, isAliasDefinitionName } from '../parsing/barrel';

// use the `../parsing/barrel` barrel file's imports for finding the definition names

export {
  isVariableDefinitionName,
  isFunctionDefinitionName,
  isAliasDefinitionName,
};

/**
 * checks if a node is a variable definition. Current syntax tree from tree-sitter-fish will
 * only tokenize variable names if they are defined in a for loop. Otherwise, they are tokenized
 * with the node type of 'name'.
 *
 * @param {SyntaxNode} node - the node to check if it is a variable definition
 * @returns {boolean} true if the node is a variable definition, false otherwise
 */
export function isVariableDefinition(node: SyntaxNode): boolean {
  return isVariableDefinitionName(node);
}

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

export function isTopLevelFunctionDefinition(node: SyntaxNode): boolean {
  if (isFunctionDefinition(node)) {
    return node.parent?.type === 'program';
  }
  if (isFunctionDefinitionName(node)) {
    return node.parent?.parent?.type === 'program';
  }
  return false;
}

export function isTopLevelDefinition(node: SyntaxNode): boolean {
  let currentNode: SyntaxNode | null = node;
  while (currentNode) {
    if (!currentNode) break;
    if (isProgram(currentNode)) {
      return true;
    }
    if (isFunctionDefinition(currentNode)) {
      return false;
    }
    currentNode = currentNode.parent;
  }
  return true;
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
export function isCommandName(node: SyntaxNode): boolean {
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
export function isConditional(node: SyntaxNode): boolean {
  return ['if_statement', 'else_if_clause', 'else_clause'].includes(node.type);
}

export function isIfOrElseIfConditional(node: SyntaxNode): boolean {
  return ['if_statement', 'else_if_clause'].includes(node.type);
}

export function isPossibleUnreachableStatement(node: SyntaxNode): boolean {
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

/**
 * Checks if a node is fish's end stdin token `--`
 * This is used to signal the end of stdin input, like in the argparse command: `argparse h/help -- $argv`
 * @param {SyntaxNode} node - the node to check
 * @returns  true if the node is the end stdin token
 */
export function isEndStdinCharacter(node: SyntaxNode) {
  return '--' === node.text && node.type === 'word';
}

/**
 * Checks if a node is fish escape sequence token `\` character
 * This token will be used to escape commands which span multiple lines
 */
export function isEscapeSequence(node: SyntaxNode) {
  return node.type === 'escape_sequence';
}

export function isLongOption(node: SyntaxNode): boolean {
  return node.text.startsWith('--') && !isEndStdinCharacter(node);
}

/**
 * node.text !== '-' because `-` this would not be an option... Consider the case:
 * ```
 * cat some_file | nvim -
 * ```
 */
export function isShortOption(node: SyntaxNode): boolean {
  return node.text.startsWith('-') && !isLongOption(node) && node.text !== '-';
}

/**
 * Checks if a node is an option/switch/flag in any of the following formats:
 *    - short options: `-g`, `-f1`, `-f 1`, `-f=2`, `-gx`
 *    - long options: `--global`, `--file`, `--file=1`, `--file 1`
 *    - old unix style flags: `-type`, `-type=file`
 * @param {SyntaxNode} node - the node to check
 * @returns {boolean} true if the node is an option
 */
export function isOption(node: SyntaxNode): boolean {
  if (isEndStdinCharacter(node)) return false;
  return isShortOption(node) || isLongOption(node);
}

/** careful not to call this on old unix style flags/options */
export function isJoinedShortOption(node: SyntaxNode) {
  if (isLongOption(node)) return false;
  return isShortOption(node) && node.text.slice(1).length > 1;
}

/** careful not to call this on old unix style flags/options */
export function hasShortOptionCharacter(node: SyntaxNode, findChar: string) {
  if (isLongOption(node)) return false;
  return isShortOption(node) && node.text.slice(1).includes(findChar);
}

export { isMatchingOption, findMatchingOptions } from '../parsing/options';

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

export function isVariableExpansion(node: SyntaxNode) {
  return node.type === 'variable_expansion';
}
/**
 * Checks for variable expansions that match the variable name, DONT PASS `variableName` with leading `$`
 * @param {SyntaxNode} node - the node to check
 * @param {string} variableName - the name of the variable to check for (`pipestatus`, `status`, `argv`, ...)
 * @returns {boolean} true if the node is a variable expansion matching the name
 */
export function isVariableExpansionWithName(node: SyntaxNode, variableName: string): boolean {
  return node.type === 'variable_expansion' && node.text === `$${variableName}`;
}

export function isVariable(node: SyntaxNode) {
  if (isVariableDefinition(node)) {
    return true;
  } else {
    return ['variable_expansion', 'variable_name'].includes(node.type);
  }
}

export function isCompleteFlagCommandName(node: SyntaxNode) {
  if (node.parent && isCommandWithName(node, 'set')) {
    const children = node.parent.childrenForFieldName('arguments').filter(n => !isOption(n));
    if (children && children.at(0)?.equals(node)) {
      return node.text.startsWith('_flag_');
    }
  }
  return false;
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

export function isConcatenation(node: SyntaxNode) {
  return node.type === 'concatenation';
}

export function isAliasWithName(node: SyntaxNode, aliasName: string) {
  if (isAliasDefinitionName(node)) {
    return node.text.split('=').at(0) === aliasName;
  }
  return false;
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

export function findParentVariableDefinitionKeyword(node?: SyntaxNode): SyntaxNode | null {
  if (!node || !isVariableDefinitionName(node)) return null;
  const currentNode: SyntaxNode | null | undefined = node;
  const parent = currentNode?.parent;
  if (!currentNode || !parent) {
    return null;
  }
  const varKeyword = parent.firstChild?.text.trim() || '';
  if (!varKeyword) {
    return null;
  }
  if (VariableDefinitionKeywords.includes(varKeyword)) {
    return parent;
  }
  return null;
}

export function findForLoopVariable(node: SyntaxNode): SyntaxNode | null {
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
 *                            contain the variable definition
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
  let child: SyntaxNode = children[i]!;

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

export function hasParent(node: SyntaxNode, callbackfn: (n: SyntaxNode) => boolean) {
  let currentNode: SyntaxNode = node;
  while (currentNode !== null) {
    if (callbackfn(currentNode)) {
      return true;
    }
    currentNode = currentNode.parent!;
  }
  return false;
}

export function findParent(node: SyntaxNode, callbackfn: (n: SyntaxNode) => boolean) {
  let currentNode: SyntaxNode = node;
  while (currentNode !== null) {
    if (callbackfn(currentNode)) {
      return currentNode;
    }
    currentNode = currentNode.parent!;
  }
  return null;
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
export function scopeCheck(node1: SyntaxNode, node2: SyntaxNode): boolean {
  const scope1 = findFunctionScope(node1);
  const scope2 = findFunctionScope(node2);
  if (isProgram(scope1)) {
    return true;
  }
  return scope1 === scope2;
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
// export function chainedCommandGroup(): SyntaxNode[] {
//   return [];
// }

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
    if (getLeafNodes(errorNode).length < semiCompleteForLoop.length) {
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

export function isInlineComment(node: SyntaxNode) {
  if (!isComment(node)) return false;
  const previousSibling: SyntaxNode | undefined | null = node.previousNamedSibling;
  if (!previousSibling) return false;
  return previousSibling?.startPosition.row === node.startPosition.row && previousSibling?.type !== 'comment';
}

export function isCommandWithName(node: SyntaxNode, ...commandNames: string[]) {
  if (node.type !== 'command') return false;
  // const currentCommandName = node.firstChild?.text
  return !!node.firstChild && commandNames.includes(node.firstChild.text);
}

export function isReturnStatusNumber(node: SyntaxNode) {
  if (node.type !== 'integer') return false;
  const parent = node.parent;
  if (!parent) return false;
  return parent.type === 'return';
}

export function isCompleteCommandName(node: SyntaxNode) {
  if (!node.parent || !isCommand(node.parent)) return false;
  if (!isCommandWithName(node.parent, 'complete')) return false;
  const previousSibling = node.previousNamedSibling;
  if (!previousSibling) return false;
  if (isMatchingOption(previousSibling, Option.create('-c', '--command').withValue())) {
    return !isOption(node);
  }
  return false;
}
