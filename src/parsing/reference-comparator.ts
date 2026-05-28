import * as Locations from '../utils/locations';
import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { analyzer } from '../analyze';
import { equalRanges, getChildNodes, getRange, nodesGen } from '../utils/tree-sitter';
import { isEmittedEventDefinitionName } from './emit';
import { findParentCommand, findParentFunction, getCommandNameNode, getCommandNameText, isArgumentThatCanContainCommandCalls, isCommand, isCommandName, isCommandWithName, isEndStdinCharacter, isFunctionDefinition, isFunctionDefinitionName, isOption, isString, isVariable, isVariableDefinitionName } from '../utils/node-types';
import { isMatchingCompletionFlagNodeWithFishSymbol } from './complete';
import { isCompletionArgparseFlagWithCommandName } from './argparse';
import { isMatchingOption, isMatchingOptionOrOptionValue, Option } from './options';
import { getSetCommandScopeTag, isSetQueryDefinition, isSetVariableDefinitionName } from './set';
import { FishString } from './string';
import { isAbbrDefinitionName, isMatchingAbbrFunction } from '../diagnostics/node-types';
import { isBindFunctionCall } from './bind';
import { isAliasDefinitionValue } from './alias';
import { isFunctionsReference } from './function';

type ReferenceContext = {
  symbol: FishSymbol;
  document: LspDocument;
  node: SyntaxNode;
  excludeEqualNode: boolean;
};

type ReferenceCheck = (ctx: ReferenceContext) => boolean;

function isBeforePosition(a: { line: number; character: number; }, b: { line: number; character: number; }) {
  return a.line < b.line || a.line === b.line && a.character < b.character;
}

function highestConditionalExecution(node: SyntaxNode | null): SyntaxNode | null {
  let current = node;
  let highest: SyntaxNode | null = null;
  while (current) {
    if (current.type === 'conditional_execution') {
      highest = current;
    }
    current = current.parent;
  }
  return highest;
}

function guardedSetQueryReference(symbol: FishSymbol, document: LspDocument, node: SyntaxNode): boolean | null {
  if (!symbol.isVariable() || symbol.uri !== document.uri) return null;
  if (!isSetVariableDefinitionName(node, false) || node.text !== symbol.name) return null;

  const queryCommand = findParentCommand(node);
  const definitionCommand = findParentCommand(symbol.focusedNode);
  if (!queryCommand || !definitionCommand) return null;
  if (!isSetQueryDefinition(queryCommand) || !isCommandWithName(definitionCommand, 'set')) return null;

  const queryChain = highestConditionalExecution(queryCommand);
  const definitionChain = highestConditionalExecution(definitionCommand);
  if (!queryChain || !definitionChain || !queryChain.equals(definitionChain)) return null;

  const nodePos = getRange(node).start;
  const defPos = symbol.selectionRange.start;
  if (!isBeforePosition(nodePos, defPos)) return null;

  const queryScope = getSetCommandScopeTag(document, queryCommand);
  const definitionScope = getSetCommandScopeTag(symbol.document, definitionCommand) || symbol.scopeTag;
  if (!queryScope || queryScope !== definitionScope) return false;

  if (definitionScope === 'global' || definitionScope === 'universal') {
    return true;
  }

  return false;
}

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
    // Same-document: use existing scope containment check
    if (symbol.uri === document.uri) {
      if (symbol.scopeContainsNode(node)) return true;
      // Node is inside a --no-scope-shadowing callee invoked from symbol's scope.
      if (symbol.isVariable() && isInNoScopeShadowingCallee(symbol, node, document.uri)) return true;
      return false;
    }
    // Cross-document: for regular callers, allow references inside directly called
    // --no-scope-shadowing callees (same logical scope sharing).
    if (symbol.isVariable() && isInNoScopeShadowingCallee(symbol, node, document.uri)) {
      return true;
    }
    // Cross-document: only allow if symbol is in a --no-scope-shadowing function
    // AND the node is also in a --no-scope-shadowing function (or at program scope)
    if (symbol.parent?.isFunctionWithNoScopeShadowing()) {
      const enclosingFunc = findParentFunction(node);
      if (!enclosingFunc || !isFunctionDefinition(enclosingFunc)) {
        return true; // node is at program/global scope
      }
      const enclosingFuncSymbol = analyzer.getEnclosingFunctionSymbol(document.uri, node);
      return !!(
        enclosingFuncSymbol?.isFunctionWithNoScopeShadowing()
        && analyzer.isFunctionVisibleFrom(enclosingFuncSymbol, symbol.parent, document.uri)
      );
    }
    // Cross-document: --inherit-variable allows specific variables to cross file boundaries
    if (symbol.isVariable() && isValidInheritVariableScope(symbol, node, document.uri)) {
      return true;
    }
    return false;
  }
  return true;
};

// Function name matching
const matchesFunctionName: ReferenceCheck = ({ symbol, node }) => {
  if (symbol.isFunction()) {
    if (isArgumentThatCanContainCommandCalls(node)) return true;
    if (isFunctionsReference(node)) return true;
    if (symbol.name !== node.text && !isString(node)) {
      // Bare-word alias `foo=ref_cmd`: tree-sitter parses the whole `foo=ref_cmd`
      // as one `word` node, which counts as the alias name in
      // `isAliasDefinitionName` and so trips `isArgumentThatCanContainCommandCalls`
      // (it rejects definition names). Accept it here when the value portion
      // matches the symbol.
      if (node.type === 'word' && node.text.includes('=') && !node.text.startsWith('-')
        && FishString.extractCommands(node).includes(symbol.name)) {
        return true;
      }
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
    && getCommandNameNode(parentNode)?.equals(node)
  ) {
    return true;
  }

  // Command with name
  if (isCommandWithName(node, symbol.name)) return true;

  if (isFunctionsReference(node) && symbol.name === node.text) return true;

  // function calls that are strings
  if (isArgumentThatCanContainCommandCalls(node)) {
    if (isString(node) || isOption(node)) {
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
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
    return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
  }

  // Abbreviation functions
  if (parentNode && isCommandWithName(parentNode, 'abbr')) {
    if (prevNode && isMatchingAbbrFunction(node)) {
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
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
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
    }

    if (isString(node) && FishString.extractCommands(node).some(cmd => cmd === symbol.name)) {
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
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
    }
  }

  if (parentNode && isCommandWithName(parentNode, 'argparse')) {
    if (isOption(node) || isString(node)) {
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
    }
  }

  // Export/set/read/for/argparse commands
  if (parentNode && isCommandWithName(parentNode, 'export', 'set', 'read', 'for', 'argparse')) {
    if (isOption(node) || isString(node)) {
      return FishString.extractCommands(node).some(cmd => cmd === symbol.name);
    }
    if (isVariableDefinitionName(node)) return false;

    return symbol.name === node.text;
  }

  return symbol.name === node.text && symbol.scopeContainsNode(node);
};

function scopeCallsNoScopeShadowingFunctionTransitively(
  scopeNode: SyntaxNode,
  targetFunc: FishSymbol,
  caller?: FishSymbol | null,
  callerUri?: string,
  visited = new Set<string>(),
): boolean {
  const targetKey = targetFunc.id;

  for (const node of nodesGen(scopeNode)) {
    if (!isCommand(node)) continue;
    const commandName = getCommandNameText(node);
    if (!commandName) continue;

    const callees = analyzer.getCallableNoScopeShadowingFunctions(commandName, caller, callerUri);
    for (const callee of callees) {
      const calleeKey = callee.id;
      if (calleeKey === targetKey) {
        return true;
      }
      if (visited.has(calleeKey)) {
        continue;
      }

      visited.add(calleeKey);
      if (scopeCallsNoScopeShadowingFunctionTransitively(
        callee.scope.scopeNode,
        targetFunc,
        callee,
        callee.uri,
        visited,
      )) {
        return true;
      }
    }
  }

  return false;
}

function isInNoScopeShadowingCallee(symbol: FishSymbol, node: SyntaxNode, uri: string): boolean {
  const enclosingFuncSymbol = analyzer.getEnclosingFunctionSymbol(uri, node);
  if (!enclosingFuncSymbol?.isFunctionWithNoScopeShadowing()) return false;
  if (!analyzer.isFunctionVisibleFrom(enclosingFuncSymbol, symbol.parent, uri)) return false;
  return scopeCallsNoScopeShadowingFunctionTransitively(
    symbol.scope.scopeNode,
    enclosingFuncSymbol,
    symbol.parent,
    symbol.uri,
  );
}

/**
 * Checks if a cross-file variable reference is valid for --inherit-variable.
 * Returns true when:
 * - The symbol is a regular variable and the node is inside a function that
 *   inherits this variable name (caller→callee direction)
 * - The symbol is an --inherit-variable declaration and the node is in the
 *   calling function that defines this variable (callee→caller direction)
 */
function isValidInheritVariableScope(symbol: FishSymbol, node: SyntaxNode, uri: string): boolean {
  const enclosingFunc = findParentFunction(node);
  if (!enclosingFunc || !isFunctionDefinition(enclosingFunc)) {
    return false;
  }
  const enclosingFuncSymbol = analyzer.getEnclosingFunctionSymbol(uri, node);
  if (!enclosingFuncSymbol) return false;

  // Direction 1: symbol is a regular variable, node is inside a function
  // that inherits this variable via --inherit-variable
  const inheritingFuncs = analyzer.getCallableInheritingFunctions(symbol.name, symbol.parent, symbol.document.uri);
  if (inheritingFuncs.some(f => f.equals(enclosingFuncSymbol))) {
    return true;
  }

  // Direction 2: symbol is an --inherit-variable declaration, node is in
  // another function (the caller that defines this variable)
  // Verify the enclosing function actually calls the inherit-variable's parent
  if (symbol.isInheritVariable() && symbol.parent) {
    for (const n of nodesGen(enclosingFunc)) {
      if (isCommandWithName(n, symbol.parent.name)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a cross-file variable reference is valid by verifying that the
 * candidate node is inside a --no-scope-shadowing function (transparent scope)
 * or at program/global scope. The symbol must also be in a transparent-scope
 * function or be global.
 */
function isValidCrossFileVariableReference(symbol: FishSymbol, node: SyntaxNode, uri: string): boolean {
  const enclosingFunc = findParentFunction(node);
  // Node is at program/global scope (not inside any function)
  if (!enclosingFunc || !isFunctionDefinition(enclosingFunc)) {
    return symbol.isGlobal();
  }
  const enclosingFuncSymbol = analyzer.getEnclosingFunctionSymbol(uri, node);
  // Check --no-scope-shadowing
  if (
    enclosingFuncSymbol?.isFunctionWithNoScopeShadowing()
    && analyzer.isFunctionVisibleFrom(enclosingFuncSymbol, symbol.parent, symbol.document.uri)
  ) {
    return symbol.parent?.isFunctionWithNoScopeShadowing() || symbol.isGlobal();
  }
  // Check --inherit-variable
  if (isValidInheritVariableScope(symbol, node, uri)) {
    return true;
  }
  return false;
}

// Variable-specific reference checking
const checkVariableReference: ReferenceCheck = ({ symbol, document, node }) => {
  if (!symbol.isVariable() || node.text !== symbol.name) return false;

  const guardedQueryMatch = guardedSetQueryReference(symbol, document, node);
  if (guardedQueryMatch !== null) return guardedQueryMatch;

  // Bare command names (e.g. `foo`) are command/function references, not
  // variable references. `$foo` is still handled through variable nodes.
  if (isCommandName(node)) return false;

  // Check if the node is a variable definition or reference with the same name
  if (isVariable(node) || isVariableDefinitionName(node)) {
    // Same-file: scope was already validated by isInValidScope
    if (symbol.scopeContainsNode(node)) return true;
    // Node is inside a --no-scope-shadowing callee called from symbol's scope.
    if (isInNoScopeShadowingCallee(symbol, node, document.uri)) return true;
    // Same-file but outside active lifetime/scope is not a valid reference.
    if (symbol.uri === document.uri) return false;
    // Cross-file: verify both sides have transparent scope
    return isValidCrossFileVariableReference(symbol, node, document.uri);
  }

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

  if (symbol.name !== node.text) return false;
  if (symbol.scopeContainsNode(node)) return true;
  if (isInNoScopeShadowingCallee(symbol, node, document.uri)) return true;
  if (symbol.uri === document.uri) return false;
  return isValidCrossFileVariableReference(symbol, node, document.uri);
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
