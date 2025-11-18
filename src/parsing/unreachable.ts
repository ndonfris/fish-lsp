import { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isReturn, isSwitchStatement, isCaseClause, isIfStatement, isForLoop, isFunctionDefinition, isComment, isConditionalCommand } from '../utils/node-types';

/**
 * Checks if a node represents a control flow statement that terminates execution
 */
function isTerminalStatement(node: SyntaxNode): boolean {
  if (isReturn(node)) return true;

  if (isCommand(node)) {
    const commandName = node.firstNamedChild?.text;
    return commandName === 'exit' || commandName === 'break' || commandName === 'continue';
  }

  // Also check if the node itself is a break/continue/exit/return keyword
  if (node.type === 'break' || node.type === 'continue' || node.type === 'exit' || node.type === 'return') {
    return true;
  }

  return false;
}

/**
 * Checks if a conditional_execution node contains a terminal statement
 */
function conditionalExecutionTerminates(conditionalNode: SyntaxNode): boolean {
  // conditional_execution nodes directly contain the terminal statement
  // e.g., (conditional_execution (return (integer)))
  for (const child of conditionalNode.namedChildren) {
    if (isTerminalStatement(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a conditional_execution represents an 'and' or 'or' operation
 * Fish uses both keyword forms (and/or) and operator forms (&&/||)
 */
function getConditionalType(node: SyntaxNode): 'and' | 'or' | null {
  // Check all children for the operator (can be named or unnamed)
  for (const child of node.children) {
    // Fish keyword forms: 'and' or 'or' (named nodes)
    if (child.type === 'and') return 'and';
    if (child.type === 'or') return 'or';
    // Operator forms: '&&' or '||' (unnamed tokens)
    if (!child.isNamed) {
      if (child.text === '&&') return 'and';
      if (child.text === '||') return 'or';
    }
  }
  return null;
}

/**
 * Checks if a sequence of statements forms a complete and/or chain that terminates all paths
 * Pattern: command + and + or (or command + or + and) where both conditional branches terminate
 *
 * Example of unreachable:
 *   echo a
 *   and return 0
 *   or return 1
 *   echo "unreachable"  # Both success and failure paths exit
 *
 * Example of reachable:
 *   git rev-parse || return
 *   echo "reachable"     # Only failure path exits, success continues
 */
function sequenceFormsTerminatingAndOrChain(nodes: SyntaxNode[], startIndex: number): boolean {
  // Need at least 3 nodes: initial command + and branch + or branch
  if (startIndex + 2 >= nodes.length) return false;

  const first = nodes[startIndex];
  const second = nodes[startIndex + 1];
  const third = nodes[startIndex + 2];

  // Pattern: command followed by two conditional_execution nodes
  if (!first || !second || !third) return false;

  const isCommandSequence = (isCommand(first) || isConditionalCommand(first)) &&
    isConditionalCommand(second) &&
    isConditionalCommand(third);

  if (!isCommandSequence) return false;

  // CRITICAL FIX: Must have BOTH 'and' and 'or' to terminate all paths
  // If we only have 'or' (or only 'and'), one path continues execution
  const secondType = getConditionalType(second);
  const thirdType = getConditionalType(third);

  // Must have both && and || (in either order)
  const hasBothOperators = (secondType === 'and' && thirdType === 'or') ||
                           (secondType === 'or' && thirdType === 'and');

  if (!hasBothOperators) return false;

  // Both conditional executions must terminate
  const secondTerminates = conditionalExecutionTerminates(second);
  const thirdTerminates = conditionalExecutionTerminates(third);

  return secondTerminates && thirdTerminates;
}

/**
 * Checks if a case clause contains a terminal statement
 */
function caseContainsTerminalStatement(caseNode: SyntaxNode): boolean {
  // Look through all children of the case clause (excluding the pattern)
  const caseBodyNodes: SyntaxNode[] = [];
  let skipPattern = true;

  for (const child of caseNode.namedChildren) {
    if (skipPattern) {
      skipPattern = false; // Skip the first child (the pattern)
      continue;
    }
    caseBodyNodes.push(child);
  }

  // Check if the sequence of statements in this case terminates all paths
  return sequenceTerminatesAllPaths(caseBodyNodes);
}

/**
 * Checks if a sequence of statements terminates all possible execution paths
 * This is the core logic for determining if code after this sequence is unreachable
 */
function sequenceTerminatesAllPaths(nodes: SyntaxNode[]): boolean {
  for (const node of nodes) {
    // Skip comments
    if (isComment(node)) {
      continue;
    }

    // Direct terminal statements
    if (isTerminalStatement(node)) {
      return true;
    }

    // Complete if/else statements where all paths terminate
    if (isIfStatement(node) && allPathsTerminate(node)) {
      return true;
    }

    // Complete switch statements where all paths terminate
    if (isSwitchStatement(node) && allSwitchPathsTerminate(node)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if all code paths in an if statement terminate
 */
function allPathsTerminate(ifNode: SyntaxNode): boolean {
  let hasElse = false;
  let ifBodyTerminates = false;
  let elseBodyTerminates = false;

  // Extract the different parts of the if statement
  const ifBodyNodes: SyntaxNode[] = [];
  let elseClauseNode: SyntaxNode | null = null;
  let skipCondition = true;

  for (const child of ifNode.namedChildren) {
    // Skip the condition parts (only the first condition)
    if (skipCondition && (child.type === 'command' || child.type === 'test_command' || child.type === 'command_substitution')) {
      skipCondition = false; // Only skip the very first condition
      continue;
    }

    // Check else clause
    if (child.type === 'else_clause') {
      hasElse = true;
      elseClauseNode = child;
    } else if (child.type !== 'else_if_clause') {
      // This is part of the if body
      ifBodyNodes.push(child);
    }
  }

  // Check if the if body terminates - must check if the sequence of statements terminates
  ifBodyTerminates = sequenceTerminatesAllPaths(ifBodyNodes);

  // Check if the else body terminates
  if (hasElse && elseClauseNode) {
    const elseBodyNodes = Array.from(elseClauseNode.namedChildren);
    elseBodyTerminates = sequenceTerminatesAllPaths(elseBodyNodes);
  }

  return ifBodyTerminates && hasElse && elseBodyTerminates;
}

/**
 * Checks if all paths in a switch statement terminate
 */
function allSwitchPathsTerminate(switchNode: SyntaxNode): boolean {
  let hasDefault = false;
  let allCasesTerminate = true;

  for (const child of switchNode.namedChildren) {
    if (isCaseClause(child)) {
      // Check if this is the default case - look for '*' pattern
      const casePattern = child.firstNamedChild?.text;
      if (casePattern === '*' || casePattern === '"*"' || casePattern === "'*'" || casePattern === '\\*') {
        hasDefault = true;
      }

      // Check if this case terminates
      if (!caseContainsTerminalStatement(child)) {
        allCasesTerminate = false;
      }
    }
  }

  return hasDefault && allCasesTerminate;
}

/**
 * Gets all unreachable statements after a terminal statement in a sequence
 */
function getUnreachableStatementsInSequence(nodes: SyntaxNode[]): SyntaxNode[] {
  const unreachable: SyntaxNode[] = [];
  let foundTerminal = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;

    // Skip comments - they're allowed after terminal statements
    if (isComment(node)) {
      continue;
    }

    if (foundTerminal) {
      unreachable.push(node);
      continue;
    }

    // Check for direct terminal statements
    if (isTerminalStatement(node)) {
      foundTerminal = true;
      continue;
    }

    // Check for control structures that terminate all paths
    if (isIfStatement(node) && allPathsTerminate(node)) {
      foundTerminal = true;
      continue;
    }

    if (isSwitchStatement(node) && allSwitchPathsTerminate(node)) {
      foundTerminal = true;
      continue;
    }

    // Check for and/or chains: command + conditional_execution + conditional_execution
    if (sequenceFormsTerminatingAndOrChain(nodes, i)) {
      foundTerminal = true;
      // Skip the next 2 nodes since they're part of this pattern
      i += 2;
      continue;
    }
  }

  return unreachable;
}

/**
 * Finds unreachable code nodes in a function definition
 */
function findUnreachableInFunction(functionNode: SyntaxNode): SyntaxNode[] {
  const unreachable: SyntaxNode[] = [];

  // Get the function body (all children except the function keyword and name)
  const functionBodyNodes: SyntaxNode[] = [];
  let foundFunctionKeyword = false;
  let foundFunctionName = false;

  for (const child of functionNode.namedChildren) {
    // Skip function keyword
    if (!foundFunctionKeyword && child.type === 'word' && child.text === 'function') {
      foundFunctionKeyword = true;
      continue;
    }
    // Skip function name (first word after 'function')
    if (foundFunctionKeyword && !foundFunctionName && child.type === 'word') {
      foundFunctionName = true;
      continue;
    }

    // Skip comments - they don't affect control flow
    if (isComment(child)) {
      continue;
    }

    functionBodyNodes.push(child);
  }

  // Find unreachable statements in the function body
  unreachable.push(...getUnreachableStatementsInSequence(functionBodyNodes));

  return unreachable;
}

/**
 * Finds unreachable code nodes in any block scope (if, for, etc.)
 */
function findUnreachableInBlock(blockNode: SyntaxNode): SyntaxNode[] {
  const unreachable: SyntaxNode[] = [];

  // For if statements, we need to check each branch separately
  if (isIfStatement(blockNode)) {
    const ifBodyNodes: SyntaxNode[] = [];
    let elseClauseNode: SyntaxNode | null = null;
    let skipCondition = true;

    // Extract if body and else clause
    for (const child of blockNode.namedChildren) {
      // Skip only the FIRST condition part
      if (skipCondition && (child.type === 'command' || child.type === 'test_command' || child.type === 'command_substitution')) {
        skipCondition = false; // Only skip the very first condition
        continue;
      }

      if (child.type === 'else_clause') {
        elseClauseNode = child;
      } else if (child.type !== 'else_if_clause') {
        // This is part of the if body
        ifBodyNodes.push(child);
      }
    }

    // Check for unreachable code in the if body
    unreachable.push(...getUnreachableStatementsInSequence(ifBodyNodes));

    // Check for unreachable code in the else clause
    if (elseClauseNode) {
      const elseBodyNodes = Array.from(elseClauseNode.namedChildren);
      unreachable.push(...getUnreachableStatementsInSequence(elseBodyNodes));
    }
  } else if (isForLoop(blockNode)) {
    // For loops: skip the iterator variable and iterable, get the body
    const loopBodyNodes: SyntaxNode[] = [];
    let skipForParts = true;
    for (const child of blockNode.namedChildren) {
      // Skip "for var in iterable" parts
      if (skipForParts && (child.type === 'variable_name' || child.type === 'word' || child.type === 'command_substitution' || child.type === 'concatenation')) {
        continue;
      }
      skipForParts = false;
      loopBodyNodes.push(child);
    }
    unreachable.push(...getUnreachableStatementsInSequence(loopBodyNodes));
  } else {
    // For other block types, include all children
    const blockBodyNodes = Array.from(blockNode.namedChildren);
    unreachable.push(...getUnreachableStatementsInSequence(blockBodyNodes));
  }

  return unreachable;
}

/**
 * Recursively find unreachable code in a node and its descendants
 * This is more efficient than getChildNodes() because it only visits relevant nodes
 */
function findUnreachableRecursive(node: SyntaxNode, unreachable: SyntaxNode[]): void {
  // Check the node itself for unreachable code
  if (isFunctionDefinition(node)) {
    unreachable.push(...findUnreachableInFunction(node));
  } else if (isIfStatement(node) || isForLoop(node)) {
    unreachable.push(...findUnreachableInBlock(node));
  }

  // Recursively check named children
  // This is much faster than getChildNodes() which does BFS over entire tree
  for (const child of node.namedChildren) {
    // Skip comments as they don't affect control flow
    if (isComment(child)) continue;

    // Recursively process child
    findUnreachableRecursive(child, unreachable);
  }
}

/**
 * Main function to find unreachable code nodes starting from a root node
 * Optimized to avoid full tree traversal via getChildNodes()
 */
export function findUnreachableCode(root: SyntaxNode): SyntaxNode[] {
  const unreachable: SyntaxNode[] = [];

  // Handle top-level program statements
  if (root.type === 'program') {
    const topLevelNodes = Array.from(root.namedChildren).filter(child => !isComment(child));
    const topLevelUnreachable = getUnreachableStatementsInSequence(topLevelNodes);
    unreachable.push(...topLevelUnreachable);
  }

  // Recursively traverse the tree (much faster than getChildNodes())
  findUnreachableRecursive(root, unreachable);

  return unreachable;
}

