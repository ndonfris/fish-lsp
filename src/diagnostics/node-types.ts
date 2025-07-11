import Parser, { SyntaxNode } from 'web-tree-sitter';
import { findParentCommand, isCommandWithName, isEndStdinCharacter, isFunctionDefinitionName, isIfOrElseIfConditional, isMatchingOption, isOption, isScope, isString, isVariableDefinitionName } from '../utils/node-types';
import { findFirstParent, getChildNodes, getRange, isNodeWithinOtherNode, precedesRange } from '../utils/tree-sitter';
import { Option } from '../parsing/options';
import { isExistingSourceFilenameNode, isSourceCommandArgumentName } from '../parsing/source';
import { LspDocument } from '../document';
import { DiagnosticCommentsHandler } from './comments-handler';
import { FishSymbol } from '../parsing/symbol';
import { ErrorCodes } from './error-codes';
import { getReferences } from '../references';
import { isSetVariableDefinitionName } from '../parsing/set';
import { logger } from '../logger';
import { isReadVariableDefinitionName } from '../parsing/read';

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
  if (node.parent && isCommandWithName(node.parent, 'string')) {
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
    // skip flags that are after the variable name `set non_universal_var -U` should not be considered universal
    const definitionName = parent.children.find(c => isVariableDefinitionName(c));
    if (!definitionName || !precedesRange(getRange(node), getRange(definitionName))) {
      return false;
    }
    return isMatchingOption(node, Option.create('-U', '--universal'));
  }
  return false;
}

export function isSourceFilename(node: SyntaxNode): boolean {
  if (isSourceCommandArgumentName(node)) {
    const isExisting = isExistingSourceFilenameNode(node);
    if (!isExisting) {
      // check if the node is a variable expansion
      // if it is, do not through a diagnostic because we can't evaluate if this is a valid path
      // An example of this case:
      // for file in $__fish_data_dir/functions
      //     source $file # <--- we have no clue if this file exists
      // end
      if (node.type === 'variable_expansion') {
        return false;
      }
      // also skip something like `source '$file'`
      if (isString(node)) {
        return false;
      }
      return true;
    }
    return !isExisting;
  }
  return false;
}

export function isDotSourceCommand(node: SyntaxNode): boolean {
  if (node.parent && isCommandWithName(node.parent, '.')) {
    return node.parent.firstNamedChild?.equals(node) || false;
  }
  return false;
}

export function isTestCommandVariableExpansionWithoutString(node: SyntaxNode): boolean {
  const parent = node.parent;
  const previousSibling = node.previousSibling;
  if (!parent || !previousSibling) return false;

  if (!isCommandWithName(parent, 'test', '[')) return false;

  if (isMatchingOption(previousSibling, Option.short('-n'), Option.short('-z'))) {
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
  // read does not have quiet option
  if (!isCommandWithName(node, 'command', 'type', 'set', 'string', 'abbr', 'builtin', 'functions', 'jobs')) return false;
  if (!isConditionalStatement(node) && !isFirstNodeInConditionalExecution(node)) return false;

  // skip `set` commands with command substitution
  if (isCommandWithName(node, 'set') && hasCommandSubstitution(node)) {
    return false;
  }

  const flags = node?.childrenForFieldName('argument')
    .filter(n => isMatchingOption(n, Option.create('-q', '--quiet'))
      || isMatchingOption(n, Option.create('-q', '--query'))) || [];

  return flags.length === 0;
}

export function isVariableDefinitionWithExpansionCharacter(node: SyntaxNode, definedVariableExpansions: { [name: string]: SyntaxNode[]; } = {}): boolean {
  if (!isVariableDefinitionName(node)) return false;
  const parent = findParentCommand(node);
  if (parent && isCommandWithName(parent, 'set', 'read')) {
    if (!isVariableDefinitionName(node)) return false;
    const name = node.text.startsWith('$') ? node.text.slice(1) : node.text;
    if (!name || name.length === 0) return false;

    if (definedVariableExpansions[name] && definedVariableExpansions[name]?.some(scope => isNodeWithinOtherNode(node, scope))) {
      return false;
    }
    return node.type === 'variable_expansion' || node.text.startsWith('$');
  }

  return false;
}

export function handleVariableDefinitionWithExpansionCharacter(
  definedVariableExpansions: { [name: string]: SyntaxNode[]; },
  handler: DiagnosticCommentsHandler,
) {
  /**
   * Stores defined variables that are being expanded via `set -q $var`
   * in the `definedVariableExpansions` object with key value pairs being:
   * `{ '$var': SyntaxNode[] }` where the values are the scope nodes of the variable expansions
   * @param node - the current node to check (should be a variable expansion)
   * @param definedVariableExpansions - an object to store the defined variable expansions
   * Usage: called
   */
  function handleDefinedVariableExpansion(
    node: SyntaxNode,
  ): void {
    // if node is not a variable expansion, return
    // if (!isSetVariableDefinitionName(node, false)) return;
    // if (!isExpansionVariableDefinitionSilenced(node)) return

    // if the node is not a variable definition with expansion character, return
    const scope = findFirstParent(node, n => isScope(n));
    if (!scope) return;

    // make sure the variable name is not empty
    let name = isString(node) ? node.text.slice(1, 1) : node.text;
    name = name.startsWith('$') ? name.slice(1) : name;
    if (!name || name.length === 0) return;

    // Store the variable name in the definedVariableExpansions object
    (definedVariableExpansions[name] ??= []).push(scope);
    logger.debug(`handleDefinedVariableExpansion: defined variable expansion for ${name} in scope ${scope.text}`);
  }

  function isExpansionVariableDefinitionSilenced(node: SyntaxNode) {
    const possibleTestMatches = (n: SyntaxNode) => {
      return n.type === 'variable_expansion' || isString(n);
    };
    const parent = findParentCommand(node);
    if (!parent || !isCommandWithName(parent, 'set', 'test', '[')) return false;
    if (isCommandWithName(parent, 'test', '[')) {
      const opt = parent.children.find(n => isOption(n));
      if (opt && isMatchingOption(opt, Option.short('-n')) && possibleTestMatches(node)) {
        logger.debug('isExpansionVariableDefinitionSilenced: found test with -n option');
        logger.debug(Object.entries(definedVariableExpansions));
        return true;
      }
    }
    if (!isSetVariableDefinitionName(node, false) || !isReadVariableDefinitionName(node)) return false;

    const hasSilence = parent.children.filter(n => precedesRange(getRange(n), getRange(node)))
      .some(n => isOption(n) && isMatchingOption(n, Option.create('-q', '--query')));
    // Return the parent scope if the set command is silenced
    return hasSilence;
  }

  // callback function to handle variable definitions with expansion character
  return (node: SyntaxNode) => {
    if (!isString(node) || !isVariableDefinitionName(node)) return false;
    const parent = findParentCommand(node);
    if (!parent) return false;
    if (!isCommandWithName(parent, 'set', 'read', 'test', '[')) return false;
    if (isExpansionVariableDefinitionSilenced(node)) {
      handleDefinedVariableExpansion(node);
      logger.debug('ENTRIES');
      logger.debug(Object.entries(definedVariableExpansions).map(([k, v]) => `${k}: ${v.map(s => s.text).join(', ')}`));
    }
    if (!handler.isCodeEnabled(ErrorCodes.missingQuietOption)) return false;
    return isVariableDefinitionWithExpansionCharacter(node, definedVariableExpansions);
  };
}

export type LocalFunctionCallType = {
  node: SyntaxNode;
  text: string;
};

export function isMatchingCompleteOptionIsCommand(node: SyntaxNode) {
  return isMatchingOption(node, Option.create('-n', '--condition').withValue())
    || isMatchingOption(node, Option.create('-a', '--arguments').withValue())
    || isMatchingOption(node, Option.create('-c', '--command').withValue());
}

export function isMatchingAbbrFunction(node: SyntaxNode) {
  return isMatchingOption(node, Option.create('-f', '--function').withValue());
}

export function isAbbrDefinitionName(node: SyntaxNode) {
  const parent = findParentCommand(node);
  if (!parent) return false;
  if (!isCommandWithName(parent, 'abbr')) return false;
  const child = parent.childrenForFieldName('argument')
    .filter(n => !isOption(n))
    .find(n => n.type === 'word' && n.text !== '--' && !isString(n));

  return child ? child.equals(node) : false;
}

export function isArgparseWithoutEndStdin(node: SyntaxNode) {
  if (!isCommandWithName(node, 'argparse')) return false;
  const endStdin = getChildNodes(node).find(n => isEndStdinCharacter(n));
  if (!endStdin) return true;
  return false;
}

//
export function isFunctionWithEventHookCallback(doc: LspDocument, handler: DiagnosticCommentsHandler, allFunctions: FishSymbol[]) {
  const docType = doc.getAutoloadType();
  return (node: SyntaxNode): boolean => {
    if (docType !== 'functions') return false;
    if (!isFunctionDefinitionName(node)) return false;
    if (docType === 'functions' && handler.isCodeEnabledAtNode(ErrorCodes.autoloadedFunctionWithEventHookUnused, node)) {
      const funcSymbol = allFunctions.find(symbol => symbol.name === node.text);
      if (funcSymbol && funcSymbol.hasEventHook()) {
        const refs = getReferences(doc, funcSymbol.toPosition()).filter(ref =>
          !funcSymbol.equalsLocation(ref) &&
          !ref.uri.includes('completions/') &&
          ref.uri !== doc.uri,
        );
        if (refs.length === 0) return true;
      }
    }
    return false;
  };
}

export function isFishLspDeprecatedVariableName(node: SyntaxNode): boolean {
  if (isVariableDefinitionName(node)) {
    return node.text === 'fish_lsp_logfile';
  }
  if (node.type === 'variable_name') {
    return node.text === 'fish_lsp_logfile';
  }
  return node.text === 'fish_lsp_logfile';
}
export function getDeprecatedFishLspMessage(node: SyntaxNode): string {
  switch (node.text) {
    case 'fish_lsp_logfile':
      return `REPLACE \`${node.text}\` with \`fish_lsp_log_file\``;
    default:
      return '';
  }
}
