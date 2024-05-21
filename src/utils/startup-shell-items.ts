import { spawnSync, SpawnSyncOptionsWithStringEncoding } from 'child_process';
//import { FishCompletionItem } from './completion-strategy';

export function findShellPath() {
  const result = spawnSync('which fish', { shell: true, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8' });
  return result.stdout.toString().trim();
}

const FishShellPath = findShellPath();

export const SpawnOpts: SpawnSyncOptionsWithStringEncoding = {
  shell: FishShellPath,
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf-8',
};

export function spawnSyncRawShellOutput(cmd: string) {
  const result = spawnSync(cmd, SpawnOpts);
  return result.stdout.toString().split('\n');
}

export enum SHELL_ITEMS_TYPE {
  abbr = 'abbr',
  function = 'function',
  variable = 'variable',
  builtin = 'builtin',
  event = 'event',
  combiner = 'combiner',
  scope = 'scope',
  null = 'null',
}

export const SHELL_ITEMS_STRING_TYPE_LOOKUP: Record<string, SHELL_ITEMS_TYPE> = {
  ['abbr']:       SHELL_ITEMS_TYPE.abbr,
  ['function']:   SHELL_ITEMS_TYPE.function,
  ['variable']:   SHELL_ITEMS_TYPE.variable,
  ['builtin']:    SHELL_ITEMS_TYPE.builtin,
  ['event']:      SHELL_ITEMS_TYPE.event,
  ['combiner']:   SHELL_ITEMS_TYPE.combiner,
  ['scope']:      SHELL_ITEMS_TYPE.scope,
  ['null']:       SHELL_ITEMS_TYPE.null,
};

export const SHELL_ITEMS_TYPE_LOOKUP: Record<SHELL_ITEMS_TYPE, string> = {
  [SHELL_ITEMS_TYPE.abbr]: 'abbr',
  [SHELL_ITEMS_TYPE.function]: 'function',
  [SHELL_ITEMS_TYPE.variable]: 'variable',
  [SHELL_ITEMS_TYPE.builtin]: 'builtin',
  [SHELL_ITEMS_TYPE.event]: 'event',
  [SHELL_ITEMS_TYPE.combiner]: 'combiner',
  [SHELL_ITEMS_TYPE.scope]: 'scope',
  [SHELL_ITEMS_TYPE.null]: 'null',
};

export type CachedItem = Record<SHELL_ITEMS_TYPE, ShellItems.ShellOutput[]>;

export namespace ShellItems {

  export function createFromArray(rawOutput: string[], type: SHELL_ITEMS_TYPE): ShellOutput[] {
    const output: ShellOutput[] = [];
    rawOutput.forEach((line: string) => {
      const item = line.trim();
      const splitItem = item.split(' ');
      const spaceCount = splitItem.length;
      const result = spaceCount > 1 ? [splitItem[0], splitItem.slice(1).join(' ')] : [item, ''];
      output.push(new ShellOutput(result[0], type, result[1], result[1]));
    });
    return output;
  }

  export function createFromCmd(cmd: string, type: SHELL_ITEMS_TYPE): ShellOutput[] {
    const rawItems = spawnSyncRawShellOutput(cmd);
    const output: ShellOutput[] = [];
    rawItems.forEach((line: string) => {
      const item = line.trim();
      const splitItem = item.split(' ');
      const spaceCount = splitItem.length;
      const result = spaceCount > 1 ? [splitItem[0], splitItem.slice(1).join(' ')] : [item, ''];
      output.push(new ShellOutput(result[0], type, result[1], result[1]?.slice(0, result[1].lastIndexOf('#'))));
    });
    return output;
  }

  export class ShellOutput {
    constructor(
      protected name: string = '',
      protected type: string = '',
      protected docs: string = '',
      protected replaceStr: string = '',
    ) {}

    public getName() {
      return this.name;
    }
    public getType() {
      return this.type;
    }
  }

  export class Cached {
    private static cache: CachedItem = createShellItems();
    private static typeToNames: Record<SHELL_ITEMS_TYPE, Set<string>> = {
      [SHELL_ITEMS_TYPE.abbr]:       new Set<string>(Cached.cache.abbr.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.function]:   new Set<string>(Cached.cache.function.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.variable]:   new Set<string>(Cached.cache.variable.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.event]:      new Set<string>(Cached.cache.event.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.builtin]:    new Set<string>(Cached.cache.builtin.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.combiner]:   new Set<string>(Cached.cache.combiner.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.scope]:      new Set<string>(Cached.cache.scope.map((item) => item.getName())),
      [SHELL_ITEMS_TYPE.null]:       new Set<string>(Cached.cache.null.map((item) => item.getName())),
    };

    public static getCache() {
      if (!Cached.cache) {
        Cached.cache = createShellItems();
      }
      return Cached.cache;
    }

    public getTypes() {
      return Object.keys(SHELL_ITEMS_TYPE).map((key) => key);
    }

    public getType(name: string) {
      for (const type of this.getTypes()) {
        const lookup = SHELL_ITEMS_STRING_TYPE_LOOKUP[type]!;
        if (Cached.typeToNames[lookup].has(name)) {
          return type;
        }
      }
      return SHELL_ITEMS_TYPE.null;
    }

    public getAllItemsOfType(t: SHELL_ITEMS_TYPE) {
      return Cached.cache[t];
    }
  }
}

//export const ExternalShellItems: Record<SHELL_ITEMS_TYPE, Set<string>> = {
//    [SHELL_ITEMS_TYPE.abbr]:       ShellItems.createFromCmd('abbr --show', `abbr -a -- `),
//    [SHELL_ITEMS_TYPE.function]:   ShellItems.createFromCmd(`functions --names | string split -n '\\n'`),
//    [SHELL_ITEMS_TYPE.variable]:   ShellItems.createFromCmd(`set -n`),
//    [SHELL_ITEMS_TYPE.event]:      ShellItems.createFromCmd(`functions --handlers | string match -vr '^Event \\w+' | string split -n '\\n'`),
//    [SHELL_ITEMS_TYPE.builtin]:    ShellItems.createFromCmd(`builtin -n`),
//    [SHELL_ITEMS_TYPE.combiner]:   ShellItems.createFromArray(['and', 'or', 'not', '||', '&&', '!']),
//    [SHELL_ITEMS_TYPE.scope]:      ShellItems.createFromArray(['if', 'else', 'switch', 'while', 'else if']),
//    [SHELL_ITEMS_TYPE.null]:       new Set(),
//}

export function createShellItems(): CachedItem {
  return {
    [SHELL_ITEMS_TYPE.abbr]:       ShellItems.createFromCmd('abbr | string split \' -- \' -f2 | string unescape', SHELL_ITEMS_TYPE.abbr),
    [SHELL_ITEMS_TYPE.function]:   ShellItems.createFromCmd('functions --names | string split -n \'\\n\'', SHELL_ITEMS_TYPE.function),
    [SHELL_ITEMS_TYPE.variable]:   ShellItems.createFromCmd('set -n', SHELL_ITEMS_TYPE.variable),
    [SHELL_ITEMS_TYPE.event]:      ShellItems.createFromCmd('functions --handlers | string match -vr \'^Event \\w+\' | string split -n \'\\n\'', SHELL_ITEMS_TYPE.event),
    [SHELL_ITEMS_TYPE.builtin]:    ShellItems.createFromCmd('builtin -n', SHELL_ITEMS_TYPE.builtin),
    [SHELL_ITEMS_TYPE.combiner]:   ShellItems.createFromArray(['and', 'or', 'not', '||', '&&', '!'], SHELL_ITEMS_TYPE.combiner),
    [SHELL_ITEMS_TYPE.scope]:      ShellItems.createFromArray(['if', 'else', 'switch', 'while', 'else if'], SHELL_ITEMS_TYPE.scope),
    [SHELL_ITEMS_TYPE.null]:       ShellItems.createFromArray([], SHELL_ITEMS_TYPE.null),
  };
}
