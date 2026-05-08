export type IndexedSymbolId = string;

/**
 * Input shape for inserting an item into the multi-index cache.
 *
 * `TSymbol`
 *   The stored value type, e.g. `FishSymbol`.
 *
 * `TKey`
 *   The grouping key type used for lookup buckets, e.g.:
 *   - function name
 *   - inherited variable name
 *   - helper collision name
 */
export type IndexedSymbolInput<TSymbol, TKey extends string = string> = {
  /** Canonical stable id for the stored symbol/value */
  id: IndexedSymbolId;
  /** The object being cached */
  symbol: TSymbol;
  /** Owning document uri, used for efficient cache invalidation on re-analysis */
  uri: string;
  /** One or more grouping keys that should point at this symbol */
  keys: Iterable<TKey>;
};

/**
 * Generic multi-index cache for symbol-like objects.
 *
 * Stores each symbol once by id, while also maintaining:
 * - key -> symbol ids
 * - uri -> symbol ids
 * - id -> keys
 *
 * Generic parameters:
 * - `TSymbol`: the stored object type
 * - `TKey`: the lookup key type for semantic groupings
 *
 * This allows efficient:
 * - lookup by semantic grouping key
 * - removal of all cached items from a single document
 *
 * Common usage pattern:
 * - `id` is a stable cache id like `symbol.cacheId`
 * - `uri` is `symbol.uri`
 * - `keys` are whatever semantic buckets should reach that symbol
 *
 * Examples:
 * - global function cache:
 *   keys = `[symbol.name]`
 * - inherited variable cache:
 *   keys = `[varName]`
 * - helper collision cache:
 *   keys = `[symbol.name]`
 */
export class IndexedSymbolCache<TSymbol, TKey extends string = string> {
  /** Canonical storage: each cached symbol/value exists once by id */
  private readonly byId: Map<IndexedSymbolId, TSymbol>;
  /** Secondary index: semantic grouping key -> ids */
  private readonly idsByKey: Map<TKey, Set<IndexedSymbolId>>;
  /** Secondary index: document uri -> ids */
  private readonly idsByUri: Map<string, Set<IndexedSymbolId>>;
  /** Reverse lookup for efficient cleanup of key buckets during removal */
  private readonly keysById: Map<IndexedSymbolId, Set<TKey>>;
  /** Reverse lookup for efficient cleanup of uri buckets during removal */
  private readonly uriById: Map<IndexedSymbolId, string>;

  constructor() {
    this.byId = new Map();
    this.idsByKey = new Map();
    this.idsByUri = new Map();
    this.keysById = new Map();
    this.uriById = new Map();
  }

  add(input: IndexedSymbolInput<TSymbol, TKey>): void {
    const { id, symbol, uri } = input;
    const keys = new Set(input.keys);

    // Replace stale index entries if the same id is re-added with new metadata.
    if (this.byId.has(id)) {
      this.removeById(id);
    }

    this.byId.set(id, symbol);
    this.keysById.set(id, keys);
    this.uriById.set(id, uri);

    let uriBucket = this.idsByUri.get(uri);
    if (!uriBucket) {
      uriBucket = new Set();
      this.idsByUri.set(uri, uriBucket);
    }
    uriBucket.add(id);

    for (const key of keys) {
      let keyBucket = this.idsByKey.get(key);
      if (!keyBucket) {
        keyBucket = new Set();
        this.idsByKey.set(key, keyBucket);
      }
      keyBucket.add(id);
    }
  }

  has(id: IndexedSymbolId): boolean {
    return this.byId.has(id);
  }

  get(id: IndexedSymbolId): TSymbol | undefined {
    return this.byId.get(id);
  }

  find(key: TKey): TSymbol[] {
    const ids = this.idsByKey.get(key);
    if (!ids) return [];

    const results: TSymbol[] = [];
    for (const id of ids) {
      const symbol = this.byId.get(id);
      if (symbol) {
        results.push(symbol);
      }
    }
    return results;
  }

  findFirst(key: TKey): TSymbol | undefined {
    const ids = this.idsByKey.get(key);
    if (!ids) return undefined;

    for (const id of ids) {
      const symbol = this.byId.get(id);
      if (symbol) {
        return symbol;
      }
    }
    return undefined;
  }

  hasKey(key: TKey): boolean {
    return (this.idsByKey.get(key)?.size || 0) > 0;
  }

  findByUri(uri: string): TSymbol[] {
    const ids = this.idsByUri.get(uri);
    if (!ids) return [];

    const results: TSymbol[] = [];
    for (const id of ids) {
      const symbol = this.byId.get(id);
      if (symbol) {
        results.push(symbol);
      }
    }
    return results;
  }

  allSymbols(): TSymbol[] {
    return [...this.byId.values()];
  }

  allIds(): IndexedSymbolId[] {
    return [...this.byId.keys()];
  }

  allKeys(): TKey[] {
    return [...this.idsByKey.keys()];
  }

  removeByUri(uri: string): void {
    const ids = this.idsByUri.get(uri);
    if (!ids) return;

    // Copy first so removal can mutate the backing uri bucket safely.
    for (const id of [...ids]) {
      this.removeById(id);
    }
  }

  removeById(id: IndexedSymbolId): boolean {
    if (!this.byId.has(id)) return false;

    const keys = this.keysById.get(id) || new Set<TKey>();
    const uri = this.uriById.get(id);

    for (const key of keys) {
      const bucket = this.idsByKey.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) {
        this.idsByKey.delete(key);
      }
    }

    if (uri) {
      const uriBucket = this.idsByUri.get(uri);
      if (uriBucket) {
        uriBucket.delete(id);
        if (uriBucket.size === 0) {
          this.idsByUri.delete(uri);
        }
      }
    }

    this.keysById.delete(id);
    this.uriById.delete(id);
    this.byId.delete(id);
    return true;
  }

  clear(): void {
    this.byId.clear();
    this.idsByKey.clear();
    this.idsByUri.clear();
    this.keysById.clear();
    this.uriById.clear();
  }

  size(): number {
    return this.byId.size;
  }
}
