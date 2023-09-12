//import { CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import { enrichToCodeBlockMarkdown } from '../documentation';
import { FishCompletionItem, toCompletionKind } from './completion-strategy';
import { execCmd } from './exec';

const FishCompletionItemConfig = {
    ABBR: { isCommand: true },
    BUILTIN: { isCommand: true },
    FUNCTION: { isCommand: true },
    VARIABLE: { isCommand: true },
    EVENT: { isCommand: true },
    PIPE: { isCommand: false },
    ESC_CHARS: { isCommand: false },
    STATUS: { isCommand: false },
    WILDCARD: { isCommand: false },
    COMMAND: { isCommand: false },
    REGEX: { isCommand: false },
    COMBINER: { isCommand: false },
    FORMAT_STR: { isCommand: false },
    STATEMENT: { isCommand: false },
    ARGUMENT: { isCommand: false },
    EMPTY: { isCommand: false },
} as const; // "as const" is to make sure TypeScript treats this as an immutable object

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
    EMPTY = "empty",
}
export namespace FishCompletionItemKind {
    export function enums(): FishCompletionItemKind[] {
        return Object.values(FishCompletionItemKind)
            .filter((value): value is FishCompletionItemKind => typeof value === "string");
    }
}

// Step 3: Generate the CommandItemKinds type from the entries where isCommand is true
type CommandItemKinds = keyof typeof FishCompletionItemConfig & (typeof FishCompletionItemConfig[keyof typeof FishCompletionItemConfig]['isCommand'] extends true ? string : never);
const commandItems: Record<CommandItemKinds, string> = {
    ABBR: "abbr --list", 
    BUILTIN: "builtin --names",
    FUNCTION: "functions --names | string collect",
    VARIABLE: "set --names",
    EVENT: "functions --handlers | string match -vr '^Event \\w+' | string split -f1 ' '",
};

type CacheMap = Map<FishCompletionItemKind, CachedItem>

export class ShellItems {
    private cache: CacheMap = createCacheMap();

    private async initCommands() {
        await Promise.all(Object.entries(commandItems).map(async ([kind, cmd]) => {
            const labels = await execCmd(cmd);
            const current = this.cache.get(kind as FishCompletionItemKind)!
            current.setLabels(labels)
            this.cache.set(kind as FishCompletionItemKind, current)
        }))
    }
    
    private async initSimpleItems() {


    }
    
    
    async init() {
        await this.initCommands();
    }


}



export class CachedItem {
    public labels: string[] = []
    public items: FishCompletionItem[] = []
    public completionKind: CompletionItemKind = CompletionItemKind.Text
    public fishCompletionKind: FishCompletionItemKind = FishCompletionItemKind.EMPTY
    public finished: boolean = false
    setLabels(labels: string[]) {
        this.labels = labels;
        return this
    }
    filterLabels(removeLabels: string[]) {
        this.labels = this.labels.filter((label) => !removeLabels.includes(label));
        return this
    }
    setFinished() {
        this.finished = true;
        return this
    }
}

export namespace CachedItem {
    export function empty() {
        return new CachedItem();
    }
}

export function createCacheMap() {
    const cache: CacheMap = new Map();
    for (const kind of FishCompletionItemKind.enums()) {
        cache.set(kind, CachedItem.empty());
    }
    return cache;
}