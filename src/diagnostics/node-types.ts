import Parser, { SyntaxNode } from 'web-tree-sitter';
import { isCommand, isCommandName, isCommandWithName, isIfOrElseIfConditional, isMatchingOption, isOption, isString } from '../utils/node-types';
import { findChildNodes, getChildNodes } from '../utils/tree-sitter';



type startTokenType = "function" | "while" | "if" | "for" | "begin" | "[" | "{" | "(" | "'" | '"';
type endTokenType = 'end' | "'" | '"' | ']' | '}' | ')';

const errorNodeTypes: { [ start in startTokenType ]: endTokenType } = {
  [ 'function' ]: 'end',
  [ 'while' ]: 'end',
  [ 'begin' ]: 'end',
  [ 'for' ]: 'end',
  [ 'if' ]: 'end',
  [ '"' ]: '"',
  [ "'" ]: "'",
  [ "{" ]: '}',
  [ "[" ]: ']',
  [ "(" ]: ')'
} as const;


function isStartTokenType(str: string): str is startTokenType {
  return [ 'function', 'while', 'if', 'for', 'begin', '[', '{', '(', "'", '"' ].includes(str);
}


export function findErrorCause(children: Parser.SyntaxNode[]): Parser.SyntaxNode | null {
  const stack: Array<{ node: Parser.SyntaxNode, type: endTokenType; }> = [];

  for (const node of children) {
    if (isStartTokenType(node.type)) {
      const expectedEndToken = errorNodeTypes[ node.type ];
      const matchIndex = stack.findIndex(item => item.type === expectedEndToken);

      if (matchIndex !== -1) {
        stack.splice(matchIndex, 1); // Remove the matched end token
      } else {
        stack.push({ node, type: expectedEndToken }); // Push the current node and expected end token to the stack
      }
    } else if (Object.values(errorNodeTypes).includes(node.type as endTokenType)) {
      stack.push({ node, type: node.type as endTokenType }); // Track all end tokens
    }
  }

  // Return the first unmatched start token from the stack, if any
  return stack.length > 0 ? stack[ 0 ]?.node || null : null;
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


export function isConditionalWithoutQuietCommand(node: SyntaxNode) {
  if (!isCommandWithName(node, 'command', 'set', 'string', 'builtin', 'functions')) return false;

  if (node.parent && isIfOrElseIfConditional(node.parent)) {
    const conditions = node.parent.childrenForFieldName('condition')
    const flags = findChildNodes(node, (n) => {
      return isMatchingOption(n, { shortOption: '-q', longOption: '--quiet' })
        || isMatchingOption(n, { shortOption: '-q', longOption: '--query' });
    });
    return !!conditions.find(n => n.equals(node)) && flags.length === 0;
  }
  return false;
}

export function isVariableDefinitionWithExpansionCharacter(node: SyntaxNode) {
  if (node.parent && isCommandWithName(node.parent, 'set', 'read')) {
    const definition = getChildNodes(node.parent).filter(n => !isCommand(n) && !isCommandName(n) && !isOption(n)).shift();
    return (node.type === 'variable_expansion' || node.text.startsWith('$')) && definition?.equals(node);
  }

  return false;
}
