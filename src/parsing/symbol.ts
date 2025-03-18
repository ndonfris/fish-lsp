import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { getRange } from '../utils/tree-sitter';
import { processSetCommand } from './set';
import { processReadCommand } from './read';
import { processFunctionDefinition } from './function';
import { processForDefinition } from './for';
import { processArgparseCommand } from './argparse';
import { Option } from './options';
import { processAliasCommand } from './alias';

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
}

type MinimumFishSymbolInput = {
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

  constructor({
    name,
    node,
    focusedNode,
    uri,
    detail,
    fishKind,
    scope,
    range,
    selectionRange,
    children,
  }: MinimumFishSymbolInput) {
    this.name = name || focusedNode.text;
    this.kind = fromFishSymbolKindToSymbolKind(fishKind);
    this.fishKind = fishKind;
    this.uri = uri;
    this.detail = detail;
    this.range = range || getRange(node);
    this.selectionRange = selectionRange || getRange(focusedNode);
    this.node = node;
    this.focusedNode = focusedNode;
    this.scope = scope;
    this.children = children;
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
      focusedNode: focusedNode,
      scope,
      children,
    });
  }

  static fromObject({
    name,
    node,
    focusedNode,
    range,
    selectionRange,
    uri,
    detail,
    fishKind,
    scope,
    children,
  }: MinimumFishSymbolInput) {
    const symbolName = name || focusedNode.text;
    const symbol = FishSymbol.create(symbolName, node, focusedNode, fishKind, uri, detail, scope, children);
    if (range) {
      symbol.range = range;
    }
    if (selectionRange) {
      symbol.selectionRange = selectionRange;
    }
    return symbol;
  }

  addChildren(...children: FishSymbol[]) {
    this.children.push(...children);
    return this;
  }

  addAliasedNames(...names: string[]) {
    this.aliasedNames.push(...names);
    return this;
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
      if (!firstNamedChild) break;

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

export function processNestedTree(document: LspDocument, ...nodes: SyntaxNode[]): FishSymbol[] {
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

  return symbols;
}
