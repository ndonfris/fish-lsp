//import { CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { enrichToCodeBlockMarkdown } from '../documentation';
import { FishCompletionItem, toCompletionKind } from './completion-strategy';
import { execCmd } from './exec';
import { CombinerCompletionItems, EscapeCharItems, FishSimpleCompletionItem, FormatSpecifierCompletionItems, PipeItems, StatementCompletionItems, StatusNumbers, StringRegexExpressions, WildcardItems } from './completion-types';

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
    ALIAS = "alias",
    REGEX = "regex",
    COMBINER = "combiner",
    FORMAT_STR = "format_str",
    STATEMENT = "statement",
    ARGUMENT = "argument",
    EMPTY = "empty",
}
export const toCompletionItemKind: Record<FishCompletionItemKind, CompletionItemKind> = {
    [FishCompletionItemKind.ABBR]: CompletionItemKind.Snippet,
    [FishCompletionItemKind.BUILTIN]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.FUNCTION]: CompletionItemKind.Function,
    [FishCompletionItemKind.VARIABLE]: CompletionItemKind.Variable,
    [FishCompletionItemKind.EVENT]: CompletionItemKind.Event,
    [FishCompletionItemKind.PIPE]: CompletionItemKind.Operator,
    [FishCompletionItemKind.ESC_CHARS]: CompletionItemKind.Operator,
    [FishCompletionItemKind.STATUS]: CompletionItemKind.EnumMember,
    [FishCompletionItemKind.WILDCARD]: CompletionItemKind.Operator,
    [FishCompletionItemKind.COMMAND]: CompletionItemKind.Class,
    [FishCompletionItemKind.ALIAS]: CompletionItemKind.Constructor,
    [FishCompletionItemKind.REGEX]: CompletionItemKind.Operator,
    [FishCompletionItemKind.COMBINER]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.FORMAT_STR]: CompletionItemKind.Operator,
    [FishCompletionItemKind.STATEMENT]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.ARGUMENT]: CompletionItemKind.Property,
    [FishCompletionItemKind.EMPTY]: CompletionItemKind.Text,
}


export class ShellItems {
    private cache: Map<FishCompletionItemKind, CachedItemBuilder>;

    constructor() {
        this.cache = new Map<FishCompletionItemKind, CachedItemBuilder>();
        this.initItems();
    }
     
    private initItems() {
        this.cache.set(FishCompletionItemKind.ABBR,        IBuilder.createCommand("abbr --show | string split ' -- ' -m1 -f2 | string unescape",     FishCompletionItemKind.ABBR))
        this.cache.set(FishCompletionItemKind.BUILTIN,     IBuilder.createCommand("builtin --names", FishCompletionItemKind.BUILTIN).setSkipLabels(':', '.'))
        this.cache.set(FishCompletionItemKind.FUNCTION,    IBuilder.createCommand("functions --all --names | string collect", FishCompletionItemKind.FUNCTION))
        this.cache.set(FishCompletionItemKind.VARIABLE,    IBuilder.createCommand("set --names", FishCompletionItemKind.VARIABLE))
        this.cache.set(FishCompletionItemKind.EVENT,       IBuilder.createCommand("functions --handlers | string match -vr '^Event \\w+'", FishCompletionItemKind.EVENT))
        this.cache.set(FishCompletionItemKind.PIPE,        IBuilder.createSimple(PipeItems, FishCompletionItemKind.PIPE))
        this.cache.set(FishCompletionItemKind.ESC_CHARS,   IBuilder.createSimple(EscapeCharItems, FishCompletionItemKind.ESC_CHARS))
        this.cache.set(FishCompletionItemKind.STATUS,      IBuilder.createSimple(StatusNumbers, FishCompletionItemKind.STATUS))
        this.cache.set(FishCompletionItemKind.COMBINER,    IBuilder.createSimple(CombinerCompletionItems, FishCompletionItemKind.COMBINER))
        this.cache.set(FishCompletionItemKind.FORMAT_STR,  IBuilder.createSimple(FormatSpecifierCompletionItems, FishCompletionItemKind.FORMAT_STR))
        this.cache.set(FishCompletionItemKind.STATEMENT,   IBuilder.createSimple(StatementCompletionItems, FishCompletionItemKind.STATEMENT))
        this.cache.set(FishCompletionItemKind.REGEX,       IBuilder.createSimple(StringRegexExpressions, FishCompletionItemKind.REGEX))
        //this.cache.set(FishCompletionItemKind.ARGUMENT,    IBuilder.createSimple([], FishCompletionItemKind.ARGUMENT))
        //this.cache.set(FishCompletionItemKind.WILDCARD,   ShellItemsBuilder.createSimple(WildcardItems, FishCompletionItemKind.WILDCARD))
        this.cache.set(FishCompletionItemKind.COMMAND,     IBuilder.createAllCommands(`builtin complete --escape -C ''`, FishCompletionItemKind.COMMAND))
    }

    keys() { return Array.from(this.cache.keys()) }
    values() { return Array.from( this.cache.values()) }
    entries(){ return Array.from(this.cache) }

    async initialize() {
        await Promise.all(
            this.values().map(async (builder) => await builder.build())
        );
        const commandItems = this.getItemsByKind(FishCompletionItemKind.COMMAND) as AllItemBuilder
        const notCommands: string[] = [
            ...this.getLabelsByKind(FishCompletionItemKind.BUILTIN),
            ...this.getLabelsByKind(FishCompletionItemKind.FUNCTION)
        ]
        commandItems.remove(...notCommands)
        const aliasItems = commandItems.setupAlias()

        this.cache.set(FishCompletionItemKind.ALIAS, IBuilder.createSimple(aliasItems, FishCompletionItemKind.ALIAS))
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
    items: CompletionItem[]
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
    const [label, ...rest] = line.split(/\s+/g,2)
    const value = rest.length ? rest.join(' ') : undefined;
    return { label, value };
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
            const { label, value } = splitLine(line)
            if (this.skipLabels.includes(label)) continue
            this.labels.add(label)
            //this.items.push()
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
            //this.items.push()
        }
        this.update()
        this.isBuilt = true
        return this
    }

    public setupAlias() {
        const alias: FishSimpleCompletionItem[] = [];
        this.items.forEach((item, index) => {
            if (!item.documentation) return;
            const doc = item.documentation.toString() 
            if (doc.startsWith('alias')) {
                alias.push({
                    label: item.label,
                    detail: 'alias',
                    documentation: doc
                } as FishSimpleCompletionItem)
                this.items.splice(index, 1)
                this.labels.delete(item.label)
            }
        })
        if (this.isBuilt) this.finished = true
        return alias
    }
}

export class SimpleItemBuilder extends CachedItemBuilder {
    constructor(items: FishSimpleCompletionItem[], kind: FishCompletionItemKind) {
        super(kind)
        this.items = items as CompletionItem[]
        this.labels = new Set(items.map(item => item.label))
        return this
    }
}
export namespace IBuilder {
    export function createCommand(command: string, kind: FishCompletionItemKind) {
        return new CommandItemBuilder(command, kind)
    }

    export function createSimple(items: FishSimpleCompletionItem[], kind: FishCompletionItemKind) {
        return new SimpleItemBuilder(items, kind)
    }
    export function createAllCommands(command: string, kind: FishCompletionItemKind) {
        return new AllItemBuilder(command, kind)
    }
}