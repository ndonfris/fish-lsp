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
            IBuilder.createStatic(StaticItems.Combiners, FishCompletionItemKind.COMBINER),
            IBuilder.createStatic(StaticItems.Statements, FishCompletionItemKind.STATEMENT),
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
        const commandItems = this.getValueByKind(FishCompletionItemKind.COMMAND) as AllItemBuilder

        const aliasBuilder = IBuilder.createStatic(commandItems.setupAlias(), FishCompletionItemKind.ALIAS)
        this.setBuilder(aliasBuilder)
        Promise.resolve(aliasBuilder.build())

        const notCommands: string[] = [
            ...this.getValueByKind(FishCompletionItemKind.BUILTIN)!.getAllLabels(),
            ...this.getValueByKind(FishCompletionItemKind.FUNCTION)!.getAllLabels(),
        ]
        commandItems.remove(...notCommands)
        this.getValueByKind(FishCompletionItemKind.FUNCTION)?.remove(...aliasBuilder.getAllLabels())
    }

    getValueByKind(kind: FishCompletionItemKind) {
        return this.cache.get(kind)
    }

    getItemsByKind(kind: FishCompletionItemKind) {
        let result = new Array<FishCompletionItem>()
        let found = this.getValueByKind(kind)
        if (found && found.finished) result.push(...found.items)
        return result
    }

    getLabelsByKind(kind: FishCompletionItemKind) {
        let result = new Array<string>()
        let found = this.getValueByKind(kind)
        if (found && found.finished) result = Array.from(found.labels)
        return result
    }

    hasItem(label: string, kind: FishCompletionItemKind[] = this.keys()) {
        for (const k of kind) {
            const builder = this.getLabelsByKind(k)
            if (builder.includes(label)) return true
        }
        return false
    }

    getItemByLabel(label: string, kind: FishCompletionItemKind[] = this.keys()) {
        for (const k of kind) {
            const res = this.getItemsByKind(k).find((item) => item.label.trim() === label);
            if (res) return res
        }
        return undefined
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
    protected removeItemAndLabel(label: string, index: number) {
        this.items.splice(index, 1)
        this.labels.delete(label)
    }
    protected addItem(item: FishCompletionItem) {
        this.items.push(item)
        this.labels.add(item.label)
    }
    public getAllLabels() {
        return [
            ...Array.from(this.labels),
            ...this.skipLabels
        ] 
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
        lines.forEach((line) => {
            const { label, value } = splitLine(line)
            if (this.skipLabels.includes(label)) return
            const detail = getCommandsDetail(value || `${this.fishCompletionKind}`)
            const item = FishCompletionItem.create(label, detail, line, this.fishCompletionKind)
            this.addItem(item)
        })
        this.update()
        this.finished = true
        return this
    }
}
export class AllItemBuilder extends CommandItemBuilder {
    private isBuilt: boolean = false
    constructor(command: string, kind: FishCompletionItemKind) {
        super(command, kind)
        return this
    }
    public async build() {
        await super.build()
        this.isBuilt = true
        this.finished = false
        return this
    }
    public setupAlias() {
        const alias: FishStaticResolvedCompletionItem[] = [];
        this.items
            .filter((item) => item.detail === "alias")
            .forEach((item, index) => {
                const newItem = FishCompletionItem.create(
                    item.label,
                    item.detail,
                    item.documentation,
                    FishCompletionItemKind.ALIAS
                );
                alias.push(newItem as FishStaticResolvedCompletionItem);
                this.removeItemAndLabel(item.label, index);
            });
        if (this.isBuilt) this.finished = true;
        return alias
    }
}
export class StaticItemBuilder extends CachedItemBuilder {
    constructor(items: FishStaticCompletionItem[] | FishStaticResolvedCompletionItem[], kind: FishCompletionItemKind) {
        super(kind)
        this.items = items;
        this.labels = new Set(items.map(item => item.label))
        return this
    }
}
export namespace IBuilder {
    export function createCommand(command: string, kind: FishCompletionItemKind) {
        return new CommandItemBuilder(command, kind)
    }
    export function createStatic(items: FishStaticCompletionItem[] | FishStaticResolvedCompletionItem[], kind: FishCompletionItemKind) {
        return new StaticItemBuilder(items, kind)
    }
    export function createAllCommands(command: string, kind: FishCompletionItemKind) {
        return new AllItemBuilder(command, kind)
    }
}