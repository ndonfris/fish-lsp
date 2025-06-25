import { DocumentSymbol, SymbolKind, Range, WorkspaceSymbol, Location, FoldingRange, FoldingRangeKind, MarkupContent, MarkupKind, Hover, DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { containsNode, equalRanges, getChildNodes, getRange, isSyntaxNode } from '../utils/tree-sitter';
import { findSetChildren, isSetVariableDefinitionName, processSetCommand } from './set';
import { processReadCommand } from './read';
import { findFunctionDefinitionChildren, FunctionEventOptions, processArgvDefinition, processFunctionDefinition } from './function';
import { processForDefinition } from './for';
import { convertNodeRangeWithPrecedingFlag, isCompletionArgparseFlagWithCommandName, processArgparseCommand } from './argparse';
import { Flag, isMatchingOption, isMatchingOptionOrOptionValue, LongFlag, Option, ShortFlag } from './options';
import { isAliasDefinitionValue, processAliasCommand } from './alias';
import { createDetail } from './symbol-detail';
import { config } from '../config';
import { flattenNested } from '../utils/flatten';
import { uriToPath } from '../utils/translation';
import { findParentCommand, findParentFunction, isCommand, isCommandWithName, isEndStdinCharacter, isFunctionDefinition, isFunctionDefinitionName, isOption, isString, isTopLevelDefinition, isVariable, isVariableDefinitionName } from '../utils/node-types';
import * as Locations from '../utils/locations';
import { SyncFileHelper } from '../utils/file-operations';
import { processExportCommand } from './export';
import { isAbbrDefinitionName, isMatchingAbbrFunction } from '../diagnostics/node-types';
import { extractCommands } from './nested-strings';
import { CompletionSymbol, isMatchingCompletionFlagNodeWithFishSymbol } from './complete';
import { isBindFunctionCall } from './bind';
import { analyzer } from '../analyze';
import { logger } from '../logger';

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

type OptionalFishSymbolPrototype = {
  name?: string;
  node: SyntaxNode;
  focusedNode: SyntaxNode;
  document: LspDocument;
  uri?: string;
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
  public document: LspDocument;

  constructor(obj: OptionalFishSymbolPrototype) {
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

  static fromObject(obj: OptionalFishSymbolPrototype) {
    return new this(obj);
  }

  static is(obj: unknown): obj is FishSymbol {
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

  public static argparseFlagFromName(name: string) {
    const flagName = name.replace(/^_flag_/, '').replace(/_/g, '-');
    return flagName;
  }

  public get argparseFlag(): Flag | string {
    if (this.fishKind !== 'ARGPARSE') return this.name;
    const flagName = this.argparseFlagName;
    if (flagName.length === 1) {
      return `-${flagName}` as ShortFlag;
    }
    return `--${flagName}` as LongFlag;
  }

  public get fishContainsOptCommand() {
    if (this.fishKind !== 'ARGPARSE') return { commandStr: '', isShort: false, isLong: false };
    const containsOpt: string[] = [];
    let isShort = false;
    let isLong = false;
    for (const name of this.aliasedNames) {
      const opt = FishSymbol.argparseFlagFromName(name);
      if (opt.length === 1) {
        containsOpt.push(`-s ${opt}`);
        if (opt === FishSymbol.argparseFlagFromName(this.name)) {
          isShort = true;
        }
      } else {
        containsOpt.push(`${opt}`);
        if (opt === FishSymbol.argparseFlagFromName(this.name)) {
          isLong = true;
        }
      }
    }
    return {
      commandStr: `__fish_contains_opt ${containsOpt.join(' ').trim()}`,
      isShort,
      isLong,
    };
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
    // if (this.fishKind === 'ARGPARSE' && other.fishKind === 'ARGPARSE') {
    //   const equalNames = this.name === other.name || this.aliasedNames.includes(other.name) || other.aliasedNames.includes(this.name);
    //   // const equalNames = this.aliasedNames.includes(other.name)
    //   // && other.aliasedNames.includes(this.name)
    //   return equalNames &&
    //     this.uri === other.uri &&
    //     this.focusedNode.equals(other.focusedNode);
    // }
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

  isBefore(other: FishSymbol | SyntaxNode) {
    if (FishSymbol.is(other)) {
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
    if (isSyntaxNode(other)) {
      if (this.selectionRange.start.line < other.startPosition.row) {
        return true;
      }
      if (this.selectionRange.start.line === other.startPosition.row) {
        return this.selectionRange.start.character < other.startPosition.column
          && this.selectionRange.end.character < other.endPosition.column;
      }
      return false;
    }
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

  containsScope(other: FishSymbol) {
    if (this.equalScopes(other)) return true;
    if (this.isVariable() && other.isVariable()) {
      if (this.isGlobal() && other.isGlobal()) return true;
      const isSameScope = this.scope.scopeNode.equals(other.scope.scopeNode);
      const containsScope = containsNode(this.scope.scopeNode, other.scope.scopeNode);
      if (isFunctionDefinition(this.scopeNode) && isFunctionDefinition(other.scopeNode)) {
        return isSameScope;
      }
      return isSameScope || containsScope;
    }
    if (this.scope.scopeNode.equals(other.scope.scopeNode) && this.kind === other.kind) {
      if (
        [this.scope.scopeTag, other.scope.scopeTag].includes('inherit')
        || this.isLocal() && other.isLocal() && this.kind === other.kind && this.isVariable() && other.isVariable()
      ) {
        if (isFunctionDefinition(this.scope.scopeNode) && isFunctionDefinition(other.scope.scopeNode)) {
          return this.scope.scopeNode.equals(other.scope.scopeNode);
        }
        return this.scope.scopeNode.equals(other.scope.scopeNode)
          || containsNode(this.scope.scopeNode, other.scope.scopeNode);
      } else if (this.isGlobal() && other.isGlobal()) {
        return true;
      } else if (this.isLocal() && other.isLocal()) {
        return true;
      }
      return this.scope.scopeTag === other.scope.scopeTag;
    }
    // if (this.isArgparse() && other.isVariable() && other.isLocal()) {
    //   // argparse symbols can be in the same scope as a variable, so we check if the scope nodes are equal
    //   return this.scope.scopeNode.equals(other.scope.scopeNode);
    // } else if (other.isArgparse() && this.isVariable() && this.isLocal()) {
    //   return other.scope.scopeNode.equals(other.scope.scopeNode);
    // }
    // if (this.isLocal() && other.isLocal() && this.isVariable() && other.isVariable()) {
    //   return this.scope.scopeNode.equals(other.scope.scopeNode);
    // }
    return false;
  }

  equalScopes(other: FishSymbol) {
    if (this.scope.scopeNode.equals(other.scope.scopeNode) && this.kind === other.kind) {
      if (
        [this.scope.scopeTag, other.scope.scopeTag].includes('inherit')
        || this.isLocal() && other.isLocal() && this.kind === other.kind && this.isVariable() && other.isVariable()
      ) {
        return true;
      } else if (this.isGlobal() && other.isGlobal()) {
        return true;
      } else if (this.isLocal() && other.isLocal()) {
        return true;
      }
      return this.scope.scopeTag === other.scope.scopeTag;
    }
    // if (this.isArgparse() && other.isVariable() && other.isLocal()) {
    //   // argparse symbols can be in the same scope as a variable, so we check if the scope nodes are equal
    //   return this.scope.scopeNode.equals(other.scope.scopeNode);
    // } else if (other.isArgparse() && this.isVariable() && this.isLocal()) {
    //   return other.scope.scopeNode.equals(other.scope.scopeNode);
    // }
    // if (this.isLocal() && other.isLocal() && this.isVariable() && other.isVariable()) {
    //   return this.scope.scopeNode.equals(other.scope.scopeNode);
    // }
    return false;
  }

  equalDefinition(other: FishSymbol) {
    return this.name === other.name
      && this.kind === other.kind
      && this.uri === other.uri
      && this.containsScope(other);
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
    return this.fishKind === 'VARIABLE' ||
      this.fishKind === 'FUNCTION_VARIABLE' ||
      this.fishKind === 'SET' ||
      this.fishKind === 'READ' ||
      this.fishKind === 'FOR' ||
      this.fishKind === 'ARGPARSE' ||
      this.fishKind === 'EXPORT';
  }

  isArgparse(): boolean {
    return this.fishKind === 'ARGPARSE';
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

  inScope(uri: DocumentUri, node: SyntaxNode) {
    // if the scope is local, we need to check if the node is in the same scope
    if (this.scope.tag >= DefinitionScope.ScopeTags.global) {
      return true;
    }
    if (this.isVariable()) {
      if (this.isArgparse()) {
        return true;
      }
      // if the symbol is local, we need to check if the node is in the same scope
      if (this.isLocal()) {
        return this.scopeContainsNode(node) && this.uri === uri;
      }
    }
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

  equalsNode(node: SyntaxNode, strict = false) {
    if (strict) return this.focusedNode.equals(node);
    return this.node.equals(node) || this.focusedNode.equals(node);
  }

  isReference(document: LspDocument, node: SyntaxNode, excludeEqualNode = false) {
    // Next 4 cases are ones we can always ignore
    if (excludeEqualNode && this.equalsNode(node)) return false;
    if (excludeEqualNode && document.uri === this.uri) {
      if (equalRanges(getRange(this.focusedNode), getRange(node))) {
        return false;
      }
    }
    // skip any references that are not in the same scope
    if (this.isLocal() && !this.isArgparse()) {
      if (!this.scopeContainsNode(node) || this.uri !== document.uri) return false;
    }
    // skip any reference that is not the same text as a function (command)
    if (this.isFunction() && this.name !== node.text && !isString(node)) {
      return false;
    }

    // Begin checking for specific symbol types
    const parentNode = node.parent
      ? findParentCommand(node)
      : null;

    // checks any `complete -c <ref> -n '<ref>; or not <ref>' -l <ref> -a '<ref>'`
    if (parentNode && isCommandWithName(parentNode, 'complete')) {
      return isMatchingCompletionFlagNodeWithFishSymbol(this, node);
    }

    // argparse checks
    if (this.isArgparse()) {
      const parentName = this.parent?.name
        || this.scopeNode.firstNamedChild?.text
        || this.scopeNode.text;

      // checks for `complete -c <cmd> -n '<cmd>; or not <cmd>' -l <flag>` blocks
      if (isCompletionArgparseFlagWithCommandName(node, parentName, this.argparseFlagName)) {
        return true;
      }

      // checks if a cmds `argparse flag` matches  `cmd --flag`
      if (
        isOption(node)
        && node.parent
        && isCommandWithName(node.parent, parentName)
        && isMatchingOptionOrOptionValue(node, Option.fromRaw(this.argparseFlag))
      ) return true;

      // check for nested `bind ... 'cmd --flag'` blocks

      // checks is `__fish_contains_opt -s <ref> <long-ref>`
      // if (
      //   parentNode
      //   && (isCommandWithName(parentNode, '__fish_contains_opt') || extractCommands(parentNode).some(cmd => cmd === '__fish_contains_opt'))
      //   && document.isAutoloadedCompletion()
      //   && !isOption(node)
      // ) {
      //   if (isString(parentNode) && isCompletionDefinitionWithName(parentNode, parentName, document)) {
      //     return
      //   }
      // }
      if (this.name === node.text && this.parent?.scopeContainsNode(node)) {
        return true;
      }

      const parentFunction = findParentFunction(node);
      // `_flag_<ref>` checks
      if (
        isVariable(node)
        || isVariableDefinitionName(node)
        || isSetVariableDefinitionName(node, false)) {
        return this.name === node.text && this.scopeContainsNode(node);
      }
      if (
        parentNode
        && isCommandWithName(parentNode, 'set', 'read', 'for', 'export', 'argparse')
      ) {
        return this.name === node.text && this.scopeContainsNode(node) && parentFunction?.equals(this.scopeNode);
      }

      return false;
    }

    // function checks
    if (this.isFunction()) {
      // skip any `cmd ... -blah -bhah -bhah`  blocks
      if (isCommand(node) && node.text === this.name) return true;
      // skip any functions defined with the same name, that are not the same node
      if (isFunctionDefinitionName(node) && this.isGlobal()) return this.equalsNode(node);
      // matches any `<cmd> -blah -blah -blah` blocks
      if (isCommandWithName(node, this.name)) return true;
      // matches any `type <cmd>` | `functions <cmd>`  blocks
      if (parentNode && isCommandWithName(parentNode, 'type', 'functions')) {
        const firstChild = parentNode.namedChildren.find(n => !isOption(n));
        if (!firstChild) return false;
        return firstChild?.text === this.name;
      }
      // matches any `function _ -w=<cmd>'` blocks
      const prevNode = node.previousNamedSibling;
      if (
        prevNode && isMatchingOption(prevNode, Option.create('-w', '--wraps'))
        ||
        node.parent
        && isFunctionDefinition(node.parent)
        && isMatchingOptionOrOptionValue(node, Option.create('-w', '--wraps'))

      ) return extractCommands(node).some(cmd => cmd === this.name);
      // matches any `abbr ... --function <cmd>` blocks
      if (parentNode && isCommandWithName(parentNode, 'abbr')) {
        if (prevNode && isMatchingAbbrFunction(node)) {
          return extractCommands(node).some(cmd => cmd === this.name);
        }
        const namedChild = getChildNodes(parentNode).find(n => isAbbrDefinitionName(n));
        if (
          namedChild
          && Locations.Range.isAfter(getRange(namedChild), this.selectionRange)
          && !isOption(node)
          && node.text === this.name
        ) {
          return true;
        }
      }
      // matches any `bind ... '<cmd>'` blocks
      if (parentNode && isCommandWithName(parentNode, 'bind')) {
        if (isOption(node)) return false;
        if (isBindFunctionCall(node)) {
          return extractCommands(node).some(cmd => cmd === this.name);
        }
        // matches any `bind ... '<cmd> --flag or <cmd>'` blocks
        if (isString(node) && extractCommands(node).some(cmd => cmd === this.name)) {
          return true;
        }
        const cmd = parentNode.childrenForFieldName('argument').slice(1)
          .filter(n => !isOption(n) && !isEndStdinCharacter(n))
          .find(n => n.equals(node) && n.text === this.name);
        // matches any `bind ... <cmd> or <cmd>` blocks
        if (cmd) return true;
      }

      if (parentNode && isCommandWithName(parentNode, 'alias')) {
        // matches any `complete -c <cmd> -n '<cmd>; or not <cmd>' -l <cmd>` blocks
        if (isAliasDefinitionValue(node)) {
          return extractCommands(node).some(cmd => cmd === this.name);
        }
      }

      if (parentNode && isCommandWithName(parentNode, 'export', 'set', 'read', 'for', 'argparse')) {
        if (isOption(node) || isVariableDefinitionName(node)) return false;
        if (isString(node)) {
          return extractCommands(node).some(cmd => cmd === this.name);
        }
        return this.name === node.text;
      }
      return this.name === node.text && this.scopeContainsNode(node);
    }

    // find any remaining variable references
    if (this.isVariable() && node.text === this.name) {
      logger.log({
        message: `Checking if variable ${this.name} is a reference`,
        node: {
          text: node.text,
          type: node.type,
          start: node.startPosition,
          end: node.endPosition,
        },
        parentNode: {
          text: node.parent?.text,
          type: node.parent?.type,
          start: node.parent?.startPosition,
          end: node.parent?.endPosition,
        },
      });
      if (isVariable(node) || isVariableDefinitionName(node)) return true;
      if (parentNode && isCommandWithName(parentNode, 'export', 'set', 'read', 'for', 'argparse')) {
        if (isOption(node)) return false;
        if (isVariableDefinitionName(node)) return this.name === node.text;
      }
      return this.name === node.text && this.scopeContainsNode(node);
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
