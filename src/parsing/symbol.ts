import { DocumentSymbol, SymbolKind, WorkspaceSymbol, Location, FoldingRange, MarkupContent, Hover, DocumentUri, Position } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { containsNode, getChildNodes, getParentNodes, getRange, nodesGen } from '../utils/tree-sitter';
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
import { FishString } from './string';
import { findParentFunction, getCommandNameText, isCommand, isCommandWithName, isEmptyString, isFunctionDefinitionName, isOption, isScope, isVariableDefinitionName } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';
import { isExportVariableDefinitionName, processExportCommand } from './export';
import { CompletionSymbol, isCompletionCommandDefinition, isCompletionSymbol } from './complete';
import { analyzer } from '../analyze';
import { isEmittedEventDefinitionName, isGenericFunctionEventHandlerDefinitionName, processEmitEventCommandName } from './emit';
import { isSymbolReference } from './reference-comparator';
import { equalSymbolDefinitions, equalSymbols, equalSymbolScopes, fishSymbolNameEqualsNodeText, isFishSymbol, symbolContainsNode, symbolContainsPosition, symbolContainsScope, symbolEqualsLocation, symbolEqualsNode, symbolScopeContainsNode } from './equality-utils';
import { SymbolConverters } from './symbol-converters';
import { FishKindGroups, FishSymbolInput, FishSymbolKind, fishSymbolKindToSymbolKind, fromFishSymbolKindToSymbolKind } from './symbol-kinds';
import { isInlineVariableAssignment, processInlineVariables } from './inline-variable';
import { processStringRegexCommand } from './string-regex';

export const SKIPPABLE_VARIABLE_REFERENCE_NAMES = [
  'argv',
  'fish_trace',
];

export interface FishSymbol extends DocumentSymbol {
  document: LspDocument;
  uri: string;
  fishKind: FishSymbolKind;
  node: SyntaxNode;
  focusedNode: SyntaxNode;
  scope: DefinitionScope;
  children: FishSymbol[];
  // `detail` is intentionally NOT declared here: the class provides it as a lazy
  // get/set accessor, and declaring it in this merged interface too would be a
  // duplicate (`detail?: string` is still inherited from DocumentSymbol).
  options: Option[];
  parent: FishSymbol | undefined;
}

export class FishSymbol {
  public children: FishSymbol[] = [];
  public aliasedNames: string[] = [];
  public document: LspDocument;
  public options: Option[] = [];
  private _lifetimeEndPosition: Position | null | undefined = undefined;
  /** lazily-built hover markdown (cache); see the `detail` accessor */
  private _detail: string | undefined = undefined;
  /** raw input detail; `createDetail` reads it back for EXPORT/fallback kinds */
  private _rawDetail: string = '';

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
    this.options = obj.options || [];
    // `detail` (hover markdown) is computed lazily — see the accessor below. It is
    // only read on request paths (hover, completion, signature, documentSymbol),
    // never during bulk background analysis, so eagerly building it here for every
    // symbol of every indexed file was wasted work. We keep the raw input because
    // `createDetail` reads `symbol.detail` back for EXPORT/fallback kinds.
    this._rawDetail = obj.detail;
  }

  /**
   * Hover markdown for this symbol, built on first access and cached. Depends only
   * on construction-time data (createDetail reads no post-construction mutable
   * fields), so deferring it yields an identical string.
   */
  get detail(): string {
    if (this._detail === undefined) {
      // Seed with the raw input first so `createDetail`'s own `symbol.detail`
      // reads (EXPORT / empty-kind / fallback) resolve without re-entering here.
      this._detail = this._rawDetail;
      this._detail = createDetail(this);
    }
    return this._detail;
  }

  set detail(value: string) {
    this._detail = value;
  }

  /** Force-recompute the cached `detail` (e.g. after the symbol is mutated). */
  setupDetail() {
    this._detail = this._rawDetail;
    this._detail = createDetail(this);
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
    options: Option[] = [],
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
      options,
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

  get id(): string {
    return [
      this.uri,
      this.selectionRange.start.line.toString(),
      this.selectionRange.start.character.toString(),
      this.fishKind,
      this.name,
    ].join(':');
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

  /**
   * The command whose `-e`/`--erase` form ends this symbol's lifetime, or null
   * if the symbol's category doesn't support an explicit erase boundary.
   *
   * - Global variables: bounded by `set -e <name>` in the same lexical scope.
   * - Local functions:  bounded by `functions -e <name>` in the same lexical
   *   scope, which lets a local shadow stop covering call sites once it's
   *   explicitly torn down (e.g. `function ls; ...; end; ls; functions -e ls;
   *   ls` — the second `ls` should resolve outward, not to the local shadow).
   *
   * Cross-document and other-shape symbols (aliases, argparse, exported vars,
   * etc.) don't get a lifetime guard; call order across files can't be
   * inferred statically.
   */
  private lifetimeEraseCommand(): 'set' | 'functions' | null {
    if (this.isVariable() && this.isGlobal()) return 'set';
    // Local `set`/`read` variables also have a tracked lifetime: they shadow
    // from their own definition until an in-scope `set -e`/`set -el` erases
    // them, after which references resolve back to an outer (global) variable
    // of the same name. Restricted to SET/READ — for-loop indices, argparse
    // flags, and function arg/inherit variables are not erasable this way and
    // keep their whole-scope lifetime.
    if (this.isLocal() && (this.fishKind === 'SET' || this.fishKind === 'READ')) return 'set';
    if (this.isFunction() && !this.isGlobal()) return 'functions';
    return null;
  }

  private resolveLifetimeEndPosition(): Position | undefined {
    if (typeof this._lifetimeEndPosition !== 'undefined') {
      return this._lifetimeEndPosition || undefined;
    }
    const eraseCommand = this.lifetimeEraseCommand();
    if (!eraseCommand) {
      this._lifetimeEndPosition = null;
      return undefined;
    }

    const eraseOption = Option.create('-e', '--erase');
    for (const node of nodesGen(this.scopeNode)) {
      if (!isCommandWithName(node, eraseCommand)) continue;
      if (node.startIndex <= this.node.startIndex) continue;

      // The erase must occur in the same nearest lexical scope as the definition.
      const nearestScope = getParentNodes(node).find(parent => isScope(parent));
      if (!nearestScope || !nearestScope.equals(this.scopeNode)) continue;

      const args = node.childrenForFieldName('argument');
      if (!args.some(arg => isMatchingOption(arg, eraseOption))) continue;

      const eraseTargets = args
        .filter(arg => !isOption(arg))
        .map(arg => {
          if (arg.type === 'concatenation' && arg.firstNamedChild) {
            return arg.firstNamedChild;
          }
          return arg;
        })
        .filter(Boolean);

      if (eraseTargets.some(target => target.text === this.name)) {
        // Scope-aware: an erase that names a scope only ends a variable of that
        // scope. `set -el foo` erases the local `foo`, leaving an outer global
        // `foo` alive; `set -eg foo` erases the global. An erase with no scope
        // modifier (`set -e foo`) ends whichever variable this symbol is.
        if (eraseCommand === 'set') {
          const eraseScopeOptions: [Option, ModifierScopeTag][] = [
            [Option.create('-l', '--local'), 'local'],
            [Option.create('-g', '--global'), 'global'],
            [Option.create('-f', '--function'), 'function'],
            [Option.create('-U', '--universal'), 'universal'],
          ];
          let eraseScope: ModifierScopeTag | null = null;
          for (const [opt, tag] of eraseScopeOptions) {
            if (args.some(arg => isMatchingOption(arg, opt))) {
              eraseScope = tag;
              break;
            }
          }
          if (eraseScope && eraseScope !== this.scope.scopeTag) continue;
        }
        this._lifetimeEndPosition = getRange(node).end;
        return this._lifetimeEndPosition;
      }
    }

    this._lifetimeEndPosition = null;
    return undefined;
  }

  /**
   * Symbol lifetime is constrained by its definition position and the first
   * matching erase command (`set -e* <name>` for global vars, `functions -e
   * <name>` for local functions) in the same lexical scope.
   *
   * Cross-document checks intentionally skip this guard because call-order across
   * documents cannot be inferred statically.
   */
  public isWithinDefinitionLifetime(position: Position, uri: DocumentUri = this.uri): boolean {
    if (uri !== this.uri) return true;
    const eraseCommand = this.lifetimeEraseCommand();
    if (!eraseCommand) return true;

    // Variables don't exist before their `set` command runs, so a pre-def
    // reference is invalid. Functions are effectively hoisted within a file
    // — `function bar; baz; end; function baz; end; bar` is valid fish, so
    // the call to `baz` from inside `bar` resolves correctly even though it
    // appears before `baz`'s definition line.
    if (eraseCommand === 'set') {
      const start = this.selectionRange.start;
      const startsBeforeDefinition =
        position.line < start.line ||
        position.line === start.line && position.character < start.character;
      if (startsBeforeDefinition) return false;
    }

    const end = this.resolveLifetimeEndPosition();
    if (!end) return true;

    const isAfterErase =
      position.line > end.line ||
      position.line === end.line && position.character > end.character;
    return !isAfterErase;
  }

  private nameEqualsNodeText(node: SyntaxNode) {
    return fishSymbolNameEqualsNodeText(this, node);
  }

  public isBefore(other: FishSymbol, urisMustMatch = true) {
    if (this.uri !== other.uri) return !urisMustMatch;
    return this.focusedNode.startIndex < other.focusedNode.startIndex;
  }

  public isAfter(other: FishSymbol, urisMustMatch = true) {
    if (this.uri !== other.uri) return !urisMustMatch;
    return this.focusedNode.startIndex > other.focusedNode.startIndex;
  }

  /**
   * If this symbol is a `set _flag_*` redefinition of an argparse-injected
   * variable in the same function scope (e.g. the `and set _flag_name "world"`
   * fallback after `argparse 'n/name=' -- $argv`), resolve to the underlying
   * ARGPARSE sibling. Otherwise returns `this`.
   *
   * In fish, `argparse` creates `_flag_*` variables and a subsequent
   * `set _flag_*` writes to that same variable — they are one logical
   * identifier. The symbol model treats the `set` as a separate SET symbol,
   * which breaks rename/refs from the redefinition site (it only sees its
   * own narrow lexical scope, missing the argparse def, the `--flag` call
   * sites, and other `_flag_*` reads).
   */
  public canonicalArgparseRedefinition(): FishSymbol {
    if (this.fishKind !== 'SET') return this;
    if (!this.name.startsWith('_flag_')) return this;
    const parentFn = this.parent;
    if (!parentFn || !parentFn.isFunction()) return this;
    const argparseSibling = parentFn.children.find(c =>
      c.fishKind === 'ARGPARSE' && c.name === this.name,
    );
    return argparseSibling ?? this;
  }

  /**
   * Checks if the symbol is a function definition with the `--no-scope-shadowing` option, which means that
   * the function does not create a new scope and can be shadowed by variables in the same scope. This is used
   * to determine if a function symbol should be considered a match for a variable reference in the same scope.
   */
  public isFunctionWithNoScopeShadowing() {
    if (!this.isFunction()) return false;
    if (this.options.some(option => option.isOption('-S', '--no-scope-shadowing'))) return true;
    return false;
  }

  /**
   * Checks if this symbol is a FUNCTION_VARIABLE created via `--inherit-variable`.
   * These variables are inherited from the caller's scope rather than being
   * new local definitions.
   */
  public isInheritVariable(): boolean {
    return this.fishKind === 'FUNCTION_VARIABLE'
      && this.options.some(option => option.isOption('-V', '--inherit-variable'));
  }

  /**
   * For function symbols, returns the list of variable names declared with
   * `--inherit-variable`. Returns empty array for non-function symbols or
   * functions without `--inherit-variable`.
   */
  public getInheritedVariableNames(): string[] {
    if (!this.isFunction()) return [];
    return this.children
      .filter((child: FishSymbol) => child.isInheritVariable())
      .map((child: FishSymbol) => child.name);
  }

  /**
   * For function symbols, checks if the function inherits a specific variable
   * name via `--inherit-variable`.
   */
  public hasInheritedVariable(varName: string): boolean {
    return this.getInheritedVariableNames().includes(varName);
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

  isExported(): boolean {
    if (this.fishKind === 'EVENT') return false;
    if (this.fishKind === 'FUNCTION_EVENT') return false;
    if (this.isFunction()) return false;
    if (this.fishKind === 'FUNCTION_VARIABLE') return false;
    if (!this.isVariable()) return false;
    if (this.isArgparse()) return false;
    if (this.fishKind === 'EXPORT') return true;
    const commandNode = this.node;
    if (isCommandWithName(commandNode, 'set')) {
      const children = findSetChildren(commandNode)
        .filter(s => s.startIndex < this.focusedNode.startIndex);
      return children.some(s => isMatchingOption(s, Option.create('-x', '--export')));
    }
    if (isCommandWithName(commandNode, 'read')) {
      const children = commandNode.children
        .filter(s => s.startIndex < this.focusedNode.startIndex);
      return children.some(s => isMatchingOption(s, Option.create('-x', '--export')));
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

  /**
   * Determines if the symbol requires local references to be found, which is used
   * to skip matching diagnostics `4004`|`unused symbol` for certain matches.
   *
   * Examples include:
   *   - Functions which are autoloaded based on their path and file name.
   *   - Variables which are autoloaded based on their path.
   *   - Variables which are exported or global do not need local references.
   *   - Variables like `argv` and `fish_trace` do not need local references.
   *   - Variables like `for i in (seq 1 10); ;end;` do not need local references (iterate 10 times)
   *
  * @return {boolean} True if the symbol needs local references, false otherwise
  */
  needsLocalReferences(): boolean {
    if (this.fishKind === 'ALIAS') return false;

    if (this.isFunction()) {
      // if function has a parent, it needs local references
      if (!this.isRootLevel()) return true;

      // if function is in a shebang script, and at root level, no local references needed
      if (this.document.hasShebang()) return false;

      // if function is autoloaded, global, and matches autoload name, no local references needed
      if (
        this.document.isAutoloaded() &&
        this.isGlobal() &&
        this.name === this.document.getAutoLoadName()
      ) return false;

      // otherwise, function needs local references
      return true;
    }
    if (this.isVariable()) {
      if (SKIPPABLE_VARIABLE_REFERENCE_NAMES.includes(this.name)) return false;
      if (this.isExported()) return false;
      if (this.isGlobal()) return false;
      if (this.fishKind === 'FOR') return false;
      return true;
    }
    return false;
  }

  skippableVariableName(): boolean {
    if (!this.isVariable()) return false;
    return SKIPPABLE_VARIABLE_REFERENCE_NAMES.includes(this.name);
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

  isAutoloaded() {
    const doc = this.document.getAutoLoadName();
    if (!doc) return false;
    return this.name === doc && this.document.isAutoloaded() && this.isRootLevel();
  }

  isRootLevel() {
    // return isTopLevelDefinition(this.node);
    if (this.parent) {
      return false;
    }
    return !this.parent;
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
      return SyncFileHelper.expandEnvVars(FishString.fromNode(node));
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
   * Checks if the symbol is the location.
   */
  equalsLocation(location: Location): boolean {
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
  equalsNode(node: SyntaxNode, opts: { strict?: boolean; } = { strict: false }): boolean {
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
    const inScope = symbolScopeContainsNode(this, node);
    if (!inScope) return false;

    // Only constrain lifetime for references in the same parsed document.
    // `isWithinDefinitionLifetime` is a no-op for symbol categories without a
    // tracked erase boundary (everything except global vars and local funcs),
    // so this single call covers both lifetime-aware shapes.
    if (node.tree === this.node.tree) {
      return this.referenceWithinLifetime(node);
    }
    return inScope;
  }

  /**
   * Node-aware lifetime check used for reference resolution.
   *
   * Wraps {@link isWithinDefinitionLifetime} (which is position-only) to add
   * one exemption: the textual "before definition" exclusion is skipped when
   * `node` lives inside a function nested *within this symbol's scope* and
   * deeper than this symbol's own enclosing function. Such functions run when
   * called — after the `set`/`read` line — and may `--inherit-variable` this
   * name, so a reference there is valid even if it appears earlier in the file
   * (e.g. an `inner_fn` defined above a `set -l VAR`). Same-scope references
   * (the common shadow/erase case, e.g. `echo $foo | read -l foo`) keep the
   * strict before-definition rule.
   */
  public referenceWithinLifetime(node: SyntaxNode): boolean {
    if (this.isWithinDefinitionLifetime(getRange(node).start, this.uri)) return true;
    // The nested-function exemption only applies to LOCAL variable lifetimes
    // (`set -l`/`read -l`), where an earlier-defined nested function may
    // `--inherit-variable` this name. Functions (hoisted, with their own
    // `functions -e` lifetime) and globals keep the strict positional rule —
    // restoring their original `isWithinDefinitionLifetime` behavior exactly.
    if (!this.isVariable() || !this.isLocal()) return false;
    const nodeFn = findParentFunction(node);
    if (!nodeFn) return false;
    const ownerFn = findParentFunction(this.focusedNode);
    if (ownerFn && nodeFn.equals(ownerFn)) return false;
    return this.scope.containsNode(nodeFn);
  }

  /**
   * Finds all self-referencing variable expansion nodes within this symbol's
   * definition command. In fish, `set -lx PATH $PATH:/opt/bin` evaluates the RHS
   * `$PATH` before creating the local variable, so it reads the pre-existing (global)
   * value. Such expansions should not be treated as local references.
   *
   * @returns An array of self-referencing SyntaxNodes, or null if none exist
   */
  isSelfReferencingVariable(): SyntaxNode[] | null {
    if (!this.isVariable() || this.fishKind !== 'SET') return null;
    const results: SyntaxNode[] = [];
    for (const node of nodesGen(this.node)) {
      if (this.focusedNode.endIndex > node.startIndex || this.focusedNode.startIndex === node.startIndex) continue;
      if (node.text === this.name) {
        results.push(node);
      }
    }
    return results.length > 0 ? results : null;
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

export type ModifierScopeTag = 'universal' | 'global' | 'function' | 'local' | 'inherit';

export const SetModifierToScopeTag = (modifier: Option): ModifierScopeTag => {
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

export function filterFirstPerScopeSymbol(document: LspDocument | DocumentUri): FishSymbol[] {
  const uri: DocumentUri = LspDocument.is(document) ? document.uri : document;
  const symbols = analyzer.getFlatDocumentSymbols(uri);
  const flatArray: FishSymbol[] = Array.from(symbols);

  const array: FishSymbol[] = [];
  for (const symbol of symbols) {
    const firstSymbol = flatArray.find((s: FishSymbol) => s.equalDefinition(symbol));
    if (firstSymbol && firstSymbol.equals(symbol)) {
      array.push(symbol);
    }
  }
  return array;
}

export function filterFirstUniqueSymbolperScope(document: LspDocument | DocumentUri): FishSymbol[] {
  const uri: DocumentUri = LspDocument.is(document) ? document.uri : document;
  const symbols = analyzer.getFlatDocumentSymbols(uri);
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

function buildNested(document: LspDocument, node: SyntaxNode, children: FishSymbol[]): FishSymbol[] {
  const newSymbols: FishSymbol[] = [];

  switch (node.type) {
    case 'function_definition':
      newSymbols.push(...processFunctionDefinition(document, node, children));
      break;
    case 'for_statement':
      newSymbols.push(...processForDefinition(document, node, children));
      break;
    case 'command':
      if (isInlineVariableAssignment(node)) {
        // Inline variable assignments are handled elsewhere
        newSymbols.push(...processInlineVariables(document, node));
        break;
      }
      // Use the `name` field selector so commands prefixed with
      // `override_variable` (post tree-sitter-fish PR #41) still dispatch
      // correctly to the right symbol processor.
      switch (getCommandNameText(node)) {
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
        case 'string':
          newSymbols.push(...processStringRegexCommand(document, node, children));
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

  /**
   * add argv to script files. Hoisted out of the recursion: the `program` node
   * only ever appears at the top level, so the old per-node `nodes.find(... 'program')`
   * scanned the whole tree for nothing on every recursive call.
   */
  if (!document.isAutoloadedUri()) {
    const programNode = nodes.find(node => node.type === 'program');
    if (programNode) symbols.push(...processArgvDefinition(document, programNode));
  }

  processNodes(document, nodes, symbols);
  return symbols;
}

/**
 * Array-based recursive core of {@link processNestedTree}. Kept separate from the
 * varargs public entry so the hot recursion never spreads `...node.children` /
 * `...childSymbols` into fresh arrays at every node (a measurable allocation cost
 * across the whole AST during background analysis). Appends into `out`.
 */
function processNodes(document: LspDocument, nodes: SyntaxNode[], out: FishSymbol[]): void {
  for (const node of nodes) {
    // Process children first (bottom-up approach)
    const childSymbols: FishSymbol[] = [];
    processNodes(document, node.children, childSymbols);

    // Process the current node and integrate children
    const newSymbols = buildNested(document, node, childSymbols);

    if (newSymbols.length > 0) {
      // If we created symbols for this node, add them (they should contain children)
      for (const s of newSymbols) out.push(s);
    } else if (childSymbols.length > 0) {
      // If no new symbols from this node but we have child symbols, bubble them up
      for (const s of childSymbols) out.push(s);
    }
    // If neither condition is met, we add nothing
  }
}
