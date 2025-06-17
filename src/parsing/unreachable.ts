// Complete fixed version for src/parsing/unreachable.ts

import { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isReturn, isSwitchStatement, isCaseClause, isIfStatement, isElseStatement, isForLoop, isFunctionDefinition, isComment, isConditionalCommand } from '../utils/node-types';
import { getChildNodes } from '../utils/tree-sitter';

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
 * Checks if a sequence of statements forms a complete and/or chain that terminates all paths
 * Pattern: command + conditional_execution + conditional_execution where both terminate
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
  
  // Both conditional executions must terminate
  const secondTerminates = conditionalExecutionTerminates(second);
  const thirdTerminates = conditionalExecutionTerminates(third);
  
  return secondTerminates && thirdTerminates;
}

/**
 * Checks if a node contains a terminal statement in its direct children (not deep descendants)
 */
function containsDirectTerminalStatement(node: SyntaxNode): boolean {
  for (const child of node.namedChildren) {
    if (isTerminalStatement(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a case clause contains a terminal statement
 */
function caseContainsTerminalStatement(caseNode: SyntaxNode): boolean {
  // Look through all children of the case clause (excluding the pattern)
  let skipPattern = true;
  for (const child of caseNode.namedChildren) {
    if (skipPattern) {
      skipPattern = false; // Skip the first child (the pattern)
      continue;
    }
    
    if (isTerminalStatement(child)) {
      return true;
    }
    
    // Recursively check nested blocks
    if (containsDirectTerminalStatement(child) || hasTerminalInNestedBlocks(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively checks if nested blocks contain terminal statements
 */
function hasTerminalInNestedBlocks(node: SyntaxNode): boolean {
  for (const child of node.namedChildren) {
    if (isTerminalStatement(child)) {
      return true;
    }
    if (hasTerminalInNestedBlocks(child)) {
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

  // Walk through all named children to find the different parts
  let skipCondition = true;
  for (const child of ifNode.namedChildren) {
    // Skip the condition parts
    if (skipCondition && (child.type === 'command' || child.type === 'test_command' || child.type === 'command_substitution')) {
      continue;
    }
    skipCondition = false;

    // Check else clause
    if (child.type === 'else_clause') {
      hasElse = true;
      if (containsDirectTerminalStatement(child) || hasTerminalInNestedBlocks(child)) {
        elseBodyTerminates = true;
      }
    }
    // Check the if body (everything that's not an else clause)
    else if (child.type !== 'else_if_clause' && !ifBodyTerminates) {
      if (isTerminalStatement(child) || hasTerminalInNestedBlocks(child)) {
        ifBodyTerminates = true;
      }
    }
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
  const blockBodyNodes: SyntaxNode[] = [];
  
  // For if statements, get everything except the condition
  if (isIfStatement(blockNode)) {
    let skipCondition = true;
    for (const child of blockNode.namedChildren) {
      // Skip until we're past the condition
      if (skipCondition && (child.type === 'command' || child.type === 'test_command' || child.type === 'command_substitution')) {
        continue;
      }
      skipCondition = false;
      
      // Don't include else clauses as unreachable in the if body
      if (child.type !== 'else_clause' && child.type !== 'else_if_clause') {
        blockBodyNodes.push(child);
      }
    }
  } else if (isForLoop(blockNode)) {
    // For loops: skip the iterator variable and iterable, get the body
    let skipForParts = true;
    for (const child of blockNode.namedChildren) {
      // Skip "for var in iterable" parts
      if (skipForParts && (child.type === 'variable_name' || child.type === 'word' || child.type === 'command_substitution' || child.type === 'concatenation')) {
        continue;
      }
      skipForParts = false;
      blockBodyNodes.push(child);
    }
  } else {
    // For other block types, include all children
    blockBodyNodes.push(...blockNode.namedChildren);
  }

  return getUnreachableStatementsInSequence(blockBodyNodes);
}

/**
 * Main function to find unreachable code nodes starting from a root node
 */
export function findUnreachableCode(root: SyntaxNode): SyntaxNode[] {
  const unreachable: SyntaxNode[] = [];
  
  // Use getChildNodes to traverse all descendants
  const allNodes = getChildNodes(root);
  
  // Process each node type
  for (const node of allNodes) {
    // Check function definitions
    if (isFunctionDefinition(node)) {
      unreachable.push(...findUnreachableInFunction(node));
    }
    // Check other block structures  
    else if (isIfStatement(node) || isForLoop(node)) {
      unreachable.push(...findUnreachableInBlock(node));
    }
  }
  
  return unreachable;
}

