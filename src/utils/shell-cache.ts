import {CompletionItem, CompletionItemKind} from "vscode-languageserver"
//import {FishCompletionItem, FishCompletionItemKind} from "./completion-strategy";
import { FishCompletionItem, FishCompletionItemKind } from "./completion-types"
import { execCmd } from './exec';
import { StaticItems } from './static-completions';

type ItemMapRecord = Record<FishCompletionItemKind, FishCompletionItem[]>
export class CompletionItemMap {
    constructor(
        private _items: ItemMapRecord = {} as ItemMapRecord
    ) {}
    static async initialize(): Promise<CompletionItemMap> {
        const result: ItemMapRecord = {} as ItemMapRecord
        const cmdOutputs: Map<FishCompletionItemKind, string[]> = new Map()
        const topLevelLabels: Set<string> = new Set()
        await Promise.all(SetupItemsFromCommandConfig.map(async (item) => {
            const stdout = await execCmd(item.command)
            cmdOutputs.set(item.fishKind, stdout)
        }))
        SetupItemsFromCommandConfig.forEach((item) => {
            const items: FishCompletionItem[] = []
            const stdout = cmdOutputs.get(item.fishKind)!
            stdout.forEach((line) => {
                if (line.trim().length === 0) return
                const {label, value} = splitLine(line)
                if (item.topLevel) {
                    if (topLevelLabels.has(label)) return
                    topLevelLabels.add(label)
                }
                const detail = getCommandsDetail(value || item.detail)
                items.push(FishCompletionItem.create(label, item.fishKind, detail, line))
            })
            result[item.fishKind] = items
        })
        Object.entries(StaticItems).forEach(([key, value]) => {
            const kind = key as FishCompletionItemKind
            if (!result[kind]) {
                result[kind] = value.map((item) => FishCompletionItem.create(
                    item.label,
                    kind,
                    item.detail,
                    item.documentation,
                    item.examples
                ));
            }
        })
        return new CompletionItemMap(result)
    }
    get(kind: FishCompletionItemKind): FishCompletionItem[] {
        return this._items[kind] || []
    }
    get allKinds(): FishCompletionItemKind[] {
        return Object.keys(this._items) as FishCompletionItemKind[]
    }
    allOfKinds(...kinds: FishCompletionItemKind[]): FishCompletionItem[] {
        return kinds.reduce((acc, kind) => acc.concat(this.get(kind)), [] as FishCompletionItem[])
    }
    entries(): [FishCompletionItemKind, FishCompletionItem[]][] {
        return Object.entries(this._items) as [FishCompletionItemKind, FishCompletionItem[]][]
    }
    forEach(callbackfn: (key: FishCompletionItemKind, value: FishCompletionItem[]) => void) {
        this.entries().forEach(([key, value]) => callbackfn(key, value))
    }
    allCompletionsWithoutCommand() {
        return this.allOfKinds(
            FishCompletionItemKind.ABBR,
            FishCompletionItemKind.ALIAS,
            FishCompletionItemKind.BUILTIN,
            FishCompletionItemKind.FUNCTION,
            FishCompletionItemKind.COMMAND,
            FishCompletionItemKind.VARIABLE,
        )
    }
    findLabel(label: string, ...searchKinds: FishCompletionItemKind[]): FishCompletionItem | undefined {
        let kinds: FishCompletionItemKind[] = searchKinds?.length > 0 ? searchKinds : this.allKinds
        for (const kind of kinds) {
            const item = this.get(kind).find((item) => item.label === label)
            if (item) return item
        }
        return undefined
    }
}

type SetupItem = {
    command: string,
    detail: string,
    fishKind: FishCompletionItemKind,
    topLevel: boolean,
}
const SetupItemsFromCommandConfig: SetupItem[] = [
    {
        command: "abbr --show | string split ' -- ' -m1 -f2 | string unescape",
        detail: "Abbreviation",
        fishKind: FishCompletionItemKind.ABBR,
        topLevel: true,
    },
    {
        command: "builtin --names",
        detail: "Builtin",
        fishKind: FishCompletionItemKind.BUILTIN,
        topLevel: true,
    },
    {
        command: "alias | string collect | string unescape | string split ' ' -m1 -f2",
        detail: "Alias",
        fishKind: FishCompletionItemKind.ALIAS,
        topLevel: true,
    },
    {
        command: "functions --all --names | string collect",
        detail: "Function",
        fishKind: FishCompletionItemKind.FUNCTION,
        topLevel: true,
    },
    {
        //command: "path filter -fx $PATH/* | path basename",
        //command: "bash -c 'compgen -c | sort -u | uniq'",
        //command: "path filter -fx $PATH/* | path sort -u | path basename",
        //command: "path sort --unique --key=basename $PATH/* | path basename",
        //command: "path filter -fx $PATH/* | path sort -u | path basename",
        command: `complete -C ''`,
        detail: "Command",
        fishKind: FishCompletionItemKind.COMMAND,
        topLevel: true,
    },
    {
        command: "set --names",
        detail: "Variable",
        fishKind: FishCompletionItemKind.VARIABLE,
        topLevel: false,
    },
    {
        command: "functions --handlers | string match -vr '^Event \\w+'",
        detail: "Event Handler",
        fishKind: FishCompletionItemKind.EVENT,
        topLevel: false,
    },
]

function splitLine(line: string): { label: string, value?: string } {
    const [label, ...rest] = line.split(/\s/, 2)
    const value = rest.length > 0 ? rest.join(' ') : undefined;
    return { label, value };
}

function getCommandsDetail(value: string) {
    if (value.trim().length === 0) return 'command';
    if (value.startsWith('alias')) return 'alias';
    if (value === 'command link') return 'command';
    if (value === 'command') return 'command';
    return value
}

export type ItemMap = Map<FishCompletionItemKind, FishCompletionItem[]>

export async function createSetupItemsFromCommands(): Promise<Map<FishCompletionItemKind, FishCompletionItem[]>> {
    const result: Map<FishCompletionItemKind, FishCompletionItem[]> = new Map()
    const cmdOutputs: Map<FishCompletionItemKind, string[]> = new Map()
    const topLevelLabels: Set<string> = new Set()
    await Promise.all(SetupItemsFromCommandConfig.map(async (item) => {
        const stdout = await execCmd(item.command)
        cmdOutputs.set(item.fishKind, stdout)
    }))
    SetupItemsFromCommandConfig.forEach((item) => {
        const items: FishCompletionItem[] = []
        const stdout = cmdOutputs.get(item.fishKind)!
        stdout.forEach((line) => {
            if (line.trim().length === 0) return
            const {label, value} = splitLine(line)
            if (item.topLevel) {
                if (topLevelLabels.has(label)) return
                topLevelLabels.add(label)
            }
            const detail = getCommandsDetail(value || item.detail)
            items.push(FishCompletionItem.create(label, item.fishKind, detail, line))
        })
        result.set(item.fishKind, items)
    })
    Object.entries(StaticItems).forEach(([key, value]) => {
        const kind = key as FishCompletionItemKind
        if (!result.has(kind)) {
            result.set(kind, value.map((item) => FishCompletionItem.create(
                item.label,
                kind,
                item.detail,
                item.documentation,
                item.examples
            )));
        }
    })
    return result
}