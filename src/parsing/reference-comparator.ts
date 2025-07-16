import * as Locations from '../utils/locations';
import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { equalRanges, getChildNodes, getRange } from '../utils/tree-sitter';
import { isEmittedEventDefinitionName } from './emit';
import { findParentCommand, findParentFunction, isArgumentThatCanContainCommandCalls, isCommand, isCommandWithName, isEndStdinCharacter, isFunctionDefinition, isFunctionDefinitionName, isOption, isString, isVariable, isVariableDefinitionName } from '../utils/node-types';
import { isMatchingCompletionFlagNodeWithFishSymbol } from './complete';
import { isCompletionArgparseFlagWithCommandName } from './argparse';
import { isMatchingOption, isMatchingOptionOrOptionValue, Option } from './options';
import { isSetVariableDefinitionName } from './set';
import { extractCommands } from './nested-strings';
import { isAbbrDefinitionName, isMatchingAbbrFunction } from '../diagnostics/node-types';
import { isBindFunctionCall } from './bind';
import { isAliasDefinitionValue } from './alias';

type ReferenceContext = {
  symbol: FishSymbol;
  document: LspDocument;
  node: SyntaxNode;
  excludeEqualNode: boolean;
};

type ReferenceCheck = (ctx: ReferenceContext) => boolean;

// Early exit conditions - things we can immediately rule out
const shouldSkipNode: ReferenceCheck = ({ symbol, document, node, excludeEqualNode }) => {
  if (excludeEqualNode && symbol.equalsNode(node)) return true;

  if (excludeEqualNode && document.uri === symbol.uri) {
    if (equalRanges(getRange(symbol.focusedNode), getRange(node))) {
      return true;
    }
  }

  if (excludeEqualNode && symbol.isEvent() && symbol.focusedNode.equals(node)) {
    return true;
  }

  return false;
};

// Event-specific reference checking
const checkEventReference: ReferenceCheck = ({ symbol, node }) => {
  if (symbol.isEventHook() && symbol.name === node.text && isEmittedEventDefinitionName(node)) {
    return true;
  }

  if (symbol.isEmittedEvent() && symbol.name === node.text && !isEmittedEventDefinitionName(node)) {
    return true;
  }

  return false;
};

// Scope validation for local symbols
const isInValidScope: ReferenceCheck = ({ symbol, document, node }) => {
  if (symbol.isLocal() && !symbol.isArgparse()) {
    return symbol.scopeContainsNode(node) && symbol.uri === document.uri;
  }
  return true;
};

// Function name matching
const matchesFunctionName: ReferenceCheck = ({ symbol, node }) => {
  if (symbol.isFunction()) {
    if (isArgumentThatCanContainCommandCalls(node)) return true;
    if (symbol.name !== node.text && !isString(node)) {
      return false;
    }
  }
  return true;
};

// Complete command reference checking
const checkCompleteCommandReference: ReferenceCheck = ({ symbol, node }) => {
  const parentNode = node.parent ? findParentCommand(node) : null;

  if (parentNode && isCommandWithName(parentNode, 'complete')) {
    return isMatchingCompletionFlagNodeWithFishSymbol(symbol, node);
  }

  return false;
};

// Argparse-specific reference checking
const checkArgparseReference: ReferenceCheck = ({ symbol, node }) => {
  if (!symbol.isArgparse()) return false;

  const parentName = symbol.parent?.name
    || symbol.scopeNode.firstNamedChild?.text
    || symbol.scopeNode.text;

  // Check completion argparse flags
  if (isCompletionArgparseFlagWithCommandName(node, parentName, symbol.argparseFlagName)) {
    return true;
  }

  // Check command options
  if (isOption(node) && node.parent && isCommandWithName(node.parent, parentName)) {
    return isMatchingOptionOrOptionValue(node, Option.fromRaw(symbol.argparseFlag));
  }

  // Check variable references
  if (symbol.name === node.text && symbol.parent?.scopeContainsNode(node)) {
    return true;
  }

  const parentFunction = findParentFunction(node);
  const parentNode = node.parent ? findParentCommand(node) : null;

  // Variable definition checks
  if (isVariable(node) || isVariableDefinitionName(node) || isSetVariableDefinitionName(node, false)) {
    return symbol.name === node.text && symbol.scopeContainsNode(node);
  }

  // Command checks
  if (parentNode && isCommandWithName(parentNode, 'set', 'read', 'for', 'export', 'argparse')) {
    return !!(
      symbol.name === node.text
      && symbol.scopeContainsNode(node)
      && parentFunction?.equals(symbol.scopeNode)
    );
  }

  return false;
};

// Function-specific reference checking
const checkFunctionReference: ReferenceCheck = ({ symbol, node }) => {
  if (!symbol.isFunction()) return false;

  const parentNode = node.parent ? findParentCommand(node) : null;
  const prevNode = node.previousNamedSibling;

  // Direct command calls
  if (isCommand(node) && node.text === symbol.name) return true;

  // Function definitions (global functions only)
  if (isFunctionDefinitionName(node) && symbol.isGlobal()) {
    return symbol.equalsNode(node);
  }
  if (
    parentNode
    && isCommandWithName(parentNode, symbol.name)
    && parentNode.firstNamedChild?.equals(node)
  ) {
    return true;
  }

  // Command with name
  if (isCommandWithName(node, symbol.name)) return true;

  // function calls that are strings
  if (isArgumentThatCanContainCommandCalls(node)) {
    if (isString(node) || isOption(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }
    return node.text === symbol.name;
  }

  // Type/functions commands
  if (parentNode && isCommandWithName(parentNode, 'type', 'functions')) {
    const firstChild = parentNode.namedChildren.find(n => !isOption(n));
    return firstChild?.text === symbol.name;
  }

  // Wrapped functions
  if (prevNode && isMatchingOption(prevNode, Option.create('-w', '--wraps')) ||
    node.parent && isFunctionDefinition(node.parent) &&
    isMatchingOptionOrOptionValue(node, Option.create('-w', '--wraps'))) {
    return extractCommands(node).some(cmd => cmd === symbol.name);
  }

  // Abbreviation functions
  if (parentNode && isCommandWithName(parentNode, 'abbr')) {
    if (prevNode && isMatchingAbbrFunction(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }

    const namedChild = getChildNodes(parentNode).find(n => isAbbrDefinitionName(n));
    if (namedChild &&
      Locations.Range.isAfter(getRange(namedChild), symbol.selectionRange) &&
      !isOption(node) && node.text === symbol.name) {
      return true;
    }
  }

  // Bind commands
  if (parentNode && isCommandWithName(parentNode, 'bind')) {
    if (isOption(node)) return false;

    if (isBindFunctionCall(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }

    if (isString(node) && extractCommands(node).some(cmd => cmd === symbol.name)) {
      return true;
    }

    const cmd = parentNode.childrenForFieldName('argument').slice(1)
      .filter(n => !isOption(n) && !isEndStdinCharacter(n))
      .find(n => n.equals(node) && n.text === symbol.name);

    if (cmd) return true;
  }

  // Alias commands
  if (parentNode && isCommandWithName(parentNode, 'alias')) {
    if (isAliasDefinitionValue(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }
  }

  if (parentNode && isCommandWithName(parentNode, 'argparse')) {
    if (isOption(node) || isString(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }
  }

  // Export/set/read/for/argparse commands
  if (parentNode && isCommandWithName(parentNode, 'export', 'set', 'read', 'for', 'argparse')) {
    if (isOption(node) || isString(node)) {
      return extractCommands(node).some(cmd => cmd === symbol.name);
    }
    if (isVariableDefinitionName(node)) return false;

    return symbol.name === node.text;
  }

  return symbol.name === node.text && symbol.scopeContainsNode(node);
};

// Variable-specific reference checking
const checkVariableReference: ReferenceCheck = ({ symbol, node }) => {
  if (!symbol.isVariable() || node.text !== symbol.name) return false;

  // Check if the node is a variaable definition with the same name
  if (isVariable(node) || isVariableDefinitionName(node)) return true;

  const parentNode = node.parent ? findParentCommand(node) : null;

  // skip the edge case where a function could share a variables name
  // NOTE: `set FOO ...` is a variable definition
  //  • `$FOO` will still be counted as a reference
  //  • `FOO` will not be counted as a references (`FOO` could be a function)
  if (parentNode && isCommandWithName(parentNode, symbol.name)) {
    return false;
  }

  if (parentNode && isCommandWithName(parentNode, 'export', 'set', 'read', 'for', 'argparse')) {
    if (isOption(node)) return false;
    if (isVariableDefinitionName(node)) return symbol.name === node.text;
  }

  return symbol.name === node.text && symbol.scopeContainsNode(node);
};

// Main reference checker that composes all the checks
const referenceCheckers: ReferenceCheck[] = [
  checkEventReference,
  checkArgparseReference,
  checkFunctionReference,
  checkVariableReference,
];

// Main function - refactored to be functional and composable
export const isSymbolReference = (
  symbol: FishSymbol,
  document: LspDocument,
  node: SyntaxNode,
  excludeEqualNode = false,
): boolean => {
  const ctx: ReferenceContext = { symbol, document, node, excludeEqualNode };

  // Early exits
  if (shouldSkipNode(ctx)) return false;

  // Check event references first (they have special handling)
  if (symbol.isEvent()) {
    return checkEventReference(ctx);
  }

  // Validate scope for local symbols
  if (!isInValidScope(ctx)) return false;

  // Validate function name matching
  if (symbol.isFunction() && !matchesFunctionName(ctx)) return false;

  // Check complete command references
  const parentNode = node.parent ? findParentCommand(node) : null;
  if (parentNode && isCommandWithName(parentNode, 'complete') && !isVariable(node)) {
    return checkCompleteCommandReference(ctx);
  }

  // Run through all specific type checkers
  for (const checker of referenceCheckers) {
    if (checker(ctx)) return true;
  }

  return false;
};
