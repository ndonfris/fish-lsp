import { MarkupKind, SymbolKind, MarkupContent, DocumentSymbol } from 'vscode-languageserver';
import Parser from 'web-tree-sitter';
import { documentationHoverProviderForBuiltIns } from '../documentation';
import { execCmd, execCommandDocs, execEscapedCommand } from './exec';
import { uriToPath } from './translation';
//import { FishCompletionItem } from './completion-strategy';
import { FishCompletionItem, CompletionExample } from './completion/types';
//import { CompletionExample } from './static-completions';

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
 * and replace it with a lot of the methods seen here.                                  *
 *                                                                                      *
 ****************************************************************************************/

export interface CachedGlobalItem {
  docs?: string;
  formattedDocs?: MarkupContent;
  uri?: string;
  refrenceUris: Set<string>;
  type: SymbolKind;
  resolved: boolean;
}

export function createCachedItem(type: SymbolKind, uri?: string): CachedGlobalItem {
  return {
    type: type,
    resolved: false,
    uri: uri,
    refrenceUris: uri ? new Set([...uri]) : new Set<string>(),
  } as CachedGlobalItem;
}

/**
 * Currrently spoofs docs as FormattedDocs, likely to change in future versions.
 */
async function getNewDocSring(name: string, item: CachedGlobalItem) : Promise<string | undefined> {
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
    item.refrenceUris.add(uri);
  }
  if (item.resolved) {
    return item;
  }
  if (item.type === SymbolKind.Function) {
    item.uri = await getFunctionUri(name);
  }
  const newDocStr: string | undefined = await getNewDocSring(name, item);
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
 * builds MarkupString for function names, since fish shell standard for private functions
 * is naming convention with leading '__', this function ensures that our MarkupStrings
 * will be able to display the FunctionName (instead of interpreting it as '__' bold text)
 */
function escapePathStr(functionTitleLine: string) : string {
  const afterComment = functionTitleLine.split(' ').slice(1);
  const pathIndex = afterComment.findIndex((str: string) => str.includes('/'));
  const path: string = afterComment[pathIndex]?.toString() || '';
  return [
    '**' + afterComment.slice(0, pathIndex).join(' ').trim() + '**',
    `*\`${path}\`*`,
    '**' + afterComment.slice(pathIndex + 1).join(' ').trim() + '**',
  ].join(' ');
}

function ensureMinLength<T>(arr: T[], minLength: number, fillValue?: T): T[] {
  while (arr.length < minLength) {
    arr.push(fillValue as T);
  }
  return arr;
}

/**
 * builds FunctionDocumentaiton string
 */
export async function getFunctionDocString(name: string): Promise<string | undefined> {
  function formatTitle(title: string[]) {
    const ensured = ensureMinLength(title, 5, '');
    const [path, autoloaded, line, scope, description] = ensured;

    return [
      `__\`${path}\`__`,
      `- autoloaded: ${autoloaded === 'autoloaded' ? '_true_' : '_false_'}`,
      `- line: _${line}_`,
      `- scope: _${scope}_`,
      `${description}`,
    ].map((str) => str.trim()).filter(l => l.trim().length).join('\n');
  }
  const [title, body] = await Promise.all([
    execCmd(`functions -D -v ${name}`),
    execCmd(`functions --no-details ${name}`),
  ]);
  return [
    formatTitle(title),
    '___',
    '```fish',
    body.join('\n'),
    '```',
  ].join('\n') || '';
}

export async function getStaticDocString(item: FishCompletionItem): Promise<string> {
  let result = [
    '```text',
    `${item.label}  -  ${item.documentation}`,
    '```',
  ].join('\n');
  item.examples?.forEach((example: CompletionExample) => {
    result += [
      '___',
      '```fish',
      `# ${example.title}`,
      example.shellText,
      '```',
    ].join('\n');
  });
  return result;
}

export async function getAbbrDocString(name: string): Promise<string | undefined> {
  const items: string[] = await execCmd('abbr --show | string split \' -- \' -m1 -f2');
  function getAbbr(items: string[]) : [string, string] {
    const start : string = `${name} `;
    for (const item of items) {
      if (item.startsWith(start)) {
        return [start.trimEnd(), item.slice(start.length)];
      }
    }
    return ['', ''];
  }
  const [title, body] = getAbbr(items);
  return [
    `Abbreviation: \`${title}\``,
    '___',
    '```fish',
    body.trimEnd(),
    '```',
  ].join('\n') || '';
}
/**
 * builds MarkupString for builtin documentation
 */
export async function getBuiltinDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = await execCommandDocs(name);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return [
    `__${name.toUpperCase()}__ - _https://fishshell.com/docs/current/cmds/${name.trim()}.html_`,
    '___',
    '```man',
    splitDocs.slice(startIndex).join('\n'),
    '```',
  ].join('\n');
}

export async function getAliasDocString(label: string, line: string): Promise<string | undefined> {
  return [
    `Alias: _${label}_`,
    '___',
    '```fish',
    line.split('\t')[1],
    '```',
  ].join('\n');
}

/**
 * builds MarkupString for event handler documentation
 */
export async function getEventHandlerDocString(documentation: string): Promise<string> {
  const [label, ...commandArr] = documentation.split(/\s/, 2);
  const command = commandArr.join(' ');
  const doc = await getFunctionDocString(command);
  if (!doc) {
    return [
      `Event: \`${label}\``,
      '___',
      `Event handler for \`${command}\``,
    ].join('\n');
  }
  return [
    `Event: \`${label}\``,
    '___',
    doc,
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
  return [
    first,
    '___',
    middle.join('\n'),
    '___',
    last,
  ].join('\n');
}

export async function getCommandDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = await execCommandDocs(name);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return [
    '```man',
    splitDocs.slice(startIndex).join('\n'),
    '```',
  ].join('\n');
}

export function initializeMap(collection: string[], type: SymbolKind, uri?: string): Map<string, CachedGlobalItem> {
  const items: Map<string, CachedGlobalItem> = new Map<string, CachedGlobalItem>();
  collection.forEach((item) => {
    items.set(item, createCachedItem(type));
  });
  return items;
}

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

  async parse(uri?: string) {
    this._unknowns = initializeMap([], SymbolKind.Null, uri);
    await Promise.all([
      execEscapedCommand('set -n'),
      execEscapedCommand('functions -an | string collect'),
      execEscapedCommand('builtin -n'),
    ]).then(([vars, funcs, builtins]) => {
      this._variables = initializeMap(vars, SymbolKind.Variable, uri);
      this._functions = initializeMap(funcs, SymbolKind.Function, uri);
      this._builtins = initializeMap(builtins, SymbolKind.Class, uri);
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
  async resolve(name: string, uri?:string, type?: SymbolKind) {
    const itemType = type || this.findType(name);
    let item : CachedGlobalItem | undefined = this.find(name, itemType);
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
export async function initializeDocumentationCache() {
  const cache = new DocumentationCache();
  await cache.parse();
  return cache;
}
