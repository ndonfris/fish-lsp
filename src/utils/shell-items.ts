//import { CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { enrichToCodeBlockMarkdown } from '../documentation';
//import { FishCompletionItem, toCompletionKind } from './completion-strategy';
import { execCmd } from './exec';
import { FishCompletionItem, FishStaticCompletionItem, FishCompletionItemKind, toCompletionItemKind, FishCommandCompletionItem, FishStaticResolvedCompletionItem } from './completion-types';
import { StaticItems } from './static-completions';


export class ShellItems {
    private cache: Map<FishCompletionItemKind, CachedItemBuilder>;

    constructor() {
        this.cache = new Map<FishCompletionItemKind, CachedItemBuilder>();
        this.initItems();
    }
     
    private initItems() {
        [
            IBuilder.createCommand("abbr --show | string split ' -- ' -m1 -f2 | string unescape",     FishCompletionItemKind.ABBR),
            IBuilder.createCommand("builtin --names", FishCompletionItemKind.BUILTIN).setSkipLabels(':', '.'),
            IBuilder.createCommand("functions --all --names | string collect", FishCompletionItemKind.FUNCTION),
            IBuilder.createCommand("set --names", FishCompletionItemKind.VARIABLE),
            IBuilder.createCommand("functions --handlers | string match -vr '^Event \\w+'", FishCompletionItemKind.EVENT),
            IBuilder.createStatic(StaticItems.Pipes, FishCompletionItemKind.PIPE),
            IBuilder.createStatic(StaticItems.EscapedChars, FishCompletionItemKind.ESC_CHARS),
            IBuilder.createStatic(StaticItems.StatusNumbers, FishCompletionItemKind.STATUS),
            IBuilder.createStatic(StaticItems.FormatStrings, FishCompletionItemKind.FORMAT_STR),
            IBuilder.createStatic(StaticItems.StringRegex, FishCompletionItemKind.REGEX),
            IBuilder.createStaticResolved(StaticItems.Combiners, FishCompletionItemKind.COMBINER),
            IBuilder.createStaticResolved(StaticItems.Statements, FishCompletionItemKind.STATEMENT),
            // IBuilder.createSimple([], FishCompletionItemKind.ARGUMENT))
            //ShellItemsBuilder.createSimple(WildcardItems, FishCompletionItemKind.WILDCARD))
            IBuilder.createAllCommands(`builtin complete --escape -C ''`, FishCompletionItemKind.COMMAND),
        ].forEach((builder) => this.setBuilder(builder))
    }

    private setBuilder(builder: CachedItemBuilder) {
        this.cache.set(builder.fishCompletionKind, builder)
    }


    keys() { return Array.from(this.cache.keys()) }
    values() { return Array.from( this.cache.values()) }
    entries(){ return Array.from(this.cache) }

    async initialize() {
        await Promise.all(
            this.values().map(async (builder) => await builder.build())
        );
        const commandItems = this.getItemsByKind(FishCompletionItemKind.COMMAND) as AllItemBuilder

        const aliasBuilder = IBuilder.createStaticResolved(commandItems.setupAlias(), FishCompletionItemKind.ALIAS)
        this.setBuilder(aliasBuilder)
        Promise.resolve(aliasBuilder.build())

        const notCommands: string[] = [
            ...this.getLabelsByKind(FishCompletionItemKind.BUILTIN),
            ...this.getLabelsByKind(FishCompletionItemKind.FUNCTION)
        ]
        commandItems.remove(...notCommands)
        this.getItemsByKind(FishCompletionItemKind.FUNCTION)?.remove(...Array.from(aliasBuilder.labels))
    }

    getItemsByKind(kind: FishCompletionItemKind) {
        return this.cache.get(kind)
    }

    getLabelsByKind(kind: FishCompletionItemKind) {
        let result = new Array<string>()
        let found = this.getItemsByKind(kind)
        if (found && found.finished) {
            result = Array.from(found.labels)
        }
        return result
    }

    hasItem(label: string, kind: FishCompletionItemKind[] = this.keys()) {
        for (const k of kind) {
            const builder = this.getItemsByKind(k)
            if (builder?.labels.has(label)) return true
        }
        return false
    }

}


export class CachedItemBuilder {
    labels: Set<string>
    items: FishCompletionItem[]
    completionKind: CompletionItemKind
    fishCompletionKind: FishCompletionItemKind
    command: string | undefined
    finished: boolean
    protected skipLabels: string[] = new Array<string>()
    constructor(kind: FishCompletionItemKind) {
        this.fishCompletionKind = kind
        this.completionKind = toCompletionItemKind[kind]
        this.command = undefined;
        this.labels = new Set<string>()
        this.items = new Array<FishCompletionItem>()
        this.finished = false
        return this
    }
    public setSkipLabels(...labels: string[]) {
        this.skipLabels = labels
        return this
    }
    public update() {
        if (!this.skipLabels.length) return this
        for (const label of this.skipLabels) {
            this.items = this.items.filter((item) => item.label !== label);
            this.labels.delete(label);
        }
        return this
    }
    public async build() {
        this.update()
        for (const item of this.items) {
            item.setKinds(this.fishCompletionKind)
        }
        this.finished = true
        return this
    }
    public remove(...labels: string[]) {
        for (const label of labels) {
            this.items = this.items.filter((item) => item.label !== label);
            this.labels.delete(label);
        }
        return this
    }
}

function splitLine(line: string): { label: string, value?: string } {
    const [label, ...rest] = line.split(/\s+/)
    const value = rest.length ? rest.join(' ') : undefined;
    return { label, value };
}

function getCommandsDetail(value: string) {
    if (value.trim().length === 0) return 'command';
    if (value.startsWith('alias')) return 'alias';
    if (value === 'command link') return 'command';
    if (value === 'command') return 'command';
    return value
}

export class CommandItemBuilder extends CachedItemBuilder {
    constructor(command: string, kind: FishCompletionItemKind) {
        super(kind)
        this.command = command
        return this
    }
    public async build() {
        const lines = await execCmd(this.command!)
        for (const line of lines) {
            const { label } = splitLine(line)
            if (this.skipLabels.includes(label)) continue
            const item = new FishCommandCompletionItem(label, `${this.fishCompletionKind}`, line)
            item.setKinds(this.fishCompletionKind)
            this.labels.add(label)
            this.items.push(item)
        }
        this.update()
        this.finished = true
        return this
    }
}

export class AllItemBuilder extends CachedItemBuilder {
    private isBuilt: boolean = false
    constructor(command: string, kind: FishCompletionItemKind) {
        super(kind)
        this.command = command
        return this
    }
    public async build() {
        const lines = await execCmd(this.command!)
        for (const line of lines) {
            const { label, value } = splitLine(line)
            if (this.skipLabels.includes(label)) continue
            this.labels.add(label)
            const detail = getCommandsDetail(value || `${this.fishCompletionKind}`)
            const item = new FishCommandCompletionItem(label, detail, line)
            item.setKinds(this.fishCompletionKind)
            this.items.push(item)
        }
        this.update()
        this.isBuilt = true
        return this
    }

    public setupAlias() {
        const alias: FishStaticResolvedCompletionItem[] = [];
        this.items.forEach((item, index) => {
            if (item.detail === 'alias') {
                const newItem = new FishStaticResolvedCompletionItem(item.label, item.detail, item.documentation as string)
                newItem.setKinds(FishCompletionItemKind.ALIAS)
                alias.push(newItem)
                this.items.splice(index, 1)
                this.labels.delete(item.label)
            }
        })
        if (this.isBuilt) this.finished = true
        return alias
    }
}

export class StaticItemBuilder extends CachedItemBuilder {
    constructor(items: FishStaticCompletionItem[], kind: FishCompletionItemKind) {
        super(kind)
        this.items = items as FishCompletionItem[]
        this.labels = new Set(items.map(item => item.label))
        return this
    }
}
export class StaticResolvedItemBuilder extends CachedItemBuilder {
    constructor(items: FishStaticResolvedCompletionItem[], kind: FishCompletionItemKind) {
        super(kind)
        this.items = items as FishStaticResolvedCompletionItem[];
        this.labels = new Set(items.map(item => item.label))
        return this
    }
}

export namespace IBuilder {
    export function createCommand(command: string, kind: FishCompletionItemKind) {
        return new CommandItemBuilder(command, kind)
    }
    export function createStatic(items: FishStaticCompletionItem[], kind: FishCompletionItemKind) {
        return new StaticItemBuilder(items, kind)
    }
    export function createAllCommands(command: string, kind: FishCompletionItemKind) {
        return new AllItemBuilder(command, kind)
    }
    export function createStaticResolved(items: FishStaticResolvedCompletionItem[], kind: FishCompletionItemKind) {
        return new StaticResolvedItemBuilder(items, kind)
    }
}