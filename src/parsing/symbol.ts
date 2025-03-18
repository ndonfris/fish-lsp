import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, Location, FoldingRange } from 'vscode-languageserver';
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
import { createDetail } from './symbol-detail';
// import { isCommand, isCommandWithName } from '../utils/node-types';

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

  createDetail() {
    switch (this.fishKind) {
      case 'ARGPARSE':

      case 'FUNCTION':

      case 'ALIAS':

      // case 'COMPLETE':
      //   return 'COMPLETE';
      case 'SET':
        return 'SET';
      case 'READ':
        return 'READ';
      case 'FOR':
        return 'FOR';
      case 'VARIABLE':
        return 'VARIABLE';
    }
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

  equal(other: FishSymbol) {
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
      this.range,
    );
  }

  toLspDocumentSymbol(): Location {
    return Location.create(
      this.uri,
      this.range,
    );
  }

  isBefore(other: FishSymbol) {
    return this.range.start.line < other.range.start.line;
  }

  isAfter(other: FishSymbol) {
    return this.range.start.line > other.range.start.line;
  }

  toFoldingRange(): FoldingRange {
    return {
      startLine: this.range.start.line,
      endLine: this.range.end.line,
      collapsedText: this.name,
    };
  }

  isLocal() {
    return !this.isGlobal();
  }

  isGlobal() {
    return this.scope.scopeTag === 'global' || this.scope.scopeTag === 'universal';
  }
}

// TODO: to refactor `../utils/node-types.ts` functions related to `isVariableDefinitionName`
// export function isVariableDefinitionName(node: SyntaxNode) {
//   const parent = node.parent;
//   if (parent && isCommand(parent)) {
//     if (isCommandWithName(parent, 'set')) {
//       return parent.firstNamedChild?.equals(node);
//     }
//     if (isCommandWithName(parent, 'read')) {
//       return parent.firstNamedChild?.equals(node)
//     }
//     if (isCommandWithName(parent, 'argparse')) {
//       return parent.firstNamedChild?.equals(node)
//     }
//
//
//   } else if (parent && parent.type === 'for_statement') {
//     return parent.firstNamedChild?.equals(node);
//   } else {
//     return false;
//   }
// }

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
      switch (firstNamedChild?.text) {
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
