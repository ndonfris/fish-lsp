import { spawn, exec, SpawnOptions, spawnSync, SpawnSyncOptionsWithStringEncoding, ExecOptions, ExecOptionsWithStringEncoding } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
//import { FishCompletionItem } from './completion-strategy';

export function findShellPath() {
    const result = spawnSync('which fish', {shell: true, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8'})
    return result.stdout.toString().trim()
}

const FishShellPath = findShellPath()

async function spawnAsyncRawShellOutput(cmd: string, splitChar: string = '\n'): Promise<string[]> {
    const {stdout} = await execAsync(cmd, {shell: FishShellPath, encoding: 'utf-8'});
    return stdout.toString().split(splitChar);
}

export namespace ShellItemsBuilder {
    export function createFromArray(rawOutput: string[]): Set<string> {
        return new Set(rawOutput);
    }
    export async function createFromCmd(cmd: string, sliceString: string = '', splitChar?: string): Promise<Set<string>> {
        const rawItems = await spawnAsyncRawShellOutput(cmd, splitChar);
        const sliceStart = sliceString ? sliceString.length : 0;
        const rawNames = rawItems.map((item) => {
            const result = item.slice(sliceStart).split(' ', 1);
            return result[0];
        });
        return new Set(rawNames);
    }
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
export type IRecord = Record<SHELL_ITEMS_TYPE, Set<string>>
export type ShellItemsDocumentationCallback = (item: string) => Promise<string[]>;
export type IRecordCallback = Record<SHELL_ITEMS_TYPE, ShellItemsDocumentationCallback>
function defaultItems(): IRecord {
    return {
        [SHELL_ITEMS_TYPE.abbr]:     new Set<string>(),
        [SHELL_ITEMS_TYPE.function]: new Set<string>(),
        [SHELL_ITEMS_TYPE.variable]: new Set<string>(),
        [SHELL_ITEMS_TYPE.builtin]:  new Set<string>(),
        [SHELL_ITEMS_TYPE.event]:    new Set<string>(),
        [SHELL_ITEMS_TYPE.combiner]: new Set<string>(),
        [SHELL_ITEMS_TYPE.scope]:    new Set<string>(), 
        [SHELL_ITEMS_TYPE.null]:     new Set<string>(), 
    }
}

export class ShellItems {
    static async create(): Promise<ShellItems> {
        const items = await initializeShellItemsHelper();
        return new ShellItems(items);
    }

    private items: IRecord;
    constructor(items: IRecord) {
        this.items = items;
    }

    getItemType(word: string) {
        if (this.items['abbr'].has(word))     return 'abbr'     
        if (this.items['combiner'].has(word)) return 'combiner' 
        if (this.items['scope'].has(word))    return 'scope'    
        if (this.items['builtin'].has(word))  return 'builtin'  
        if (this.items['function'].has(word)) return 'function' 
        if (this.items['variable'].has(word)) return 'variable' 
        if (this.items['event'].has(word))    return 'event'    
        return 'null'                                                   
    }

    getItems(key: SHELL_ITEMS_TYPE): Set<string> {
        return this.items[key];
    }

    getKeys(): SHELL_ITEMS_TYPE[] {
        return Object.keys(this.items) as SHELL_ITEMS_TYPE[];
    }

    //setItemDocumentationResolver(key: SHELL_ITEMS_TYPE, resolver: (item: string) => Promise<string[]>) {
    //    this.documentation[key] = resolver;
    //}
    //
    //async getItemDocumentation(key: SHELL_ITEMS_TYPE, item: string): Promise<string> {
    //    const res = await this.documentation[key](item);
    //    return res.join('\n');
    //}

    //async getAllDocs(key: SHELL_ITEMS_TYPE): Promise<string[]> {
    //    const items = this.items[key];
    //    const result: Promise<string[]>[] = []
    //    for (const item of items) {
    //        const promise = this.documentation[key](item);
    //        result.push(promise);
    //    }
    //    return await Promise.all(result).then((docs) => docs.map(doc => doc.slice(0,1).join('\n')))
    //}
}


async function initializeShellItemsHelper() {
    return await Promise.all([
        ShellItemsBuilder.createFromCmd("abbr --list"),
        ShellItemsBuilder.createFromCmd(`functions -n`, "", ","),
        ShellItemsBuilder.createFromCmd(`set -n`),
        ShellItemsBuilder.createFromCmd(`functions --handlers \| string match -vr 'Event \\w+' `),
        ShellItemsBuilder.createFromCmd(`builtin -n`),
        ShellItemsBuilder.createFromArray(["and", "or", "not", "||", "&&", "!"]),
        ShellItemsBuilder.createFromArray(["if", "else", "switch", "while", "else if"]),
        Promise.resolve(new Set<string>()),
    ]).then(
            ([
                abbrItems,
                functionItems,
                variableItems,
                eventItems,
                builtinItems,
                combinerItems,
                scopeItems,
                nullItems
            ]) => {
                return {
                    [SHELL_ITEMS_TYPE.abbr]: abbrItems,
                    [SHELL_ITEMS_TYPE.function]: functionItems,
                    [SHELL_ITEMS_TYPE.variable]: variableItems,
                    [SHELL_ITEMS_TYPE.event]: eventItems,
                    [SHELL_ITEMS_TYPE.builtin]: builtinItems,
                    [SHELL_ITEMS_TYPE.combiner]: combinerItems,
                    [SHELL_ITEMS_TYPE.scope]: scopeItems,
                    [SHELL_ITEMS_TYPE.null]: nullItems,
                };
            }
        ); 
}


export async function executeAsyncCommand(cmd: string): Promise<string[]> {
    const {stdout} = await execAsync(cmd, {shell: FishShellPath});
    return stdout.toString().split('\n');
}


async function initializeShellItemDocumentation(kind: SHELL_ITEMS_TYPE, item: string): Promise<string[]> {
    switch (kind) {
        case SHELL_ITEMS_TYPE.abbr:     return await executeAsyncCommand(`abbr | string split ' -- ' -f2 | string match -e '${item}' | string split ' ' -m1 -f2 | string unescape`);
        case SHELL_ITEMS_TYPE.function: return await executeAsyncCommand(`echo "$(functions --details --verbose ${item})"`);
        case SHELL_ITEMS_TYPE.variable: return await executeAsyncCommand(`echo "$(set -n ${item})"`);
        case SHELL_ITEMS_TYPE.builtin:  return await executeAsyncCommand(`man '${item}' | col -bx`);
        case SHELL_ITEMS_TYPE.event:    return await executeAsyncCommand(`functions --handlers ${item} | string match -vr 'Event \\w+'`);
        case SHELL_ITEMS_TYPE.combiner: return await executeAsyncCommand(`man '${item}' | col -bx`);
        case SHELL_ITEMS_TYPE.scope:    return await executeAsyncCommand(`man '${item}' | col -bx`);
        case SHELL_ITEMS_TYPE.null:     return await executeAsyncCommand(`man '${item}' | col -bx`);
    }
}