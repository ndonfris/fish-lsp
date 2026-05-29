import { SymbolKind, MarkupContent } from 'vscode-languageserver';
import { execCmd, execCommandDocs, execEscapedCommand } from './exec';
import { isBuiltin } from './builtins';
import { md } from './markdown-builder';
import { convertTitleOperatorToToken } from './completion/documentation';
import { runSetupItems, SetupResult } from './completion/startup-config';
import { FishCompletionItemKind } from './completion/types';

/****************************************************************************************
 *                                                                                      *
 * @TODO: DO NOT convert this to a FishDocumentSymbol! Instead, use this to cache to    *
 * FishDocumentSymbol documentation strings cached. FishDocumentSymbol will lookup      *
 * base documentation from this cache. Converting this to a FishDocumentSymbol will     *
 * cause issues with the lsp api because, documentSymbols require a range/location      *
 *        (Maybe check BaseSymbol, I vaguely remember that one of the Symbol's          *
 *         mentions not requiring a Range, having multiple symbols is still             *
 *         not a capability the protocol supports, as per the v.0.7.0)                  *
 * With that in mind, build out a structure inside analyzer, that will be able to use   *
 * everything that is necessary for a well-informed detail to the client.               *
 * Current goal likely needs:                                                           *
 *       • parser                                                                       *
 *       • FishDocumentSymbol                                                           *
 *       • This DocumentationCache                                                      *
 *       • some kind of flag resolver (the function flags '--description',              *
 *         '--argument-names', '--inherit-variables', come to mind)                     *
 *                                                                                      *
 *                                                                                      *
 * @TODO: support docs & formatted docs. (non-markdown version will be docs)            *
 *                                                                                      *
 * @TODO: Refactor building documentation string! Potentially remove documentation.ts   *
 *                                                                                      *
 ****************************************************************************************/

export interface CachedGlobalItem {
  docs?: string;
  formattedDocs?: MarkupContent;
  uri?: string;
  referenceUris: Set<string>;
  type: SymbolKind;
  resolved: boolean;
}

export function createCachedItem(type: SymbolKind, uri?: string): CachedGlobalItem {
  return {
    type: type,
    resolved: false,
    uri: uri,
    referenceUris: uri ? new Set([...uri]) : new Set<string>(),
  } as CachedGlobalItem;
}

/**
 * Currently spoofs docs as FormattedDocs, likely to change in future versions.
 */
async function getNewDocString(name: string, item: CachedGlobalItem): Promise<string | undefined> {
  switch (item.type) {
    case SymbolKind.Variable:
      return await getVariableDocString(name);
    case SymbolKind.Function:
      return await getFunctionDocString(name);
    case SymbolKind.Class:
      return await getBuiltinDocString(name);
    default:
      return undefined;
  }
}

export async function resolveItem(name: string, item: CachedGlobalItem, uri?: string) {
  if (uri !== undefined) {
    item.referenceUris.add(uri);
  }
  if (item.resolved) {
    return item;
  }
  if (item.type === SymbolKind.Function) {
    item.uri = await getFunctionUri(name);
  }
  const newDocStr: string | undefined = await getNewDocString(name, item);
  item.resolved = true;
  if (!newDocStr) {
    return item;
  }
  item.docs = newDocStr;
  return item;
}

/**
 * just a getter for the absolute path to a function defined
 */
async function getFunctionUri(name: string): Promise<string | undefined> {
  const uriString = await execEscapedCommand(`type -ap ${name}`);
  const uri = uriString.join('\n').trim();
  if (!uri) {
    return undefined;
  }
  return uri;
}

/**
 * builds FunctionDocumentation string
 */
export async function getFunctionDocString(name: string): Promise<string | undefined> {
  const functionDoc = await execCmd(`functions ${name}`);
  if (!functionDoc) return;
  return [
    `${md.italic('(function)')} - ${md.inlineCode(name)}`,
    md.separator(),
    md.codeBlock('fish', functionDoc.join('\n')),
  ].join('\n');
}

/**
 * builds MarkupString for builtin documentation
 */
export async function getBuiltinDocString(name: string): Promise<string | undefined> {
  if (!isBuiltin(name)) return undefined;

  const fixedName = convertTitleOperatorToToken(name);

  const cmdDocs: string = await execCommandDocs(fixedName);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  const resultDocs =
    splitDocs.slice(startIndex).length > 3
      ? splitDocs.slice(startIndex).join('\n')
      : splitDocs.join('\n');
  return [
    `${md.bold(name.toUpperCase())} - ${md.italic(`https://fishshell.com/docs/current/cmds/${fixedName.trim()}.html`)}`,
    md.separator(),
    md.codeBlock('man', resultDocs),
  ].join('\n');
}

/**
 * builds MarkupString for global variable documentation
 */
export async function getVariableDocString(name: string): Promise<string | undefined> {
  const vName = name.startsWith('$') ? name.slice(name.lastIndexOf('$')) : name;
  const out = await execCmd(`set --show --long ${vName}`);
  const { first, middle, last } = out.reduce((acc, curr, idx, arr) => {
    if (idx === 0) {
      acc.first = curr;
    } else if (idx === arr.length - 1) {
      acc.last = curr;
    } else {
      acc.middle.push(curr);
    }
    return acc;
  }, { first: '', middle: [] as string[], last: '' });
  return first ? [
    `(variable) ${md.inlineCode(name)}`,
    md.separator(),
    md.codeBlock('text', first),
    md.separator(),
    middle.join('\n'),
    md.separator(),
    last,
  ].join('\n') : undefined;
}

export async function getCommandDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = await execCommandDocs(name);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return md.codeBlock('man', splitDocs.slice(startIndex).join('\n'));
}

export function initializeMap(collection: string[], type: SymbolKind, _uri?: string): Map<string, CachedGlobalItem> {
  const items: Map<string, CachedGlobalItem> = new Map<string, CachedGlobalItem>();
  collection.forEach((item) => {
    items.set(item, createCachedItem(type));
  });
  return items;
}

export const extraBuiltins: string[] = [
  'export',
];

/**
 * Uses internal fish shell commands to store brief output for global variables, functions,
 * builtins, and unknown identifiers. This class is meant to be initialized once, on server
 * startup. It is then used as fallback documentation provider, if our analysis can't
 * resolve any documentation for a given identifier.
 */
export class DocumentationCache {
  private _variables: Map<string, CachedGlobalItem> = new Map();
  private _functions: Map<string, CachedGlobalItem> = new Map();
  private _builtins: Map<string, CachedGlobalItem> = new Map();
  private _unknowns: Map<string, CachedGlobalItem> = new Map();

  get items(): string[] {
    return [
      ...this._variables.keys(),
      ...this._functions.keys(),
      ...this._builtins.keys(),
      ...this._unknowns.keys(),
    ];
  }

  async parse(setupResults?: SetupResult[], uri?: string) {
    this._unknowns = initializeMap([], SymbolKind.Null, uri);

    // Reuse the single `runSetupItems()` fish spawn shared with CompletionItemMap
    // (passed in from FishServer.create) instead of spawning fish three more times.
    // `builtin --names` / `functions --all --names` / `set --names` produce the same
    // lists the old `builtin -n` / `functions -an` / `set -n` did, and `runSetupItems`
    // returns them raw (pre-dedup), which is exactly what this cache wants.
    const results = setupResults ?? await runSetupItems();
    const byKind = (kind: FishCompletionItemKind): string[] =>
      results.find((r) => r.fishKind === kind)?.results ?? [];

    this._variables = initializeMap(byKind(FishCompletionItemKind.VARIABLE), SymbolKind.Variable, uri);
    this._functions = initializeMap(byKind(FishCompletionItemKind.FUNCTION), SymbolKind.Function, uri);
    this._builtins = initializeMap(byKind(FishCompletionItemKind.BUILTIN), SymbolKind.Class, uri);

    // add the extra builtins
    extraBuiltins.forEach((builtin) => {
      this._builtins.set(builtin, createCachedItem(SymbolKind.Class));
    });
    return this;
  }

  find(name: string, type?: SymbolKind): CachedGlobalItem | undefined {
    if (type === SymbolKind.Variable) {
      return this._variables.get(name);
    }
    if (type === SymbolKind.Function) {
      return this._functions.get(name);
    }
    if (type === SymbolKind.Class) {
      return this._builtins.get(name);
    }
    return this._unknowns.get(name);
  }

  findType(name: string): SymbolKind {
    if (this._variables.has(name)) {
      return SymbolKind.Variable;
    }
    if (this._functions.has(name)) {
      return SymbolKind.Function;
    }
    if (this._builtins.has(name)) {
      return SymbolKind.Class;
    }
    return SymbolKind.Null;
  }

  /**
   * @async
   * Resolves a symbol's documentation. Store's resolved items in the Cache, otherwise
   * returns the already cached item.
   */
  async resolve(name: string, uri?: string, type?: SymbolKind) {
    const itemType = type || this.findType(name);
    let item: CachedGlobalItem | undefined = this.find(name, itemType);
    if (!item) {
      item = createCachedItem(itemType, uri);
      this._unknowns.set(name, item);
    }
    if (item.resolved && item.docs) {
      return item;
    }
    if (!item.resolved) {
      item = await resolveItem(name, item);
    }
    if (!item.docs) {
      this._unknowns.set(name, item);
    }
    this.setItem(name, item);
    return item;
  }

  /**
     * sets an item, mostly called within this class, because CachedGlobalItem will typically
     * already be resolved.
     *
     * @param {string} name - string for the symbol
     * @param {CachedGlobalItem} item - the item to set
     */
  setItem(name: string, item: CachedGlobalItem) {
    switch (item.type) {
      case SymbolKind.Variable:
        this._variables.set(name, item);
        break;
      case SymbolKind.Function:
        this._functions.set(name, item);
        break;
      case SymbolKind.Class:
        this._builtins.set(name, item);
        break;
      default:
        this._unknowns.set(name, item);
        break;
    }
  }

  /**
    * getter for a cached item, guarding SymbolKind.Null from retrieved.
    */
  getItem(name: string) {
    const item = this.find(name);
    if (!item || item.type === SymbolKind.Null) {
      return undefined;
    }
    return item;
  }
}

/**
 * Function to be called when the server is initialized, so that the DocumentationCache
 * can be populated.
 */
export async function initializeDocumentationCache(setupResults?: SetupResult[]) {
  const cache = new DocumentationCache();
  await cache.parse(setupResults);
  return cache;
}
