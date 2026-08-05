import { Location, Position, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { isFunctionDefinition } from '../utils/node-types';
import { containsNode as nodeContainsNode, getRange } from '../utils/tree-sitter';

// === TYPES ===

type SymbolPair = {
  a: FishSymbol;
  b: FishSymbol;
};

type EqualityCheck = (pair: SymbolPair) => boolean;
type ScopeCheck = (pair: SymbolPair) => boolean;

// === RANGE & POSITION UTILITIES ===

// Check if two ranges are identical
export const rangesEqual = (range1: Range, range2: Range): boolean => {
  return range1.start.line === range2.start.line &&
    range1.start.character === range2.start.character &&
    range1.end.line === range2.end.line &&
    range1.end.character === range2.end.character;
};

// Check if a range contains a position
export const rangeContainsPosition = (range: Range, position: Position): boolean => {
  const { line, character } = position;
  const { start, end } = range;

  if (line < start.line || line > end.line) return false;
  if (line === start.line && character < start.character) return false;
  if (line === end.line && character > end.character) return false;

  return true;
};

// Check if a range contains a syntax node (by comparing line numbers only)
export const rangeContainsSyntaxNode = (range: Range, node: SyntaxNode): boolean => {
  return range.start.line <= node.startPosition.row &&
    range.end.line >= node.endPosition.row;
};

// === SYMBOL EQUALITY CHECKING ===

// Check if two symbols have matching names (including aliases)
const hasEqualNames: EqualityCheck = ({ a, b }) => {
  if (a.name === b.name) return true;
  return a.aliasedNames.includes(b.name) || b.aliasedNames.includes(a.name);
};

// Check if two symbols have identical ranges
const hasEqualRanges: EqualityCheck = ({ a, b }) => {
  return rangesEqual(a.range, b.range) && rangesEqual(a.selectionRange, b.selectionRange);
};

// Check if two symbols have matching basic properties
const hasEqualBasicProperties: EqualityCheck = ({ a, b }) => {
  return a.kind === b.kind &&
    a.uri === b.uri &&
    a.fishKind === b.fishKind;
};

// Main equality checker
export const equalSymbols = (symbolA: FishSymbol, symbolB: FishSymbol): boolean => {
  const pair: SymbolPair = { a: symbolA, b: symbolB };

  return hasEqualNames(pair) &&
    hasEqualBasicProperties(pair) &&
    hasEqualRanges(pair);
};

// === LOCATION EQUALITY ===

// Check if a symbol's location equals a given Location
export const symbolEqualsLocation = (symbol: FishSymbol, location: Location): boolean => {
  return symbol.uri === location.uri &&
    rangesEqual(symbol.selectionRange, location.range);
};

// === DEFINITION EQUALITY ===

// Check if two symbols represent the same definition
export const equalSymbolDefinitions = (symbolA: FishSymbol, symbolB: FishSymbol): boolean => {
  return symbolA.name === symbolB.name &&
    symbolA.kind === symbolB.kind &&
    symbolA.uri === symbolB.uri &&
    symbolContainsScope(symbolA, symbolB);
};

// === NODE EQUALITY ===

// Check if symbol equals a syntax node (with optional strict mode)
export const symbolEqualsNode = (symbol: FishSymbol, node: SyntaxNode, strict = false): boolean => {
  if (strict) return symbol.focusedNode.equals(node);
  return symbol.node.equals(node) || symbol.focusedNode.equals(node);
};

// === CONTAINMENT CHECKING ===

// Check if symbol's scope contains a syntax node
export const symbolScopeContainsNode = (symbol: FishSymbol, node: SyntaxNode): boolean => {
  return symbol.scope.containsPosition(getRange(node).start);
};

// Check if symbol contains a syntax node (by range)
export const symbolContainsNode = (symbol: FishSymbol, node: SyntaxNode): boolean => {
  return rangeContainsSyntaxNode(symbol.range, node);
};

// Check if symbol contains a position
export const symbolContainsPosition = (symbol: FishSymbol, position: Position): boolean => {
  const { line, character } = position;
  const { start, end } = symbol.selectionRange;

  return start.line === line &&
    start.character <= character &&
    end.character >= character;
};

// === SCOPE CHECKING ===

// Check if two symbols have identical scope nodes
const haveSameScopeNode: ScopeCheck = ({ a, b }) => {
  if (a.scopeTag === 'inherit' || b.scopeTag === 'inherit') {
    return a.scopeContainsNode(b.node) || b.scopeContainsNode(a.node);
  }
  if (a.isLocal() && b.isLocal() && a.kind === b.kind && a.isVariable() && b.isVariable()) {
    return a.scopeContainsNode(b.node) || b.scopeContainsNode(a.node);
  }
  return a.scope.scopeNode.equals(b.scope.scopeNode);
};

// Check if two symbols have compatible scope tags
const haveCompatibleScopeTags: ScopeCheck = ({ a, b }) => {
  const scopeTags = [a.scope.scopeTag, b.scope.scopeTag];

  // Special cases for scope compatibility
  if (scopeTags.includes('inherit')) return true;
  if (a.isLocal() && b.isLocal() && a.kind === b.kind && a.isVariable() && b.isVariable()) return true;
  if (a.isGlobal() && b.isGlobal()) return true;
  if (a.isLocal() && b.isLocal()) return true;

  return a.scope.scopeTag === b.scope.scopeTag;
};

// Check if scopes are equal
const haveEqualScopes: ScopeCheck = ({ a, b }) => {
  // Reflexivity must be explicit: the containment checks below are
  // lifetime-aware (see FishSymbol.scopeContainsNode), so a definition's own
  // command node — which starts at the `set`/`read` keyword, before the
  // definition's name token — is deliberately rejected by them. Compare by
  // definition site (equalSymbols), NOT by scope node: erase-separated
  // re-definitions share a scope node but are distinct bindings.
  if (equalSymbols(a, b)) return true;
  if (!haveSameScopeNode({ a, b }) || a.kind !== b.kind) return false;
  return haveCompatibleScopeTags({ a, b });
};

// Check scope containment for variables specifically
const checkVariableScopeContainment: ScopeCheck = ({ a, b }) => {
  if (!a.isVariable() || !b.isVariable()) return false;

  // Both global variables
  if (a.isGlobal() && b.isGlobal()) return true;

  // if one of the tags is global and the other is local, they cannot contain each other
  if (a.isGlobal() && b.isLocal() || a.isLocal() && b.isGlobal()) {
    return false;
  }
  const isSameScope = haveSameScopeNode({ a, b });
  const scopeContains = nodeContainsNode(a.scope.scopeNode, b.scope.scopeNode);

  // Special handling for function definitions
  if (isFunctionDefinition(a.scopeNode) && isFunctionDefinition(b.scopeNode)) {
    return isSameScope;
  }

  return isSameScope || scopeContains;
};

// Check scope containment for general case (used by symbolContainsScope)
const checkGeneralScopeContainment: ScopeCheck = ({ a, b }) => {
  if (!haveSameScopeNode({ a, b }) || a.kind !== b.kind) return false;

  const scopeTags = [a.scope.scopeTag, b.scope.scopeTag];

  // Handle inherit scope or local variables of same kind
  if (scopeTags.includes('inherit') ||
    a.isLocal() && b.isLocal() && a.kind === b.kind && a.isVariable() && b.isVariable()) {
    if (isFunctionDefinition(a.scope.scopeNode) && isFunctionDefinition(b.scope.scopeNode)) {
      return true;
    }

    return haveSameScopeNode({ a, b }) || nodeContainsNode(a.scope.scopeNode, b.scope.scopeNode);
  }

  // Handle global/local scope combinations
  if (a.isGlobal() && b.isGlobal()) return true;
  if (a.isLocal() && b.isLocal()) return true;

  return a.scope.scopeTag === b.scope.scopeTag;
};

/** Local variables share an owner only within the same lexical function. */
const sharesLocalOwner = (a: FishSymbol, b: FishSymbol): boolean => {
  const aOwner = a.getFunctionOwner();
  const bOwner = b.getFunctionOwner();
  return aOwner && bOwner ? aOwner.equals(bOwner) : !aOwner && !bOwner;
};

const hasExplicitVariableScope = (symbol: FishSymbol): boolean => {
  if (!symbol.isVariable()) return false;
  return symbol.options.some(option =>
    option.isOption('-U', '--universal')
    || option.isOption('-g', '--global')
    || option.isOption('-f', '--function')
    || option.isOption('-l', '--local'),
  );
};

/**
 * Main scope containment checker.
 *
 * The check sequence is load-bearing — each guard must run before the
 * shortcut it protects:
 *   1. owner guard — rejects cross-function pairs before any positional
 *      shortcut, since an outer local's scope node can physically span a
 *      nested function's body
 *   2. explicit-scope guard — rejects explicit `-U/-g/-f/-l` re-scopes before
 *      `haveEqualScopes`, whose tag matrix treats any two local variables'
 *      tags as compatible
 *   3. equal scopes — trivially contained (also carries reflexivity)
 *   4. kind-specific positional containment fallbacks
 */
export const symbolContainsScope = (symbolA: FishSymbol, symbolB: FishSymbol): boolean => {
  const pair: SymbolPair = { a: symbolA, b: symbolB };

  // Enforce owning-function identity for local variables before any positional
  // shortcut: a same-named local in a nested function (or the enclosing
  // script) is a different variable. Without this, an outer/script-level local
  // whose scope node spans the whole program would "contain" — and so absorb,
  // in goto-def/first-per-scope collapsing — a function's own local of the
  // same name (e.g. the script `argv` swallowing a function's `$argv`).
  if (
    symbolA.isVariable() && symbolB.isVariable()
    && symbolA.isLocal() && symbolB.isLocal()
    && !sharesLocalOwner(symbolA, symbolB)
  ) {
    return false;
  }

  // An explicit scope modifier creates or targets that exact scope. It must
  // not be folded into an enclosing binding merely because the enclosing
  // scope contains its command. Unscoped writes remain eligible to resolve to
  // the visible outer binding they update.
  if (
    symbolA.isVariable() && symbolB.isVariable()
    && hasExplicitVariableScope(symbolB)
    && (
      symbolA.scopeTag !== symbolB.scopeTag
      || !symbolA.scopeNode.equals(symbolB.scopeNode)
    )
  ) {
    return false;
  }

  // If scopes are equal, containment is true
  if (haveEqualScopes(pair)) return true;

  // Special handling for variables
  if (symbolA.isVariable() && symbolB.isVariable()) {
    return checkVariableScopeContainment(pair);
  }

  // General scope containment logic
  return checkGeneralScopeContainment(pair);
};

// Main scope equality checker
export const equalSymbolScopes = (symbolA: FishSymbol, symbolB: FishSymbol): boolean => {
  return haveEqualScopes({ a: symbolA, b: symbolB });
};

export const isFishSymbol = (obj: unknown): obj is FishSymbol => {
  return typeof obj === 'object'
    && obj !== null
    && 'name' in obj
    && 'fishKind' in obj
    && 'uri' in obj
    && 'node' in obj
    && 'focusedNode' in obj
    && 'scope' in obj
    && 'children' in obj
    && typeof (obj as any).name === 'string'
    && typeof (obj as any).uri === 'string'
    && Array.isArray((obj as any).children);
};

export const fishSymbolNameEqualsNodeText = (symbol: FishSymbol, node: SyntaxNode): boolean => {
  // Check if the symbol's name matches the text of the node
  return symbol.name === node.text;
};
