import Parser, { SyntaxNode } from 'web-tree-sitter';
import { findParentCommand, isCommandName, isCommandWithName, isEndStdinCharacter, isFunctionDefinitionName, isIfOrElseIfConditional, isMatchingOption, isOption, isString, isVariableDefinitionName } from '../utils/node-types';
import { getChildNodes, getRange, isNodeWithinOtherNode, precedesRange } from '../utils/tree-sitter';
import { Option } from '../parsing/options';
import { isExistingSourceFilenameNode, isSourceCommandArgumentName } from '../parsing/source';
import { LspDocument } from '../document';
import { DiagnosticCommentsHandler } from './comments-handler';
import { FishSymbol } from '../parsing/symbol';
import { ErrorCodes } from './error-codes';
import { getReferences } from '../references';
import { config, Config } from '../config';

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
  // simple heuristic to not check anything that is not an option
  if (!isOption(node)) return false;

  // get the parent command to make sure we are in the right context
  const parent = findParentCommand(node);
  if (!parent) return false;

  if (isCommandWithName(parent, 'read', 'set')) {
    // skip flags that are after the variable name `set non_universal_var -U` should not be considered universal
    // Consider doing this check only for `set` commands, although `read` manpage mentions
    // formatting similar to `set` and even denotes the syntax as `read [OPTIONS] [VARIABLE ...]`
    const definitionName = parent
      .childrenForFieldName('argument')
      .find(c => !isOption(c) && isVariableDefinitionName(c));

    if (!definitionName || !precedesRange(getRange(node), getRange(definitionName))) {
      return false;
    }
    // check if the command is a -U/--universal option
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
 * Get all conditional command names based on the config setting
 * FIX: https://github.com/ndonfris/fish-lsp/issues/93
 */
const allConditionalCommandNames = ['command', 'type', 'set', 'string', 'abbr', 'builtin', 'functions', 'jobs'];
const getConditionalCommandNames = () => {
  if (!config.fish_lsp_strict_conditional_command_warnings) {
    return ['set', 'abbr', 'functions', 'jobs'];
  }
  return allConditionalCommandNames;
};

/**
 * Check if -q,--quiet/--query flags are present for commands which follow an `if/else if` conditional statement
 * @param node - the current node to check (should be a command)
 * @returns true if the command is a conditional statement without -q,--quiet/--query flags, otherwise false
 */
export function isConditionalWithoutQuietCommand(node: SyntaxNode) {
  const conditionalCommandNames = getConditionalCommandNames();

  // read does not have quiet option
  if (!isCommandWithName(node, ...conditionalCommandNames)) return false;
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

export function isPosixCommandInsteadOfFishCommand(node: SyntaxNode): boolean {
  if (!config.fish_lsp_prefer_builtin_fish_commands) return false;
  if (!isCommandName(node)) {
    return false;
  }
  const parent = findParentCommand(node);
  if (!parent) return false;

  if (isCommandWithName(parent, 'realpath')) {
    return !parent.children.some(c => isOption(c));
  }
  if (isCommandWithName(parent, 'dirname', 'basename')) {
    return true;
  }
  if (isCommandWithName(parent, 'cut', 'wc')) {
    return true;
  }
  if (isCommandWithName(parent, 'pbcopy', 'wl-copy', 'xsel', 'xclip', 'clip.exe')) {
    return true;
  }
  if (isCommandWithName(parent, 'pbpaste', 'wl-paste', 'xsel', 'xclip', 'clip.exe')) {
    return true;
  }
  return false;
}

export function getFishBuiltinEquivalentCommandName(node: SyntaxNode): string | null {
  if (!isPosixCommandInsteadOfFishCommand(node)) return null;
  if (!isCommandName(node)) {
    return null;
  }
  const parent = findParentCommand(node);
  if (!parent) return null;
  if (isCommandWithName(parent, 'dirname', 'basename')) {
    return ['path', node.text].join(' ');
  }
  if (isCommandWithName(parent, 'realpath')) {
    return 'path resolve';
  }
  if (isCommandWithName(parent, 'cut')) {
    return 'string split';
  }
  if (isCommandWithName(parent, 'wc')) {
    return 'count';
  }
  if (isCommandWithName(parent, 'pbcopy', 'wl-copy', /*'xsel', 'xclip',*/ 'clip.exe')) {
    return 'fish_clipboard_copy';
  }
  if (isCommandWithName(parent, 'pbpaste', 'wl-paste' /*'xsel', 'xclip', 'powershell.exe'*/)) {
    return 'fish_clipboard_paste';
  }
  if (isCommandWithName(parent, 'xsel', 'xclip')) {
    return 'fish_clipboard_copy | fish_clipboard_paste';
  }
  return null;
}

// Returns all the autoloaded functions that do not have a `-d`/`--description` option set
export function getAutoloadedFunctionsWithoutDescription(doc: LspDocument, handler: DiagnosticCommentsHandler, allFunctions: FishSymbol[]): FishSymbol[] {
  if (!doc.isAutoloaded()) return [];
  return allFunctions.filter((symbol) =>
    symbol.isGlobal()
    && symbol.fishKind !== 'ALIAS'
    && !symbol.node.childrenForFieldName('option').some(child => isMatchingOption(child, Option.create('-d', '--description')))
    && handler.isCodeEnabledAtNode(ErrorCodes.requireAutloadedFunctionHasDescription, symbol.node),
  );
}

//  callback function to check if a function is autoloaded and has an event hook
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
    return Config.isDeprecatedKey(node.text);
  }
  if (node.type === 'variable_name') {
    return Config.isDeprecatedKey(node.text);
  }
  return false;
}
export function getDeprecatedFishLspMessage(node: SyntaxNode): string {
  for (const [key, value] of Object.entries(Config.deprecatedKeys)) {
    if (node.text === key) {
      return `REPLACE \`${key}\` with \`${value}\``;
    }
  }
  return '';
}
