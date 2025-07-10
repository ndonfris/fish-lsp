import { DocumentSymbol, SymbolKind, WorkspaceSymbol, Location, FoldingRange, MarkupContent, Hover, DocumentUri, Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { containsNode, getChildNodes, getRange } from '../utils/tree-sitter';
import { findSetChildren, processSetCommand } from './set';
import { processReadCommand } from './read';
import { isFunctionVariableDefinitionName, processArgvDefinition, processFunctionDefinition } from './function';
import { processForDefinition } from './for';
import { convertNodeRangeWithPrecedingFlag, processArgparseCommand } from './argparse';
import { Flag, isMatchingOption, LongFlag, Option, ShortFlag } from './options';
import { processAliasCommand } from './alias';
import { createDetail } from './symbol-detail';
import { config } from '../config';
import { flattenNested } from '../utils/flatten';
import { uriToPath } from '../utils/translation';
import { isCommand, isCommandWithName, isEmptyString, isFunctionDefinitionName, isString, isTopLevelDefinition, isVariableDefinitionName } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';
import { isExportVariableDefinitionName, processExportCommand } from './export';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol } from './complete';
import { analyzer } from '../analyze';
import { isEmittedEventDefinitionName, isGenericFunctionEventHandlerDefinitionName, processEmitEventCommandName } from './emit';
import { isSymbolReference } from './reference-comparator';
import { equalSymbolDefinitions, equalSymbols, equalSymbolScopes, fishSymbolNameEqualsNodeText, isFishSymbol, symbolContainsNode, symbolContainsPosition, symbolContainsScope, symbolEqualsLocation, symbolEqualsNode, symbolScopeContainsNode } from './equality-utils';
import { SymbolConverters } from './symbol-converters';
import { FishKindGroups, FishSymbolInput, FishSymbolKind, fishSymbolKindToSymbolKind, fromFishSymbolKindToSymbolKind } from './symbol-kinds';

export interface FishSymbol extends DocumentSymbol {
  document: LspDocument;
  uri: string;
  fishKind: FishSymbolKind;
  node: SyntaxNode;
  focusedNode: SyntaxNode;
  scope: DefinitionScope;
  children: FishSymbol[];
  detail: string;
  parent: FishSymbol | undefined;
}

export class FishSymbol {
  public children: FishSymbol[] = [];
  public aliasedNames: string[] = [];
  public document: LspDocument;

  constructor(obj: FishSymbolInput) {
    this.name = obj.name || obj.focusedNode.text;
    this.kind = fromFishSymbolKindToSymbolKind(obj.fishKind);
    this.fishKind = obj.fishKind;
    this.document = obj.document;
    this.uri = obj.uri || obj.document.uri.toString();
    this.range = obj.range || getRange(obj.node);
    this.selectionRange = obj.selectionRange || getRange(obj.focusedNode);
    this.node = obj.node;
    this.focusedNode = obj.focusedNode;
    this.scope = obj.scope;
    this.children = obj.children;
    this.children.forEach(child => {
      child.parent = this;
    });
    this.detail = obj.detail;
    this.setupDetail();
  }

  setupDetail() {
    this.detail = createDetail(this);
  }

  static create(
    name: string,
    node: SyntaxNode,
    focusedNode: SyntaxNode,
    fishKind: FishSymbolKind,
    document: LspDocument,
    uri: string = document.uri.toString(),
    detail: string,
    scope: DefinitionScope,
    children: FishSymbol[] = [],
  ) {
    return new this({
      name: name || focusedNode.text,
      fishKind,
      document,
      uri,
      detail,
      node,
      focusedNode,
      scope,
      children,
    });
  }

  static fromObject(obj: FishSymbolInput) {
    return new this(obj);
  }

  public copy(): FishSymbol {
    return SymbolConverters.copySymbol(this);
  }

  static is(obj: unknown): obj is FishSymbol {
    return isFishSymbol(obj);
  }

  addChildren(...children: FishSymbol[]) {
    this.children.push(...children);
    children.forEach(child => {
      child.parent = this;
    });
    return this;
  }

  addAliasedNames(...names: string[]) {
    this.aliasedNames.push(...names);
    return this;
  }

  private nameEqualsNodeText(node: SyntaxNode) {
    return fishSymbolNameEqualsNodeText(this, node);
  }

  /**
   * Returns the `argparse flag-name` for the symbol `_flag_flag_name`
   */
  public get argparseFlagName() {
    return FishSymbol.argparseFlagFromName(this.name);
  }

  /**
   * Static method to convert a FishSymbol.isArgparse() with `_flag_variable_name` to `variable-name`
   */
  public static argparseFlagFromName(name: string) {
    return name.replace(/^_flag_/, '').replace(/_/g, '-');
  }

  /**
   * Returns the argparse flag for the symbol, e.g. `-f` or `--flag-name`
   */
  public get argparseFlag(): Flag | string {
    if (this.fishKind !== 'ARGPARSE') return this.name;
    const flagName = this.argparseFlagName;
    if (flagName.length === 1) {
      return `-${flagName}` as ShortFlag;
    }
    return `--${flagName}` as LongFlag;
  }

  /**
   * Checks if an argparse _flag_name FishSymbol is equal to a SyntaxNode,
   * where the SyntaxNode corresponds to the argparse
   *
   *
   * ```fish
   * function this.parent.name
   *     argparse f/flag-name -- $argv
   * #            ^^^^^^^^^^^---- This is the argparse flag name
   * end
   *
   * complete -c this.parent.name -s f -l flag-name
   * #                               ^    ^^^^^^^^^ Either of these could be the node (depending on the FishSymbol selected)
   * ```
   *
   * @param node - The SyntaxNode to check against (`complete ... -s/-l NODE`)
   * @return {boolean} - True if the node matches the argparse flag name, false otherwise
   */
  private isArgparseCompletionFlag(node: SyntaxNode): boolean {
    if (this.fishKind === 'ARGPARSE') return false;
    if (node.parent && isCommandWithName(node, 'complete')) {
      const flagName = this.argparseFlagName;
      if (node.previousSibling) {
        return flagName.length === 1
          ? Option.create('-s', '--short').matches(node.previousSibling)
          : Option.create('-l', '--long').matches(node.previousSibling);
      }
    }
    return false;
  }

  /**
   * Checks if the node is a command completion flag, e.g. `complete -c NODE` or `complete --command NODE`
   */
  private isCommandCompletionFlag(node: SyntaxNode) {
    if (this.fishKind === 'COMPLETE') return false;
    if (node.parent && isCommandWithName(node.parent, 'complete')) {
      if (node.previousSibling) {
        return Option.create('-c', '--command').matches(node.previousSibling);
      }
    }
    return false;
  }

  isEqualLocation(node: SyntaxNode) {
    if (!node.isNamed || this.focusedNode.equals(node) || !this.nameEqualsNodeText(node)) {
      return false;
    }
    switch (this.fishKind) {
      case 'FUNCTION':
      case 'ALIAS':
        return node.parent && isCommandWithName(node.parent, 'complete')
          ? !isVariableDefinitionName(node) && !isCommand(node) && this.isCommandCompletionFlag(node)
          : !isVariableDefinitionName(node) && !isCommand(node);
      case 'ARGPARSE':
        // return !isFunctionDefinitionName(node) && isMatchingCompleteOptionIsCommand(node);
        return !isFunctionDefinitionName(node) || this.isArgparseCompletionFlag(node);
      case 'SET':
      case 'READ':
      case 'FOR':
      case 'VARIABLE':
        return !isFunctionDefinitionName(node);
      case 'EXPORT':
        return isExportVariableDefinitionName(node);
      case 'FUNCTION_VARIABLE':
        return isFunctionVariableDefinitionName(node);
      case 'EVENT':
        return isEmittedEventDefinitionName(node);
      case 'FUNCTION_EVENT':
        return isGenericFunctionEventHandlerDefinitionName(node);
      case 'COMPLETE':
        return isCompletionCommandDefinition(node) || isCompletionSymbol(node);
      default:
        return false;
    }
  }

  get path() {
    return uriToPath(this.uri);
  }

  get workspacePath() {
    const path = this.path;
    const pathItems = path.split('/');
    let lastItem = pathItems.at(-1)!;
    if (lastItem === 'config.fish') {
      return pathItems.slice(0, -1).join('/');
    }
    lastItem = pathItems.at(-2)!;
    if (['functions', 'completions', 'conf.d'].includes(lastItem)) {
      return pathItems.slice(0, -2).join('/');
    }
    return pathItems.slice(0, -1).join('/');
  }

  get scopeTag() {
    return this.scope.scopeTag;
  }

  /**
   * Enclosing SyntaxNode for symbols constraint inside of a local document
   * A global symbol will still have a scopeNode, but it should not be used to limit
   * the scope of a symbol. It is more common to limit the scope of a Symbol based
   * on if their is a redefined symbol (same name & type) inside of a smaller scope.
   */
  get scopeNode() {
    return this.scope.scopeNode;
  }

  // === Conversion Utils ===
  toString() {
    return SymbolConverters.symbolToString(this);
  }

  toWorkspaceSymbol(): WorkspaceSymbol {
    return SymbolConverters.symbolToWorkspaceSymbol(this);
  }

  toDocumentSymbol(): DocumentSymbol | undefined {
    return SymbolConverters.symbolToDocumentSymbol(this);
  }

  toLocation(): Location {
    return SymbolConverters.symbolToLocation(this);
  }

  toPosition(): Position {
    return SymbolConverters.symbolToPosition(this);
  }

  toFoldingRange(): FoldingRange {
    return SymbolConverters.symbolToFoldingRange(this);
  }

  toMarkupContent(): MarkupContent {
    return SymbolConverters.symbolToMarkupContent(this);
  }

  /**
   * Optionally include the current document's uri to the hover, this will determine
   * if a range is local to the current document (local ranges include hover range)
   */
  toHover(currentUri: DocumentUri = ''): Hover {
    return SymbolConverters.symbolToHover(this, currentUri);
  }

  // === FishSymbol type/location info ===
  isLocal() {
    return !this.isGlobal();
  }

  isGlobal() {
    return this.scope.scopeTag === 'global' || this.scope.scopeTag === 'universal';
  }

  isRootLevel() {
    return isTopLevelDefinition(this.node);
  }

  isEventHook(): boolean {
    return this.fishKind === 'FUNCTION_EVENT';
  }

  isEmittedEvent(): boolean {
    return this.fishKind === 'EVENT';
  }

  isEvent(): boolean {
    return FishKindGroups.EVENTS.includes(this.fishKind);
  }

  isFunction(): boolean {
    return FishKindGroups.FUNCTIONS.includes(this.fishKind);
  }

  isVariable(): boolean {
    return FishKindGroups.VARIABLES.includes(this.fishKind);
  }

  isArgparse(): boolean {
    return FishKindGroups.ARGPARSE.includes(this.fishKind);
  }

  isSymbolImmutable() {
    if (!config.fish_lsp_modifiable_paths.some(path => this.path.startsWith(path))) {
      return true;
    }
    return false;
  }

  //
  // Helpers for checking if the symbol is a fish_lsp_* config variable
  //

  /**
   * Checks if the symbol is a key in the `config` object, which means it changes the
   * configuration of the fish-lsp server.
   */
  isConfigDefinition() {
    if (this.kind !== SymbolKind.Variable || this.fishKind !== 'SET') {
      return false;
    }
    return Object.keys(config).includes(this.name);
  }

  /**
   * Checks if a config variable has the `--erase` option set
   */
  isConfigDefinitionWithErase() {
    if (!this.isConfigDefinition()) return false;
    const eraseOption = Option.create('-e', '--erase');
    const definitionNode = this.focusedNode;
    const children = findSetChildren(this.node)
      .filter(s => s.startIndex < definitionNode.startIndex);
    return children.some(s => isMatchingOption(s, eraseOption));
  }

  /**
   * Finds the value nodes of a config variable definition
   */
  findValueNodes(): SyntaxNode[] {
    const valueNodes: SyntaxNode[] = [];
    if (!this.isConfigDefinition()) return valueNodes;
    let node: null | SyntaxNode = this.focusedNode.nextNamedSibling;
    while (node) {
      if (!isEmptyString(node)) valueNodes.push(node);
      node = node.nextNamedSibling;
    }
    return valueNodes;
  }

  /**
   * Converts the value nodes of a config variable definition to shell values
   */
  valuesAsShellValues() {
    return this.findValueNodes().map(node => {
      let text = node.text;
      if (isString(node)) text = text.slice(1, -1);
      return SyncFileHelper.expandEnvVars(text);
    });
  }

  /**
   * Checks if both the current & other symbol define the same argparse flag, when
   * their is multiple equivalent _flag_names/_flag_n seen in the same argparse option.
   */
  equalArgparse(other: FishSymbol | CompletionSymbol) {
    if (FishSymbol.is(other)) {
      const equalNames = this.name !== other.name && this.aliasedNames.includes(other.name) && other.aliasedNames.includes(this.name);

      const equalParents = this.parent && other.parent
        ? this.parent.equals(other.parent)
        : !this.parent && !other.parent;

      return equalNames &&
        this.uri === other.uri &&
        this.fishKind === 'ARGPARSE' && other.fishKind === 'ARGPARSE' &&
        this.focusedNode.equals(other.focusedNode) &&
        this.node.equals(other.node) &&
        equalParents &&
        this.scopeNode.equals(other.scopeNode);
    }
    return false;
  }

  /**
   * A function that is autoloaded and includes an `event` hook
   *
   * ```fish
   * function my_function --on-event my_event
   * #        ^^^^^^^^^^^--------------------  my_function would return true
   * end
   * ```
   */
  hasEventHook() {
    if (!this.isFunction()) return false;
    for (const child of this.children) {
      if (child.isEventHook()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if two symbols are equal events, excluding equality of the symbols
   * equaling the exact same symbol. Also ensures that one of the Symbols is a
   * event handler name, and the other is the emitted event name. Order does not
   * matter, allowing for either symbol to be the event handler or the emitted event.
   *
   * ```fish
   *  function PARENT --on-event SYMBOL
   *  #                          ^^^^^^---- This is the event handler definition name
   *  end
   *
   *  emit SYMBOL
   *  #    ^^^^^^-------------------------- This is the emitted event definition name
   * ```
   *
   * @param other - The other symbol to compare against
   * @return {boolean} - True if the symbols are equal events, false otherwise
   *
   */
  equalsEvent(other: FishSymbol | CompletionSymbol): boolean {
    if (!FishSymbol.is(other)) return false;
    if (!this.isEvent() || !other.isEvent()) return false;
    if (this.fishKind === other.fishKind) return false;

    // parent of the `function PARENT --on-event SYMBOL`
    const parent = this.fishKind === 'FUNCTION_EVENT'
      ? this.parent
      : other.parent;

    // child is the `emit SYMBOL` corresponding to the event in a function handler
    const child = this.fishKind === 'EVENT'
      ? this
      : other;

    // check if the parent and child exist and have same name
    return !!(parent && child && child.name === parent.name);
  }

  /**
   * The heavy lifting utility to determine if a node is a reference to the current
   * symbol.
   *
   * @param document The LspDocument to check against
   * @param node The SyntaxNode to check
   * @param excludeEqualNode If true, the node itself will not be considered a reference
   *
   * @returns {boolean} True if the node is a reference to the symbol, false otherwise
   */
  isReference(document: LspDocument, node: SyntaxNode, excludeEqualNode = false): boolean {
    return isSymbolReference(this, document, node, excludeEqualNode);
  }

  /**
   * Checks if 2 symbols are the same, based on their properties.
   */
  equals(other: FishSymbol): boolean {
    return equalSymbols(this, other);
  }

  /**
   * Checks if the symbols have the same location.
   */
  equalLocations(location: Location): boolean {
    return symbolEqualsLocation(this, location);
  }

  /**
   * Checks if a Symbol is defined in the same scope as its comparison symbol.
   */
  equalDefinition(other: FishSymbol): boolean {
    return equalSymbolDefinitions(this, other);
  }

  /**
   * Checks if the symbol is equal to the SyntaxNode
   * @param node The SyntaxNode to compare against
   * @param opts.strict If true, the comparison will be strict, meaning the node must match the symbol's focusedNode
   *               Otherwise, a match can be either the focusedNode or the node itself.
   * @returns {boolean} True if the symbol is equal to the node, false otherwise
   */
  equalsNode(node: SyntaxNode, opts: {strict?: boolean;} = { strict: false }): boolean {
    return symbolEqualsNode(this, node, opts.strict);
  }

  /**
   * Checks if the symbol contains the other symbol's scope.
   * Here, the current Symbol must be ATLEAST equivalent parents to the other symbol
   * when the other symbol's Scope is not greater than the current symbol's scope.
   */
  containsScope(other: FishSymbol): boolean {
    return symbolContainsScope(this, other);
  }

  /**
   * Checks if the symbol has the same scope as the other symbol.
   */
  equalScopes(other: FishSymbol): boolean {
    return equalSymbolScopes(this, other);
  }

  /**
   * Checks if the symbol contains the node in its scope.
   */
  scopeContainsNode(node: SyntaxNode): boolean {
    return symbolScopeContainsNode(this, node);
  }

  /**
   * Checks if the symbol.range contains or is equal to the node's range.
   */
  containsNode(node: SyntaxNode): boolean {
    return symbolContainsNode(this, node);
  }

  /**
   * Check if the current symbols position contains or is equal to the given position
   * @param position The position to check against
   * @return {boolean} True if the symbol contains the position, false otherwise
   */
  containsPosition(position: { line: number; character: number; }): boolean {
    return symbolContainsPosition(this, position);
  }
}

export const SetModifierToScopeTag = (modifier: Option) => {
  switch (true) {
    case modifier.isOption('-U', '--universal'):
      return 'universal';
    case modifier.isOption('-g', '--global'):
      return 'global';
    case modifier.isOption('-f', '--function'):
      return 'function';
    case modifier.isOption('-l', '--local'):
      return 'local';
    default:
      return 'local';
  }
};

export {
  FishSymbolKind,
  fromFishSymbolKindToSymbolKind,
  FishKindGroups,
  fishSymbolKindToSymbolKind,
};

export function filterLastPerScopeSymbol(symbols: FishSymbol[]) {
  const flatArray: FishSymbol[] = flattenNested(...symbols);
  const array: FishSymbol[] = [];
  for (const symbol of symbols) {
    const lastSymbol = flatArray.findLast((s: FishSymbol) => {
      return s.name === symbol.name && s.kind === symbol.kind && s.uri === symbol.uri
        && s.equalScopes(symbol);
    });
    if (lastSymbol && lastSymbol.equals(symbol)) {
      array.push(symbol);
    }
  }
  return array;
}

export function findFirstPerScopeSymbol(symbols: FishSymbol[]) {
  const flatArray: FishSymbol[] = flattenNested(...symbols);
  const array: FishSymbol[] = [];
  for (const symbol of symbols) {
    const firstSymbol = flatArray.find((s: FishSymbol) => {
      return s.equalDefinition(symbol);
    });
    if (firstSymbol && firstSymbol.equals(symbol)) {
      array.push(symbol);
    }
  }
  return array;
}

export function filterFirstUniqueSymbolperScope(document: LspDocument): FishSymbol[] {
  const symbols = analyzer.getFlatDocumentSymbols(document.uri);
  const result: FishSymbol[] = [];

  for (const symbol of symbols) {
    const alreadyExists = result.some(existing =>
      existing.name === symbol.name && existing.equalDefinition(symbol),
    );
    if (!alreadyExists) {
      result.push(symbol);
    }
  }

  return result;
}

export function findLocalLocations(symbol: FishSymbol, allSymbols: FishSymbol[], includeSelf = true): Location[] {
  const result: SyntaxNode[] = [];
  /*
   * Here we need to handle aliases where there exists a function with the same name
   * (A very weird edge case)
   */
  const matchingNodes = allSymbols.filter(s => s.name === symbol.name && !symbol.equalScopes(s))
    .map(s => symbol.fishKind === 'ALIAS' ? s.node : s.scopeNode);

  for (const node of getChildNodes(symbol.scopeNode)) {
    /** skip nodes that would be considered a match for another symbol */
    if (matchingNodes.some(n => containsNode(n, node))) continue;
    if (symbol.isEqualLocation(node)) result.push(node);
  }
  return [
    includeSelf && symbol.name !== 'argv' ? symbol.toLocation() : undefined,
    ...result.map(node => symbol.fishKind === 'ARGPARSE'
      ? Location.create(symbol.uri, convertNodeRangeWithPrecedingFlag(node))
      : Location.create(symbol.uri, getRange(node)),
    ),
  ].filter(Boolean) as Location[];
}

// export function findMatchingLocations(symbol: FishSymbol, allSymbols: FishSymbol[], document: LspDocument, rootNode: SyntaxNode): Location[] {
//   const result: SyntaxNode[] = [];
//   const matchingNodes = allSymbols.filter(s => s.name === symbol.name && !symbol.equalScopes(s))
//     .map(s => symbol.fishKind === 'ALIAS' ? s.node : s.scopeNode);
//
//   for (const node of getChildNodes(rootNode)) {
//     if (matchingNodes.some(n => containsNode(n, node))) continue;
//     if (symbol.isEqualLocation(node)) {
//       result.push(node);
//     }
//   }
//   return result.map(node => symbol.fishKind === 'ARGPARSE'
//     ? Location.create(document.uri, convertNodeRangeWithPrecedingFlag(node))
//     : Location.create(document.uri, getRange(node)),
//   );
// }

export function removeLocalSymbols(symbol: FishSymbol, symbols: FlatFishSymbolTree) {
  return symbols.filter(s => s.name === symbol.name && !symbol.equalScopes(s) && !s.equals(symbol));
}

/**
 * Formats a tree of FishSymbols into a string with proper indentation
 * @param symbols Array of FishSymbol objects to format
 * @param indentLevel Initial indentation level (optional, defaults to 0)
 * @returns A string representing the formatted tree
 */
export function formatFishSymbolTree(symbols: FishSymbol[], indentLevel: number = 0): string {
  let result = '';
  const indentString = '  '; // 2 spaces per indent level

  for (const symbol of symbols) {
    const indent = indentString.repeat(indentLevel);
    const scopeTag = symbol.scope?.scopeTag || 'unknown';
    result += `${indent}${symbol.name} (${symbol.fishKind}) (${scopeTag})\n`;

    // Recursively format children with increased indent
    if (symbol.children && symbol.children.length > 0) {
      result += formatFishSymbolTree(symbol.children, indentLevel + 1);
    }
  }

  return result;
}

function buildNested(document: LspDocument, node: SyntaxNode, ...children: FishSymbol[]): FishSymbol[] {
  const firstNamedChild = node.firstNamedChild as SyntaxNode;
  const newSymbols: FishSymbol[] = [];

  switch (node.type) {
    case 'function_definition':
      newSymbols.push(...processFunctionDefinition(document, node, children));
      break;
    case 'for_statement':
      newSymbols.push(...processForDefinition(document, node, children));
      break;
    case 'command':
      if (!firstNamedChild?.text) break;
      switch (firstNamedChild.text) {
        case 'set':
          newSymbols.push(...processSetCommand(document, node, children));
          break;
        case 'read':
          newSymbols.push(...processReadCommand(document, node, children));
          break;
        case 'argparse':
          newSymbols.push(...processArgparseCommand(document, node, children));
          break;
        case 'alias':
          newSymbols.push(...processAliasCommand(document, node, children));
          break;
        case 'export':
          newSymbols.push(...processExportCommand(document, node, children));
          break;
        case 'emit':
          newSymbols.push(...processEmitEventCommandName(document, node, children));
          break;
        default:
          break;
      }
      break;
  }
  return newSymbols;
}

export type NestedFishSymbolTree = FishSymbol[];
export type FlatFishSymbolTree = FishSymbol[];

export function processNestedTree(document: LspDocument, ...nodes: SyntaxNode[]): NestedFishSymbolTree {
  const symbols: FishSymbol[] = [];

  /** add argv to script files */
  if (!document.isAutoloadedUri()) {
    const programNode = nodes.find(node => node.type === 'program');
    if (programNode) symbols.push(...processArgvDefinition(document, programNode));
  }

  for (const node of nodes) {
    // Process children first (bottom-up approach)
    const childSymbols = processNestedTree(document, ...node.children);

    // Process the current node and integrate children
    const newSymbols = buildNested(document, node, ...childSymbols);

    if (newSymbols.length > 0) {
      // If we created symbols for this node, add them (they should contain children)
      symbols.push(...newSymbols);
    } else if (childSymbols.length > 0) {
      // If no new symbols from this node but we have child symbols, bubble them up
      symbols.push(...childSymbols);
    }
    // If neither condition is met, we add nothing
  }

  return symbols;
}
