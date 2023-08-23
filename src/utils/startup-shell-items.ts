import { spawnSync, SpawnSyncOptionsWithStringEncoding } from 'child_process';
//import { FishCompletionItem } from './completion-strategy';

export function findShellPath() {
    const result = spawnSync('which fish', {shell: true, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8'})
    return result.stdout.toString().trim()
}

const FishShellPath = findShellPath()

export namespace ShellItems {

    export function createFromArray(rawOutput: string[]): Set<string> {
        return new Set(rawOutput)
    }

    export function createFromCmd(cmd: string, sliceString: string = ''): Set<string> {
        const rawItems = spawnSyncRawShellOutput(cmd)
        const sliceStart = sliceString ? sliceString.length : 0
        const rawNames = rawItems.map((item) => {
            const result = item.slice(sliceStart).split(' ', 1)
            return result[0]
        })
        return new Set(rawNames)
    }

}

const SpawnOpts: SpawnSyncOptionsWithStringEncoding  = {
    shell: FishShellPath,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf-8',
}

function spawnSyncRawShellOutput(cmd: string) {
    const result = spawnSync(cmd, SpawnOpts)
    return result.stdout.toString().split('\n')
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


export function createShellItems() : Record<SHELL_ITEMS_TYPE, Set<string>> {
    return {
        [SHELL_ITEMS_TYPE.abbr]:       ShellItems.createFromCmd('abbr --show', `abbr -a -- `),
        [SHELL_ITEMS_TYPE.function]:   ShellItems.createFromCmd(`functions --names | string split -n '\\n'`),
        [SHELL_ITEMS_TYPE.variable]:   ShellItems.createFromCmd(`set -n`),
        [SHELL_ITEMS_TYPE.event]:      ShellItems.createFromCmd(`functions --handlers | string match -vr '^Event \\w+' | string split -n '\\n'`),
        [SHELL_ITEMS_TYPE.builtin]:    ShellItems.createFromCmd(`builtin -n`),
        [SHELL_ITEMS_TYPE.combiner]:   ShellItems.createFromArray(['and', 'or', 'not', '||', '&&', '!']),
        [SHELL_ITEMS_TYPE.scope]:      ShellItems.createFromArray(['if', 'else', 'switch', 'while', 'else if']),
        [SHELL_ITEMS_TYPE.null]:       new Set(),
    }
}


//export function toShellItemType(word: string) {
//    if (ExternalShellItems['abbr'].has(word))     return 'abbr'
//    if (ExternalShellItems['combiner'].has(word)) return 'combiner'
//    if (ExternalShellItems['scope'].has(word))    return 'scope'
//    if (ExternalShellItems['builtin'].has(word))  return 'builtin'
//    if (ExternalShellItems['function'].has(word)) return 'function'
//    if (ExternalShellItems['variable'].has(word)) return 'variable'
//    if (ExternalShellItems['event'].has(word))    return 'event'
//    return 'null'
//}