import { FishSymbol } from './symbol';
import { IndexedSymbolCache } from './indexed-symbol-cache';
import { Workspace } from '../utils/workspace';

export class FishSymbolNameCache {
  protected readonly cache = new IndexedSymbolCache<FishSymbol>();

  add(symbol: FishSymbol): void {
    this.cache.add({
      id: symbol.id,
      symbol,
      uri: symbol.uri,
      keys: [symbol.name],
    });
  }

  removeSymbolsByUri(uri: string): void {
    this.cache.removeByUri(uri);
  }

  find(name: string): FishSymbol[] {
    return this.cache.find(name);
  }

  findByUri(uri: string): FishSymbol[] {
    return this.cache.findByUri(uri);
  }

  findFirst(name: string): FishSymbol | undefined {
    return this.cache.findFirst(name);
  }

  has(name: string): boolean {
    return this.cache.hasKey(name);
  }

  get allSymbols(): FishSymbol[] {
    return this.cache.allSymbols();
  }

  get allNames(): string[] {
    return this.cache.allKeys();
  }
}

export class InheritVariableCache {
  private readonly cache = new IndexedSymbolCache<FishSymbol>();

  add(varName: string, funcSymbol: FishSymbol): void {
    this.cache.add({
      id: funcSymbol.id,
      symbol: funcSymbol,
      uri: funcSymbol.uri,
      keys: [varName],
    });
  }

  removeSymbolsByUri(uri: string): void {
    this.cache.removeByUri(uri);
  }

  has(varName: string): boolean {
    return this.cache.hasKey(varName);
  }

  find(varName: string): FishSymbol[] {
    return this.cache.find(varName);
  }
}

export type FishSymbolSubsetName =
  | 'allSymbolsByName'
  | 'globalOrRootSymbols'
  | 'functionsByName'
  | 'variablesByName'
  | 'eventsByName'
  | 'globalSymbols'
  | 'noScopeShadowing'
  | 'inheritedVariables'
  | 'autoloadedHelperFunctions';

export type FishSymbolSubsetMatch = {
  name: FishSymbolSubsetName;
  keys: string[];
};

/**
 * Groups the analyzer's semantic FishSymbol indexes behind a single owner so
 * document re-indexing and invalidation stay in one place.
 *
 * Future expansion points:
 * - broader symbol-kind subsets like `functions`, `variables`, and `events`
 * - local/document indexes for repeated same-document lookups
 * - generic iteration over subset memberships via `getSubsetsOfSymbol()`
 */
export class FishSymbolCaches {
  /** All indexed symbols keyed by `symbol.name`, regardless of scope or kind. */
  public readonly allSymbolsByName = new FishSymbolNameCache();
  /** Symbols that are root-level or global within their defining document. */
  public readonly globalOrRootSymbols = new FishSymbolNameCache();
  /** All function symbols keyed by function name. */
  public readonly functionsByName = new FishSymbolNameCache();
  /** All variable symbols keyed by variable name. */
  public readonly variablesByName = new FishSymbolNameCache();
  /** All event hook / emitted event symbols keyed by event name. */
  public readonly eventsByName = new FishSymbolNameCache();
  /** Workspace-visible globally scoped symbols keyed by name. */
  public readonly globalSymbols = new FishSymbolNameCache();
  /** Functions declared with `--no-scope-shadowing`, keyed by function name. */
  public readonly noScopeShadowing = new FishSymbolNameCache();
  /** Functions keyed by each variable name inherited via `--inherit-variable`. */
  public readonly inheritedVariables = new InheritVariableCache();
  /** Top-level helper functions in autoloaded files whose name does not match the filename. */
  public readonly autoloadedHelperFunctions = new FishSymbolNameCache();

  private readonly uriIndexedCaches = [
    this.allSymbolsByName,
    this.globalOrRootSymbols,
    this.functionsByName,
    this.variablesByName,
    this.eventsByName,
    this.globalSymbols,
    this.noScopeShadowing,
    this.inheritedVariables,
    this.autoloadedHelperFunctions,
  ] as const;

  private readonly subsetAdders: Record<FishSymbolSubsetName, (symbol: FishSymbol, keys: string[]) => void> = {
    allSymbolsByName: (symbol) => this.allSymbolsByName.add(symbol),
    globalOrRootSymbols: (symbol) => this.globalOrRootSymbols.add(symbol),
    functionsByName: (symbol) => this.functionsByName.add(symbol),
    variablesByName: (symbol) => this.variablesByName.add(symbol),
    eventsByName: (symbol) => this.eventsByName.add(symbol),
    globalSymbols: (symbol) => this.globalSymbols.add(symbol),
    noScopeShadowing: (symbol) => this.noScopeShadowing.add(symbol),
    autoloadedHelperFunctions: (symbol) => this.autoloadedHelperFunctions.add(symbol),
    inheritedVariables: (symbol, keys) => {
      for (const key of keys) {
        this.inheritedVariables.add(key, symbol);
      }
    },
  };

  removeByUri(uri: string): void {
    for (const cache of this.uriIndexedCaches) {
      cache.removeSymbolsByUri(uri);
    }
  }

  /**
   * Returns the semantic subset memberships for a symbol.
   *
   * This keeps the indexing rules data-driven so future subset additions can be
   * implemented by extending one method instead of spreading `if` chains across
   * analyzer update paths.
   */
  getSubsetsOfSymbol(symbol: FishSymbol): FishSymbolSubsetMatch[] {
    const subsets: FishSymbolSubsetMatch[] = [
      { name: 'allSymbolsByName', keys: [symbol.name] },
    ];

    if (symbol.isGlobal() || symbol.isRootLevel()) {
      subsets.push({ name: 'globalOrRootSymbols', keys: [symbol.name] });
    }

    if (symbol.isFunction()) {
      subsets.push({ name: 'functionsByName', keys: [symbol.name] });
    }

    if (symbol.isVariable()) {
      subsets.push({ name: 'variablesByName', keys: [symbol.name] });
    }

    if (symbol.isEvent()) {
      subsets.push({ name: 'eventsByName', keys: [symbol.name] });
    }

    if (symbol.isGlobal()) {
      subsets.push({ name: 'globalSymbols', keys: [symbol.name] });
    }

    if (symbol.isFunctionWithNoScopeShadowing()) {
      subsets.push({ name: 'noScopeShadowing', keys: [symbol.name] });
    }

    if (this.isAutoloadedHelperFunction(symbol)) {
      subsets.push({ name: 'autoloadedHelperFunctions', keys: [symbol.name] });
    }

    const inheritedVariableNames = symbol.getInheritedVariableNames();
    if (inheritedVariableNames.length > 0) {
      subsets.push({ name: 'inheritedVariables', keys: inheritedVariableNames });
    }

    return subsets;
  }

  addSymbol(symbol: FishSymbol): void {
    const subsets = this.getSubsetsOfSymbol(symbol);

    for (const subset of subsets) {
      this.subsetAdders[subset.name](symbol, subset.keys);
    }
  }

  indexSymbols(symbols: Iterable<FishSymbol>): void {
    for (const symbol of symbols) {
      this.addSymbol(symbol);
    }
  }

  /**
   * Adds only global/root-level symbols into the `globalSymbols` subset.
   *
   * This is intentionally narrower than `indexSymbols()`. It supports the
   * server/workspace heuristic that opportunistically promotes sourced or
   * root-level symbols into the workspace-visible global lookup cache during
   * document/workspace flows, without re-indexing every other subset.
   *
   * In other words:
   * - `indexSymbols()` = full semantic subset indexing for analyzed documents
   * - `indexGlobalOrRootSymbols()` = targeted promotion into `globalSymbols`
   */
  indexGlobalOrRootSymbols(symbols: Iterable<FishSymbol>): void {
    for (const symbol of symbols) {
      if (symbol.isGlobal() || symbol.isRootLevel()) {
        this.globalSymbols.add(symbol);
      }
    }
  }

  /**
   * Returns globally scoped symbols filtered to the provided workspace.
   *
   * Passing `undefined` returns the full global subset without workspace filtering.
   */
  allWorkspaceGlobalSymbols(workspace?: Workspace): FishSymbol[] {
    return this.globalSymbols.allSymbols
      .filter(symbol => !workspace || workspace.contains(symbol.uri) || symbol.uri === workspace.uri);
  }

  /** Returns root-level/global symbols already indexed for a specific document. */
  allDocumentGlobalOrRootSymbols(uri: string): FishSymbol[] {
    return this.globalOrRootSymbols.findByUri(uri);
  }

  /**
   * Returns globally scoped symbols with a matching name, filtered to the
   * provided workspace boundary.
   */
  findWorkspaceGlobalSymbols(name: string, workspace?: Workspace): FishSymbol[] {
    return this.globalSymbols.find(name)
      .filter(symbol => !workspace || workspace.contains(symbol.uri) || symbol.uri === workspace.uri);
  }

  /** Returns globally scoped symbols with a matching name under indexed workspace paths. */
  findIndexedPathGlobalSymbols(name: string, indexedPaths: string[]): FishSymbol[] {
    return this.globalSymbols.find(name)
      .filter(symbol => indexedPaths.some((workspacePath) =>
        symbol.path === workspacePath || symbol.path.startsWith(`${workspacePath}/`),
      ));
  }

  /** Returns variable symbols with a matching name in a specific document. */
  findDocumentVariables(uri: string, name: string): FishSymbol[] {
    return this.variablesByName.find(name)
      .filter(symbol => symbol.uri === uri);
  }

  /** Returns any indexed symbols with a matching name in a specific document. */
  findDocumentNamedSymbols(uri: string, name: string): FishSymbol[] {
    return this.allSymbolsByName.find(name)
      .filter(symbol => symbol.uri === uri);
  }

  /** Returns function symbols with a matching name in a specific document. */
  findDocumentFunctions(uri: string, name: string): FishSymbol[] {
    return this.functionsByName.find(name)
      .filter(symbol => symbol.uri === uri);
  }

  /** Returns all function symbols already indexed for a specific document. */
  allDocumentFunctions(uri: string): FishSymbol[] {
    return this.functionsByName.findByUri(uri);
  }

  /** Returns every indexed function symbol across all analyzed documents. */
  allFunctionSymbols(): FishSymbol[] {
    return this.functionsByName.allSymbols;
  }

  /** Replaces all cached subset entries for a document with the provided symbols. */
  refreshDocument(uri: string, symbols: Iterable<FishSymbol>): void {
    this.removeByUri(uri);
    this.indexSymbols(symbols);
  }

  /** True when a function should participate in helper-collision indexing. */
  isAutoloadedHelperFunction(symbol: FishSymbol): boolean {
    return symbol.isFunction()
      && symbol.isRootLevel()
      && symbol.document.isAutoloadedFunction()
      && !symbol.isAutoloaded();
  }
}
