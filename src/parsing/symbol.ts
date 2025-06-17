import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, Location, FoldingRange, FoldingRangeKind, MarkupContent, MarkupKind, Hover, DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { containsNode, getChildNodes, getRange } from '../utils/tree-sitter';
import { findSetChildren, processSetCommand } from './set';
import { processReadCommand } from './read';
import { findFunctionDefinitionChildren, FunctionEventOptions, processArgvDefinition, processFunctionDefinition } from './function';
import { processForDefinition } from './for';
import { convertNodeRangeWithPrecedingFlag, processArgparseCommand } from './argparse';
import { Flag, isMatchingOption, LongFlag, Option, ShortFlag } from './options';
import { processAliasCommand } from './alias';
import { createDetail } from './symbol-detail';
import { config } from '../config';
import { flattenNested } from '../utils/flatten';
import { uriToPath } from '../utils/translation';
import { isCommand, isCommandWithName, isFunctionDefinitionName, isOption, isString, isTopLevelDefinition, isVariableDefinitionName } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';
import { processExportCommand } from './export';

export type FishSymbolKind = 'ARGPARSE' | 'FUNCTION' | 'ALIAS' | 'COMPLETE' | 'SET' | 'READ' | 'FOR' | 'VARIABLE' | 'FUNCTION_VARIABLE' | 'EXPORT';

export const FishSymbolKindMap: Record<Lowercase<FishSymbolKind>, FishSymbolKind> = {
  ['argparse']: 'ARGPARSE',
  ['function']: 'FUNCTION',
  ['alias']: 'ALIAS',
  ['complete']: 'COMPLETE',
  ['set']: 'SET',
  ['read']: 'READ',
  ['for']: 'FOR',
  ['variable']: 'VARIABLE',
  ['function_variable']: 'FUNCTION_VARIABLE',
  ['export']: 'EXPORT',
};

export const fishSymbolKindToSymbolKind: Record<FishSymbolKind, SymbolKind> = {
  ['ARGPARSE']: SymbolKind.Variable,
  ['FUNCTION']: SymbolKind.Function,
  ['ALIAS']: SymbolKind.Function,
  ['COMPLETE']: SymbolKind.Interface,
  ['SET']: SymbolKind.Variable,
  ['READ']: SymbolKind.Variable,
  ['FOR']: SymbolKind.Variable,
  ['VARIABLE']: SymbolKind.Variable,
  ['FUNCTION_VARIABLE']: SymbolKind.Variable,
  ['EXPORT']: SymbolKind.Variable,
} as const;

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

export const fromFishSymbolKindToSymbolKind = (kind: FishSymbolKind) => fishSymbolKindToSymbolKind[kind];

export interface FishSymbol extends DocumentSymbol {
  uri: string;
  fishKind: FishSymbolKind;
  node: SyntaxNode;
  focusedNode: SyntaxNode;
  scope: DefinitionScope;
  children: FishSymbol[];
  detail: string;
  parent: FishSymbol | undefined;
}

type OptionalFishSymbolPrototype = {
  name?: string;
  node: SyntaxNode;
  focusedNode: SyntaxNode;
  uri: string;
  detail: string;
  fishKind: FishSymbolKind;
  scope: DefinitionScope;
  children: FishSymbol[];
  range?: Range;
  selectionRange?: Range;
};

export class FishSymbol {
  public children: FishSymbol[] = [];
  public aliasedNames: string[] = [];

  constructor(obj: OptionalFishSymbolPrototype) {
    this.name = obj.name || obj.focusedNode.text;
    this.kind = fromFishSymbolKindToSymbolKind(obj.fishKind);
    this.fishKind = obj.fishKind;
    this.uri = obj.uri;
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
    uri: string,
    detail: string,
    scope: DefinitionScope,
    children: FishSymbol[] = [],
  ) {
    return new this({
      name: name || focusedNode.text,
      fishKind,
      uri,
      detail,
      node,
      focusedNode,
      scope,
      children,
    });
  }

  static fromObject(obj: OptionalFishSymbolPrototype) {
    return new this(obj);
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
    return this.name === node.text;
  }

  public get argparseFlagName() {
    return this.name.replace(/^_flag_/, '').replace(/_/g, '-');
  }

  public get argparseFlag(): Flag | string {
    if (this.fishKind !== 'ARGPARSE') return this.name;
    const flagName = this.argparseFlagName;
    if (flagName.length === 1) {
      return `-${flagName}` as ShortFlag;
    }
    return `--${flagName}` as LongFlag;
  }

  private isArgparseCompletionFlag(node: SyntaxNode) {
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

  get scopeNode() {
    return this.scope.scopeNode;
  }

  toString() {
    return JSON.stringify({
      name: this.name,
      kind: this.kind,
      uri: this.uri,
      detail: this.detail,
      range: this.range,
      selectionRange: this.selectionRange,
      scope: this.scope.scopeTag,
      aliasedNames: this.aliasedNames,
      children: this.children.map(child => child.name),
    }, null, 2);
  }

  equals(other: FishSymbol) {
    if (this.fishKind === 'ARGPARSE' && other.fishKind === 'ARGPARSE') {
      const equalNames = this.name === other.name || this.aliasedNames.includes(other.name) || other.aliasedNames.includes(this.name);
      // const equalNames = this.aliasedNames.includes(other.name)
      // && other.aliasedNames.includes(this.name)
      return equalNames &&
        this.uri === other.uri &&
        this.focusedNode.equals(other.focusedNode);
    }
    const equalNames = this.name === other.name
      ? true
      : this.aliasedNames.includes(other.name) || other.aliasedNames.includes(this.name);
    return equalNames &&
      this.kind === other.kind &&
      this.uri === other.uri &&
      this.range.start.line === other.range.start.line &&
      this.range.start.character === other.range.start.character &&
      this.range.end.line === other.range.end.line &&
      this.range.end.character === other.range.end.character &&
      this.selectionRange.start.line === other.selectionRange.start.line &&
      this.selectionRange.start.character === other.selectionRange.start.character &&
      this.selectionRange.end.line === other.selectionRange.end.line &&
      this.selectionRange.end.character === other.selectionRange.end.character &&
      this.fishKind === other.fishKind;
  }

  equalArgparse(other: FishSymbol) {
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

  equalLocations(other: Location) {
    return this.uri === other.uri
      && this.selectionRange.start.line === other.range.start.line
      && this.selectionRange.start.character === other.range.start.character
      && this.selectionRange.end.line === other.range.end.line
      && this.selectionRange.end.character === other.range.end.character;
  }

  toWorkspaceSymbol(): WorkspaceSymbol {
    return WorkspaceSymbol.create(
      this.name,
      this.kind,
      this.uri,
      this.selectionRange,
    );
  }

  toDocumentSymbol(): DocumentSymbol {
    return DocumentSymbol.create(
      this.name,
      this.detail,
      this.kind,
      this.range,
      this.selectionRange,
      this.children.map(child => child.toDocumentSymbol()),
    );
  }

  toPosition(): { line: number; character: number; } {
    return {
      line: this.selectionRange.start.line,
      character: this.selectionRange.start.character,
    };
  }

  toLocation(): Location {
    return Location.create(
      this.uri,
      this.selectionRange,
    );
  }

  isBefore(other: FishSymbol) {
    if (this.fishKind === 'FUNCTION' && other.name === 'argv') {
      return this.range.start.line === other.range.start.line
        && this.range.start.character === other.range.start.character;
    }
    if (this.selectionRange.start.line < other.selectionRange.start.line) {
      return true;
    }
    if (this.selectionRange.start.line === other.selectionRange.start.line) {
      return this.selectionRange.start.character < other.selectionRange.start.character
        && this.selectionRange.end.character < other.selectionRange.end.character;
    }
    return false;
  }

  isAfter(other: FishSymbol) {
    if (this.name === 'argv' && other.fishKind === 'FUNCTION') {
      return this.selectionRange.start.line === other.selectionRange.start.line
        && this.selectionRange.start.character === other.selectionRange.start.character;
    }
    if (this.selectionRange.start.line > other.selectionRange.start.line) {
      return true;
    }
    if (this.selectionRange.start.line === other.selectionRange.start.line) {
      return this.selectionRange.start.character > other.selectionRange.start.character;
    }
    return false;
  }

  isAfterRange(range: Range) {
    if (this.selectionRange.start.line > range.start.line) {
      return true;
    }
    if (this.selectionRange.start.line === range.start.line) {
      if (this.selectionRange.end.line === range.end.line) {
        return this.selectionRange.start.character > range.start.character
          && this.selectionRange.end.character <= range.end.character;
      }
      return this.selectionRange.start.character > range.start.character
        && this.selectionRange.end.line <= range.end.line;
    }
    return false;
  }

  toFoldingRange(): FoldingRange {
    return {
      startLine: this.range.start.line,
      endLine: this.range.end.line,
      startCharacter: this.range.start.character,
      endCharacter: this.range.end.character,
      collapsedText: this.name,
      kind: FoldingRangeKind.Region,
    };
  }

  equalScopes(other: FishSymbol) {
    if (this.scope.scopeNode.equals(other.scope.scopeNode) && this.fishKind === other.fishKind) {
      if ([this.scope.scopeTag, other.scope.scopeTag].includes('inherit')) {
        return this.scope.scopeNode.equals(other.scope.scopeNode);
      } else if (this.isGlobal() && other.isGlobal()) {
        return true;
      }
      return this.scope.scopeTag === other.scope.scopeTag;
    }
    return false;
  }

  isLocal() {
    return !this.isGlobal();
  }

  isGlobal() {
    return this.scope.scopeTag === 'global' || this.scope.scopeTag === 'universal';
  }

  isRootLevel() {
    return isTopLevelDefinition(this.node);
  }

  isFunction(): boolean {
    return this.fishKind === 'FUNCTION' || this.fishKind === 'ALIAS';
  }

  isVariable(): boolean {
    return !this.isFunction();
  }

  isSymbolImmutable() {
    if (!config.fish_lsp_modifiable_paths.some(path => this.path.startsWith(path))) {
      return true;
    }
    return false;
  }

  toMarkupContent(): MarkupContent {
    return {
      kind: MarkupKind.Markdown,
      value: this.detail,
    };
  }

  /**
   * Optionally include the current document's uri to the hover, this will determine
   * if a range is local to the current document (local ranges include hover range)
   */
  toHover(currentUri: DocumentUri = ''): Hover {
    return {
      contents: this.toMarkupContent(),
      range: currentUri === this.uri ? this.selectionRange : undefined,
    };
  }

  scopeContainsNode(node: SyntaxNode) {
    return this.scope.containsPosition(getRange(node).start);
  }

  containsNode(node: SyntaxNode) {
    return this.range.start.line <= node.startPosition.row
      && this.range.end.line >= node.endPosition.row;
  }

  containsPosition(position: { line: number; character: number; }) {
    return this.selectionRange.start.line === position.line
      && this.selectionRange.start.character <= position.character
      && this.selectionRange.end.character >= position.character;
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
   * A function that is autoloaded and includes an `event` hook
   */
  hasEventHook() {
    if (!this.isFunction()) return false;
    for (const child of findFunctionDefinitionChildren(this.node)) {
      if (isOption(child) && FunctionEventOptions.some(option => option.matches(child))) {
        return true;
      }
    }
    return false;
  }
}

export function getLocalSymbols(symbols: FishSymbol[]): FishSymbol[] {
  return symbols.filter(symbol => symbol.isLocal());
}

export function getGlobalSymbols(symbols: FishSymbol[]): FishSymbol[] {
  return symbols.filter(symbol => symbol.isGlobal());
}

export function isSymbol(symbols: FishSymbol[], kind: FishSymbolKind): FishSymbol[] {
  return symbols.filter(symbol => symbol.fishKind === kind);
}

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

export function findMatchingLocations(symbol: FishSymbol, allSymbols: FishSymbol[], document: LspDocument, rootNode: SyntaxNode): Location[] {
  const result: SyntaxNode[] = [];
  const matchingNodes = allSymbols.filter(s => s.name === symbol.name && !symbol.equalScopes(s))
    .map(s => symbol.fishKind === 'ALIAS' ? s.node : s.scopeNode);

  for (const node of getChildNodes(rootNode)) {
    if (matchingNodes.some(n => containsNode(n, node))) continue;
    if (symbol.isEqualLocation(node)) {
      result.push(node);
    }
  }
  return result.map(node => symbol.fishKind === 'ARGPARSE'
    ? Location.create(document.uri, convertNodeRangeWithPrecedingFlag(node))
    : Location.create(document.uri, getRange(node)),
  );
}

export function removeLocalSymbols(symbol: FishSymbol, symbols: FlatFishSymbolTree) {
  return symbols.filter(s => s.name === symbol.name && !symbol.equalScopes(s) && !s.equals(symbol));
}

function isEmptyString(node: SyntaxNode) {
  return isString(node) && node.text.length === 2;
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
