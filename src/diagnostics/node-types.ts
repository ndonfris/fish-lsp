import Parser, { SyntaxNode } from 'web-tree-sitter';
import { findParentCommand, hasParent, isCommand, isCommandName, isCommandWithName, isEndStdinCharacter, isFunctionDefinitionName, isIfOrElseIfConditional, isMatchingOption, isOption, isString, isVariableDefinitionName } from '../utils/node-types';
import { getChildNodes, getRange, isNodeWithinOtherNode, precedesRange, TreeWalker } from '../utils/tree-sitter';
import { Maybe } from '../utils/maybe';
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

export function isExport(node: SyntaxNode): boolean {
  return isCommandWithName(node, 'export');
}

export function isWrapperFunction(node: SyntaxNode, handler: DiagnosticCommentsHandler): boolean {
  if (!config.fish_lsp_allow_fish_wrapper_functions || handler.isCodeEnabled(ErrorCodes.usedWrapperFunction)) {
    return isAlias(node) || isExport(node);
  }
  return false;
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
      // remove `source (some_cmd a b c d)`
      if (hasParent(node, (n) => n.type === 'command_substitution')) {
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
 * Command analysis utilities for functional composition
 * Provides reusable command analysis operations for conditional execution logic
 */
class CommandAnalyzer {
  /**
   * Find the first command in a node's children
   */
  static findFirstCommand(node: SyntaxNode): Maybe<SyntaxNode> {
    return TreeWalker.findFirstChild(node, isCommand);
  }

  /**
   * Check if a command has quiet flags (-q, --quiet, --query)
   */
  static hasQuietFlags(command: SyntaxNode): boolean {
    return command.childrenForFieldName('argument')
      .some(arg =>
        isMatchingOption(arg, Option.create('-q', '--quiet')) ||
        isMatchingOption(arg, Option.create('-q', '--query')),
      );
  }

  /**
   * Check if a command is in the list of conditional commands
   */
  static isConditionalCommand(command: SyntaxNode): boolean {
    return isCommandWithName(command, ...getConditionalCommandNames());
  }
}

/**
 * Conditional context analysis utilities
 * Provides methods to analyze conditional execution contexts
 */
class ConditionalContext {
  /**
   * Check if a node is at the top level (direct child of program)
   */
  static isTopLevel(node: SyntaxNode): boolean {
    return Maybe.of(node.parent)
      .map(parent => parent.type === 'program')
      .getOrElse(false);
  }

  /**
   * Check if a node is used as a condition in an if/else if statement
   */
  static isUsedAsCondition(node: SyntaxNode): boolean {
    return Maybe.of(node.parent)
      .filter(isIfOrElseIfConditional)
      .flatMap(parent => Maybe.of(parent.childForFieldName('condition')))
      .equals(node);
  }

  /**
   * Check if a node contains conditional operators (&&, ||)
   */
  static hasConditionalOperators(node: SyntaxNode): boolean {
    return node.text.includes('&&') || node.text.includes('||');
  }

  /**
   * Check if a node is a conditional chain node (conditional_execution or ERROR with operators)
   */
  static isConditionalChainNode(node: SyntaxNode): boolean {
    return node.type === 'conditional_execution' ||
           node.type === 'ERROR' && ConditionalContext.hasConditionalOperators(node);
  }
}

/**
 * Check if a command in a conditional context needs a -q/--quiet/--query flag
 *
 * This function identifies commands that are used as conditional expressions and
 * should have explicit quiet flags to suppress output when used for existence checking.
 *
 * Rules:
 * 1. In conditional_execution chains (&&, ||): only check the first command
 * 2. In if/else if conditions: check the first command in the condition
 * 3. Commands inside if body, nested if statements, etc. are not checked
 *
 * @param node - the command name node to check
 * @returns true if the command needs a quiet flag, false otherwise
 */
export function isConditionalWithoutQuietCommand(node: SyntaxNode): boolean {
  if (!config.fish_lsp_strict_conditional_command_warnings) {
    return false;
  }
  return Maybe.of(node)
    .filter(isCommandName)
    .map(n => n.parent)
    .filter(isCommand)
    .filter(CommandAnalyzer.isConditionalCommand)
    .filter(cmd => !isCommandWithName(cmd, 'set') || !hasCommandSubstitution(cmd))
    .filter(cmd => !CommandAnalyzer.hasQuietFlags(cmd))
    .map(cmd => isCommandInConditionalContext(cmd))
    .getOrElse(false);
}

/**
 * Determines if a command is in a conditional context where it should have quiet flags
 *
 * Two scenarios:
 * 1. Command is the first command in a conditional_execution chain (cmd1 && cmd2 || cmd3)
 * 2. Command is the first command in an if/else if condition (including nested ones)
 */
function isCommandInConditionalContext(command: SyntaxNode): boolean {
  // Check if this is the first command in a conditional_execution chain
  if (isFirstCommandInConditionalChain(command)) {
    return true;
  }

  // Check if this is the first command in an if/else if condition (including nested)
  if (isFirstCommandInAnyIfCondition(command)) {
    return true;
  }

  return false;
}

/**
 * Check if a command is the first command in a conditional_execution chain that is used as a test
 * Examples: "set a && set -q b" at top level or in if condition - only "set a" should be flagged
 * But "set a && set b" inside an if body should NOT be flagged
 */
function isFirstCommandInConditionalChain(command: SyntaxNode): boolean {
  return TreeWalker.findHighest(command, ConditionalContext.isConditionalChainNode)
    .filter(rootNode =>
      ConditionalContext.isTopLevel(rootNode) ||
      ConditionalContext.isUsedAsCondition(rootNode),
    )
    .flatMap(CommandAnalyzer.findFirstCommand)
    .equals(command);
}

/**
 * Check if a command is the first command in any if/else if condition (including nested)
 * Examples: "if set a; end" or "else if set b; end" or nested "if set -q PATH; if set YARN_PATH; ..."
 */
function isFirstCommandInAnyIfCondition(command: SyntaxNode): boolean {
  return TreeWalker.walkUpAll(command, isIfOrElseIfConditional)
    .some(ifNode =>
      Maybe.of(ifNode.childForFieldName('condition'))
        .flatMap(condition => isFirstCommandInSpecificCondition(command, condition))
        .getOrElse(false),
    );
}

/**
 * Check if a command is the first command in a specific condition node
 */
function isFirstCommandInSpecificCondition(command: SyntaxNode, conditionNode: SyntaxNode): Maybe<boolean> {
  // Direct command match
  if (isCommand(conditionNode)) {
    return Maybe.of(conditionNode.equals(command));
  }

  // Find first command in condition
  return CommandAnalyzer.findFirstCommand(conditionNode)
    .map(firstCmd => firstCmd.equals(command));
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
