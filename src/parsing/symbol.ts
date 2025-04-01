import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, Location, FoldingRange, FoldingRangeKind, MarkupContent, MarkupKind, Hover } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { containsNode, getChildNodes, getRange } from '../utils/tree-sitter';
import { processSetCommand } from './set';
import { processReadCommand } from './read';
import { processArgvDefinition, processFunctionDefinition } from './function';
import { processForDefinition } from './for';
import { convertNodeRangeWithPrecedingFlag, processArgparseCommand } from './argparse';
import { Option } from './options';
import { processAliasCommand } from './alias';
import { createDetail } from './symbol-detail';
import { config } from '../config';
import { flattenNested } from '../utils/flatten';
import { uriToPath } from '../utils/translation';
import { isCommand, isCommandWithName, isFunctionDefinitionName, isVariableDefinitionName } from '../utils/node-types';

export type FishSymbolKind = 'ARGPARSE' | 'FUNCTION' | 'ALIAS' | 'COMPLETE' | 'SET' | 'READ' | 'FOR' | 'VARIABLE';

export const FishSymbolKindMap: Record<Lowercase<FishSymbolKind>, FishSymbolKind> = {
  ['argparse']: 'ARGPARSE',
  ['function']: 'FUNCTION',
  ['alias']: 'ALIAS',
  ['complete']: 'COMPLETE',
  ['set']: 'SET',
  ['read']: 'READ',
  ['for']: 'FOR',
  ['variable']: 'VARIABLE',
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
      return equalNames &&
        this.uri === other.uri &&
        this.node.equals(other.node);
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

  toWorkspaceSymbol(): WorkspaceSymbol {
    return WorkspaceSymbol.create(
      this.name,
      this.kind,
      this.uri,
      this.selectionRange,
    );
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

  isSymbolImmutable() {
    if (!config.fish_lsp_modifiable_paths.some(path => this.path.startsWith(path))) {
      return true;
    }
    // if (
    //   config.fish_lsp_all_indexed_paths.length > 0 &&
    //   !config.fish_lsp_modifiable_paths.some(path => this.uri.includes(path))
    // ) {
    //   return false;
    // }
    return false;
  }

  toMarkupContent(): MarkupContent {
    return {
      kind: MarkupKind.Markdown,
      value: this.detail,
    };
  }

  toHover(): Hover {
    return {
      contents: this.toMarkupContent(),
      range: this.selectionRange,
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
  // return array
  //   .filter((symbol) => !flatArray.some((s) => {
  //     return (
  //       s.name === symbol.name &&
  //       !s.equals(symbol) &&
  //       symbol.equalScopes(s) &&
  //       symbol.isBefore(s)
  //     );
  //   }));
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

  /** add argv to script files */
  if (!document.isAutoloadedUri()) {
    const programNode = nodes.find(node => node.type === 'program');
    if (programNode) symbols.unshift(...processArgvDefinition(document, programNode));
  }

  return symbols;
}
