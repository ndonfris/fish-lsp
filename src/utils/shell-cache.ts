import {CompletionItem, CompletionItemKind} from "vscode-languageserver"
//import {FishCompletionItem, FishCompletionItemKind} from "./completion-strategy";
import { FormatSpecifierCompletionItems, StatusNumbers,  FishSimpleCompletionItem, PipeItems, EscapeCharItems, StringRegexExpressions, CombinerCompletionItems, StatementCompletionItems } from "./completion-types"
import { execCmd } from './exec';



export enum ShellCachedItemType {
    Abbr = 'Abbr',
    Builtin = 'Builtin',
    Function = 'Function',
    Variable = 'Variable',
    Event = 'Event',
}
export namespace ShellCachedItemType {
    export function getListAllCommand(type: ShellCachedItemType): string {
        switch (type) {
            case ShellCachedItemType.Abbr:
                return 'abbr --list'
            case ShellCachedItemType.Builtin:
                return 'builtin --names'
            case ShellCachedItemType.Function:
                return 'functions --names | string collect'
            case ShellCachedItemType.Variable:
                return 'set --names'
            case ShellCachedItemType.Event:
                return "functions --handlers | string match -vr '^Event \\w+'"
        }
    }
    export function getCompletionKind(type: ShellCachedItemType): CompletionItemKind {
        switch (type) {
            case ShellCachedItemType.Abbr:
                return CompletionItemKind.Snippet
            case ShellCachedItemType.Builtin:
                return CompletionItemKind.Keyword
            case ShellCachedItemType.Function:
                return CompletionItemKind.Function
            case ShellCachedItemType.Variable:
                return CompletionItemKind.Variable
            case ShellCachedItemType.Event:
                return CompletionItemKind.Event
        }
    }
    export function exec(type: ShellCachedItemType): Promise<string[]> {
        return execCmd(getListAllCommand(type))
    }
}

export class ShellCachedItems {

    public _cached: Map<ShellCachedItemType, Set<string>> = new Map()

    async init() {
        await Promise.all([
            ShellCachedItemType.exec(ShellCachedItemType.Abbr),
            ShellCachedItemType.exec(ShellCachedItemType.Function),
            ShellCachedItemType.exec(ShellCachedItemType.Builtin),
            ShellCachedItemType.exec(ShellCachedItemType.Variable),
            ShellCachedItemType.exec(ShellCachedItemType.Event),
        ]).then(([abbr, func, builtin, variable, event]) => {
            this.safeSet(ShellCachedItemType.Abbr, abbr)
            this.safeSet(ShellCachedItemType.Function, func)
            this.safeSet(ShellCachedItemType.Builtin, builtin)
            this.safeSet(ShellCachedItemType.Variable, variable)
            this.safeSet(ShellCachedItemType.Event, event)
        })
    }

    safeSet(type: ShellCachedItemType, list: string[]) {
        const result: Set<string> = new Set()
        for (const line of list) {
            const wordArr = line.trim().split(' ')
            if (wordArr.length === 0) continue
            const word = wordArr[0]
            if (word && !badBuiltin(word)) result.add(word)
        }
        this._cached.set(type, result)
    }

    keys() {
        return Array.from(this._cached.keys())
    }

    hasLabel(label: string, types: ShellCachedItemType[] = this.keys()) {
        const allItems = this._cached.entries()
        for (const [type, list] of allItems) {
            if (types.includes(type) && list.has(label)) return true
        }
        return false
    }

    getCompletionType(label: string) {
        const allItems = this.keys()
        for (const type of allItems) {
            if (this._cached.get(type)?.has(label)) return type
        }
        return null
    }

    allForType(type: ShellCachedItemType): string[] {
        return Array.from(this._cached.get(type) || [])
    }
}
type EventAction = (currentData: string, label: string) => Promise<string>;

class EventQueue {
  private actions: EventAction[] = [];

  // Enqueue a new action to be executed.
  enqueue(action: EventAction): void {
    this.actions.push(action);
  }

  // Execute all enqueued actions on the provided data.
  async execute(initialData: string, label: string): Promise<string> {
    let result = initialData;

    for (const action of this.actions) {
      result = await action(result, label);
    }
    return result;
  }
}

async function getDocumentationQueue(type: ShellCachedItemType): Promise<EventQueue> {
    const queue = new EventQueue();
    switch (type) {
        case ShellCachedItemType.Abbr:
            queue.enqueue(appendDocumentation);
        default:
            queue.enqueue(appendDocumentation);
    }
    return queue;
}

// Sample usage

// Define some actions
const appendDocumentation: EventAction = async (currentData, label) => {
  // Simulate fetching documentation for the first label as an example.
    return currentData + await fetchDocumentationForLabel(label);
};

// Mocking fetch functions for the sake of this example
async function fetchDocumentationForLabel(label: string): Promise<string> {
  return `Documentation for ${label}\n`;
}


function badBuiltin(word: string) {
    return ['.', ':'].includes(word)
}


export enum FishCompletionItemKind {
    ABBR = "abbr",
    BUILTIN = "builtin",
    FUNCTION = "function",
    VARIABLE = "variable",
    EVENT = "event",
    PIPE = "pipe",
    ESC_CHARS = "esc_chars",
    STATUS = "status",
    WILDCARD = "wildcard",
    COMMAND = "command",
    REGEX = "regex",
    COMBINER = "combiner",
    FORMAT_STR = "format_str",
    STATEMENT = "statement",
    ARGUMENT = "argument",
}
export namespace FishCompletionItemKind {
     // Exclude functions and get the real enum keys/values
    type EnumKeys = { [K in keyof typeof FishCompletionItemKind]: typeof FishCompletionItemKind[K] extends string ? K : never }[keyof typeof FishCompletionItemKind];
    type EnumValues = typeof FishCompletionItemKind[EnumKeys];
    export function getRemoveLabels(kind: FishCompletionItemKind): string[] {
        switch (kind) {
            case FishCompletionItemKind.BUILTIN:
                return ['.', ':']
            default:
                return []
        }
    }
    export function getEntries(): [EnumKeys, EnumValues][] {
        return Object.entries(FishCompletionItemKind).filter(
            ([key, value]) => typeof value !== 'function'
        ) as [EnumKeys, EnumValues][];
    }
    export function getKeys(): EnumKeys[] {
        return Object.keys(FishCompletionItemKind).filter(
            (key) => typeof FishCompletionItemKind[key as EnumKeys] !== 'function'
        ) as EnumKeys[];
    } 
    export function getValues(): EnumValues[] {
        return getEntries().map(([_, v]) => v.toString()) as EnumValues[];
    }
    export function getEnumKey(input: EnumKeys | EnumValues): EnumKeys | null{
        const entries = getEntries()
        for (const [key, value] of entries) {
            if (key === input || value === input) return key
            continue;
        }
        return null
    }
    export function getEnumValue(input: EnumKeys | EnumValues| string): EnumValues | null {
        for (const [key, value] of getEntries()) {
            if (key === input || value === input) return value
            continue;
        }
        return null
    }
}

interface SetupResolver {
    command: string
    kind: 'command' | 'simple' | 'typesOnly' | 'none' 
    promise: Promise<string[]>
    deleteLabels: string[]
}
export namespace SetupResolver {
    export function create(
        command: string = '',
        kind: "command" | "simple" | "typesOnly" | 'none' = 'none',
        promise: Promise<string[]> = emptyPromise(),
        deleteLabels: string[] = [],
    ) {
        return {
            command: command,
            kind: kind,
            promise: promise,
            deleteLabels: deleteLabels,
        } as SetupResolver;
    }
}

interface ICached {
    setupResolver: SetupResolver
    labels: Set<string>
    items: CompletionItem[]
    toCompletionItemKind: CompletionItemKind
    toFishCompletionItemKind: FishCompletionItemKind
}
export namespace ICached {
    export function create(
        command: string,
        labels: Set<string>,
        items: CompletionItem[],
        toCompletionItemKind: CompletionItemKind,
        toFishCompletionItemKind: FishCompletionItemKind
    ) {
        return {
            setupResolver: SetupResolver.create(command, 'command', execCmd(command)),
            labels,
            items,
            toCompletionItemKind,
            toFishCompletionItemKind
        } as ICached
    }

    export function createWithCommand(command: string, toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
        let removeLabels = FishCompletionItemKind.getRemoveLabels(toFishCompletionItemKind)
        return {
            setupResolver: SetupResolver.create(command, 'command', execCmd(command), removeLabels),
            labels: new Set(),
            items: [],
            toCompletionItemKind,
            toFishCompletionItemKind
        } as ICached
    }
    export function createSimpleCompletion(items: FishSimpleCompletionItem[], toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
        return {
            setupResolver: SetupResolver.create('', 'simple',  getSimpleCompletionItemLabel(items)),
            labels: new Set(), // just resolve it and set it later
            items,
            toCompletionItemKind,
            toFishCompletionItemKind
        } as ICached
    }
    export function createTypesOnly(toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
        return {
            setupResolver: SetupResolver.create('', 'typesOnly'),
            labels: new Set(),
            items: [],
            toCompletionItemKind,
            toFishCompletionItemKind
        } as ICached
    }
}

export async function initFishCompletionItemKinds(){
    const _cached: Record<FishCompletionItemKind, ICached> = {
        [FishCompletionItemKind.ABBR]: ICached.createWithCommand(
            "abbr --list",
            CompletionItemKind.Snippet,
            FishCompletionItemKind.ABBR
        ),
        [FishCompletionItemKind.BUILTIN]: ICached.createWithCommand(
            "builtin --names",
            CompletionItemKind.Keyword,
            FishCompletionItemKind.BUILTIN
        ),
        [FishCompletionItemKind.FUNCTION]: ICached.createWithCommand(
            "functions --names | string collect",
            CompletionItemKind.Function,
            FishCompletionItemKind.FUNCTION
        ),
        [FishCompletionItemKind.VARIABLE]: ICached.createWithCommand(
            "set --names",
            CompletionItemKind.Variable,
            FishCompletionItemKind.VARIABLE
        ),
        [FishCompletionItemKind.EVENT]: ICached.createWithCommand(
            "functions --handlers | string match -vr '^Event \\w+' | string split -f1 ' '",
            CompletionItemKind.Event,
            FishCompletionItemKind.EVENT
        ),
        [FishCompletionItemKind.PIPE]: ICached.createSimpleCompletion(
            PipeItems,
            CompletionItemKind.Operator,
            FishCompletionItemKind.PIPE
        ),
        [FishCompletionItemKind.ESC_CHARS]: ICached.createSimpleCompletion(
            EscapeCharItems,
            CompletionItemKind.Text,
            FishCompletionItemKind.ESC_CHARS
        ),
        [FishCompletionItemKind.STATUS]: ICached.createSimpleCompletion(
            StatusNumbers,
            CompletionItemKind.EnumMember,
            FishCompletionItemKind.STATUS
        ),
        [FishCompletionItemKind.COMBINER]: ICached.createSimpleCompletion(
            CombinerCompletionItems,
            CompletionItemKind.Operator,
            FishCompletionItemKind.COMBINER
        ),
        [FishCompletionItemKind.FORMAT_STR]: ICached.createSimpleCompletion(
            FormatSpecifierCompletionItems,
            CompletionItemKind.TypeParameter,
            FishCompletionItemKind.FORMAT_STR
        ),
        [FishCompletionItemKind.STATEMENT]: ICached.createSimpleCompletion(
            StatementCompletionItems,
            CompletionItemKind.Keyword,
            FishCompletionItemKind.STATEMENT
        ),
        [FishCompletionItemKind.REGEX]: ICached.createSimpleCompletion(
            StringRegexExpressions,
            CompletionItemKind.Text,
            FishCompletionItemKind.REGEX
        ),
        [FishCompletionItemKind.COMMAND]: ICached.createTypesOnly(
            CompletionItemKind.Class,
            FishCompletionItemKind.COMMAND
        ),
        [FishCompletionItemKind.WILDCARD]: ICached.createTypesOnly(
            CompletionItemKind.Text,
            FishCompletionItemKind.WILDCARD
        ),
        [FishCompletionItemKind.ARGUMENT]: ICached.createTypesOnly(
            CompletionItemKind.Property,
            FishCompletionItemKind.ARGUMENT
        ),
    } as const;

    const executeSetup = Object.keys(_cached).map(async (key) => {
        const keyAsEnum = FishCompletionItemKind.getEnumValue(key)!
        const current = _cached[keyAsEnum]
        const setup = current.setupResolver
        try {
            const labels = await Promise.resolve(setup.promise)
            current.labels = new Set(labels)
        } catch (Error) {
            console.log(`Error executingSetup for FishCompletionItemKind[${key}]`);
        }

        if (!setup.deleteLabels.length) return

        setup.deleteLabels.forEach((label) => {
            current.labels.delete(label)
            const index = current.items.findIndex((object) => {
                return object.label === label;
            });
            if (index !== -1) current.items.splice(index, 1);
        });
    })

    await Promise.all(executeSetup);

    return _cached;
}

interface ShellCacheItem {
  cmd?: string;
  labelNamesResolver: Promise<string[]> | string[];
  completionKind: CompletionItemKind;
  fishCompletionItemKind: FishCompletionItemKind;
}


const ShellCache: Record<string, ShellCacheItem> = {
    ABBR: {
        cmd: 'abbr --list',
        labelNamesResolver: execCmd('abbr --list'),
        completionKind: CompletionItemKind.Snippet,
        fishCompletionItemKind: FishCompletionItemKind.ABBR,
    },
    BUILTIN: {
        cmd: 'builtin --names',
        labelNamesResolver: execCmd('builtin --names'),
        completionKind: CompletionItemKind.Function,
        fishCompletionItemKind: FishCompletionItemKind.BUILTIN,
    },
    FUNCTION: {
        cmd: 'functions --names | string collect',
        labelNamesResolver: execCmd('functions --names | string collect'),
        completionKind: CompletionItemKind.Function,
        fishCompletionItemKind: FishCompletionItemKind.FUNCTION,
    },
    VARIABLE: {
        cmd: 'set --names',
        labelNamesResolver: execCmd('set --names'),
        completionKind: CompletionItemKind.Variable,
        fishCompletionItemKind: FishCompletionItemKind.VARIABLE,
    },
    EVENT: {
        cmd: `functions --handlers | string match -vr '^Event \\w+' | string split -f1 ' '`,
        labelNamesResolver: execCmd(`functions --handlers | string match -vr '^Event \\w+' | string split -f1 ' '`),
        completionKind: CompletionItemKind.Event,
        fishCompletionItemKind: FishCompletionItemKind.EVENT,
    },
    STATUS: {
        labelNamesResolver: getSimpleCompletionItemLabel(StatusNumbers),
        completionKind: CompletionItemKind.EnumMember,
        fishCompletionItemKind: FishCompletionItemKind.STATUS,
    },
    FORMAT_STR: {
        labelNamesResolver: getSimpleCompletionItemLabel(FormatSpecifierCompletionItems),
        completionKind: CompletionItemKind.TypeParameter,
        fishCompletionItemKind: FishCompletionItemKind.FORMAT_STR,
    },
    PIPE: {
        labelNamesResolver: getSimpleCompletionItemLabel(PipeItems),
        completionKind: CompletionItemKind.Operator,
        fishCompletionItemKind: FishCompletionItemKind.PIPE,
    },
    ESC_CHARS: {
        labelNamesResolver: getSimpleCompletionItemLabel(EscapeCharItems),
        completionKind: CompletionItemKind.Text,
        fishCompletionItemKind: FishCompletionItemKind.ESC_CHARS,
    },
    REGEX: {
        labelNamesResolver: getSimpleCompletionItemLabel(StringRegexExpressions),
        completionKind: CompletionItemKind.Text,
        fishCompletionItemKind: FishCompletionItemKind.REGEX,
    },
    COMBINER: {
        labelNamesResolver: getSimpleCompletionItemLabel(CombinerCompletionItems),
        completionKind: CompletionItemKind.Operator,
        fishCompletionItemKind: FishCompletionItemKind.COMBINER,
    },
    STATEMENT: {
        labelNamesResolver: getSimpleCompletionItemLabel(StatementCompletionItems),
        completionKind: CompletionItemKind.Keyword,
        fishCompletionItemKind: FishCompletionItemKind.STATEMENT,
    }
    //WILDCARD: 
    //FunctionCompletionEvents:
    //Argument
    //Command
} as const

async function getSimpleCompletionItemLabel(items: FishSimpleCompletionItem[]): Promise<string[]> {
    return items.map((item) => item.label)
}

async function emptyPromise() {
    return [] as string[]
}

export async function initializeShellCache() {
  const ShellCached = ShellCache
  // Prepare an array of all promises to resolve
  const allPromises = Object.keys(ShellCached).map(async (key) => {
    try {
        const cacheItem = ShellCached[key];
        // Use Promise.resolve to handle both Promise and non-Promise cases
        const resolvedLabels = await Promise.resolve(cacheItem.labelNamesResolver);
        // Update the labelNamesResolver with the resolved value
        cacheItem.labelNamesResolver = Array.from(new Set(resolvedLabels));
        //return resolvedLabels; // This is optional, depending on whether you need the resolved values for something else
    } catch {
        console.log(`Error updating ShellCache[${key}]`);
    }
  });

  await Promise.all(allPromises);
  return ShellCached;
  //return allResolved.filter((resolved) => resolved !== undefined)
}