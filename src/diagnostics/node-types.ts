import Parser, { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isCommandName, isCommandWithName, isEndStdinCharacter, isIfOrElseIfConditional, isMatchingOption, isOption, isString } from '../utils/node-types';
import { getChildNodes, isNodeWithinOtherNode } from '../utils/tree-sitter';

type startTokenType = 'function' | 'while' | 'if' | 'for' | 'begin' | '[' | '{' | '(' | "'" | '"';
type endTokenType = 'end' | "'" | '"' | ']' | '}' | ')';

export const ErrorNodeTypes: { [start in startTokenType]: endTokenType } = {
  ['function']: 'end',
  ['while']: 'end',
  ['begin']: 'end',
  ['for']: 'end',
  ['if']: 'end',
  ['"']: '"',
  ["'"]: "'",
  ['{']: '}',
  ['[']: ']',
  ['(']: ')',
} as const;

function isStartTokenType(str: string): str is startTokenType {
  return ['function', 'while', 'if', 'for', 'begin', '[', '{', '(', "'", '"'].includes(str);
}

export function findErrorCause(children: Parser.SyntaxNode[]): Parser.SyntaxNode | null {
  const stack: Array<{ node: Parser.SyntaxNode; type: endTokenType; }> = [];

  for (const node of children) {
    if (isStartTokenType(node.type)) {
      const expectedEndToken = ErrorNodeTypes[node.type];
      const matchIndex = stack.findIndex(item => item.type === expectedEndToken);

      if (matchIndex !== -1) {
        stack.splice(matchIndex, 1); // Remove the matched end token
      } else {
        stack.push({ node, type: expectedEndToken }); // Push the current node and expected end token to the stack
      }
    } else if (Object.values(ErrorNodeTypes).includes(node.type as endTokenType)) {
      stack.push({ node, type: node.type as endTokenType }); // Track all end tokens
    }
  }

  // Return the first unmatched start token from the stack, if any
  return stack.length > 0 ? stack[0]?.node || null : null;
}

export function isExtraEnd(node: SyntaxNode) {
  return node.type === 'command' && node.text === 'end';
}

export function isZeroIndex(node: SyntaxNode) {
  return node.type === 'index' && node.text === '0';
}

export function isSingleQuoteVariableExpansion(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'single_quote_string') {
    return false;
  }

  const variableRegex = /(?<!\\)\$\w+/; // Matches $variable, not preceded by a backslash
  return variableRegex.test(node.text);
}

export function isAlias(node: SyntaxNode): boolean {
  return isCommandWithName(node, 'alias');
}

export function isUniversalDefinition(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;

  if (isCommandWithName(parent, 'read') || isCommandWithName(parent, 'set')) {
    return isMatchingOption(node, { shortOption: '-U', longOption: '--universal' });
  }
  return false;
}

export function isSourceFilename(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (isCommandWithName(parent, 'source') && parent.childCount === 2) {
    return parent.child(1)?.equals(node) || false;
  }
  return false;
}

export function isTestCommandVariableExpansionWithoutString(node: SyntaxNode): boolean {
  const parent = node.parent;
  const previousSibling = node.previousSibling;
  if (!parent || !previousSibling) return false;

  if (!isCommandWithName(parent, 'test', '[')) return false;

  if (isMatchingOption(previousSibling, { shortOption: '-n' }) || isMatchingOption(previousSibling, { shortOption: '-z' })) {
    return !isString(node) && !!parent.child(2) && parent.child(2)!.equals(node);
  }

  return false;
}

function isInsideStatementCondition(statement: SyntaxNode, node: SyntaxNode): boolean {
  const conditionNode = statement.childForFieldName('condition');
  if (!conditionNode) return false;
  return isNodeWithinOtherNode(node, conditionNode);
}

/**
 * util for collecting if conditional_statement commands
 * Necessary because there is two types of conditional statements:
 *    1.) if cmd_1 || cmd_2; ...; end;
 *    2.) if cmd_1; or cmd_2; ...; end;
 * Case two is handled by the if statement, checking for the parent type of conditional_execution
 * @param node - the current node to check (should be a command)
 * @returns true if the node is a conditional statement, otherwise false
 */
export function isConditionalStatement(node: SyntaxNode) {
  if (!node.isNamed) return false;
  if (['\n', ';'].includes(node?.previousSibling?.type || '')) return false;
  let curr: SyntaxNode | null = node.parent;
  while (curr) {
    if (curr.type === 'conditional_execution') {
      curr = curr?.parent;
    } else if (isIfOrElseIfConditional(curr)) {
      return isInsideStatementCondition(curr, node);
    } else {
      break;
    }
  }
  return false;
}

/**
 * Check if a conditional_execution node starts with a conditional operator
 */
function checkConditionalStartsWith(node: SyntaxNode) {
  if (node.type === 'conditional_execution') {
    return node.text.startsWith('&&') || node.text.startsWith('||')
      || node.text.startsWith('and') || node.text.startsWith('or');
  }
  return false;
}

/**
 * Check if a command node is the first node in a conditional_execution
 */
export function isFirstNodeInConditionalExecution(node: SyntaxNode) {
  if (!node.isNamed) return false;
  if (['\n', ';'].includes(node?.type || '')) return false;
  if (isConditionalStatement(node)) return false;

  if (
    node.parent &&
    node.parent.type === 'conditional_execution' &&
    !checkConditionalStartsWith(node.parent)
  ) {
    return node.parent.firstNamedChild?.equals(node) || false;
  }

  const next = node.nextNamedSibling;
  if (!next) return false;
  return next.type === 'conditional_execution' && checkConditionalStartsWith(next);
}

/**
 * Checks if a command has a command substitution. For example,
 *
 *   ```fish
 *   if set -l fishdir (status fish-path | string match -vr /bin/)
 *       echo $fishdir
 *   end
 *   ```
 *
 * @param node - the current node to check (should be a `set` command)
 * @returns true if the command has a command substitution, otherwise false
 */
function hasCommandSubstitution(node: SyntaxNode) {
  return node.childrenForFieldName('argument').filter(c => c.type === 'command_substitution').length > 0;
}

/**
 * Check if -q,--quiet/--query flags are present for commands which follow an `if/else if` conditional statement
 * @param node - the current node to check (should be a command)
 * @returns true if the command is a conditional statement without -q,--quiet/--query flags, otherwise false
 */
export function isConditionalWithoutQuietCommand(node: SyntaxNode) {
  // if (!isCommand(node)) return false;
  if (!isCommandWithName(node, 'command', 'type', 'read', 'set', 'string', 'abbr', 'builtin', 'functions', 'jobs')) return false;
  if (!isConditionalStatement(node) && !isFirstNodeInConditionalExecution(node)) return false;

  // skip `set` commands with command substitution
  if (isCommandWithName(node, 'set') && hasCommandSubstitution(node)) {
    return false;
  }

  const flags = node?.childrenForFieldName('argument')
    .filter(n => isMatchingOption(n, { shortOption: '-q', longOption: '--quiet' })
      || isMatchingOption(n, { shortOption: '-q', longOption: '--query' })) || [];

  return flags.length === 0;
}

export function isVariableDefinitionWithExpansionCharacter(node: SyntaxNode) {
  if (node.parent && isCommandWithName(node.parent, 'set', 'read')) {
    const definition = getChildNodes(node.parent).filter(n => !isCommand(n) && !isCommandName(n) && !isOption(n)).shift();
    return (node.type === 'variable_expansion' || node.text.startsWith('$')) && definition?.equals(node);
  }

  return false;
}

export type LocalFunctionCallType = {
  node: SyntaxNode;
  text: string;
};

export function isMatchingCompleteOptionIsCommand(node: SyntaxNode) {
  return isMatchingOption(node, { shortOption: '-n', longOption: '--condition' })
    || isMatchingOption(node, { shortOption: '-a', longOption: '--arguments' })
    || isMatchingOption(node, { shortOption: '-c', longOption: '--command' });
}

export function isArgparseWithoutEndStdin(node: SyntaxNode) {
  if (!isCommandWithName(node, 'argparse')) return false;
  const endStdin = getChildNodes(node).find(n => isEndStdinCharacter(n));
  if (!endStdin) return true;
  return false;
}
