import {CompletionItem, CompletionItemKind} from "vscode-languageserver"
import {FishCompletionItem, FishCompletionItemKind} from "./completion-strategy";
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

function badBuiltin(word: string) {
    return ['.', ':'].includes(word)
}

//export const ShellCachedItem = {
//    ABBR: {
//        command: 'abbr --list',
//        completionKind: CompletionItemKind.Snippet,
//        fishKind: FishCompletionItemKind.ABBR,
//        type: ShellCachedItemType.abbr,
//    },
//    BUILTIN: {
//        command: 'builtin --names',
//        completionKind: CompletionItemKind.Function,
//        fishKind: FishCompletionItemKind.BUILTIN,
//        type: ShellCachedItemType.builtin,
//    },
//    FUNCTION: {
//        command: 'functions --names | string collect',
//        completionKind: CompletionItemKind.Function,
//        fishKind: FishCompletionItemKind.FUNCTION,
//        type: ShellCachedItemType.function,
//    },
//    VARIABLE: {
//        command: 'set --names',
//        completionKind: CompletionItemKind.Variable,
//        fishKind: FishCompletionItemKind.VARIABLE,
//        type: ShellCachedItemType.variable,
//    },
//    EVENT: {
//        command: `functions --handlers | string match -vr '^Event \\w+'`,
//        completionKind: CompletionItemKind.Event,
//        fishKind: FishCompletionItemKind.EVENT,
//        type: ShellCachedItemType.event,
//    }
//} as const