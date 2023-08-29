import { CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import { FishCompletionItem } from './completion-strategy';
import { execCmd } from './exec';

export enum ShellItemType {
    abbr = 'abbr',
    function = 'function',
    variable = 'variable',
    eventHandler = 'eventHandler',
    builtin = 'builtin',
} 

export const SetupShellCommands = {
    [ShellItemType.abbr]: `abbr | string split " -- " -f2 | string unescape`,
    [ShellItemType.function]: `functions --names | string collect`,
    [ShellItemType.variable]: `set -n`,
    [ShellItemType.eventHandler]: `functions --handlers | string match -vr '^Event \\w+'`,
    [ShellItemType.builtin]: `builtin -n`,
}

export type ShellItemsKey = keyof typeof ShellItemType
export class ShellItems {
    private _items: { [key in ShellItemType]?: CompletionItem[] } = {}

    async init() {
        await Promise.all([
            execCmd(SetupShellCommands[ShellItemType.abbr]),
            execCmd(SetupShellCommands[ShellItemType.function]),
            execCmd(SetupShellCommands[ShellItemType.variable]),
            execCmd(SetupShellCommands[ShellItemType.eventHandler]),
            execCmd(SetupShellCommands[ShellItemType.builtin])
        ]).then(([abbrs, funcs, vars, handlers, builtins]) => {
            this._items.abbr = createItemArray(abbrs, ShellItemType.abbr)
            this._items.function = createItemArray(funcs, ShellItemType.function)
            this._items.variable = createItemArray(vars, ShellItemType.variable)
            this._items.eventHandler = createItemArray(handlers, ShellItemType.eventHandler)
            this._items.builtin = createItemArray(builtins, ShellItemType.builtin)
        })
    }

    getAllItemsOfType(type: ShellItemsKey): CompletionItem[] {
        return this._items[type] || []
    }

    getItemType(name: string) : ShellItemType | undefined {
        for (let type of this.keys()) {
            if (this._items[type]?.find((item) => item.label === name)) {
                return type as ShellItemType
            }
        }
    }

    keys(): ShellItemsKey[] {
        let result: ShellItemsKey[] = []
        for (let type in this._items) {
            result.push(type as keyof typeof ShellItemType)
        }
        return result
    }
}

function createItemArray(lines: string[], type: ShellItemType): CompletionItem[] {
    return lines.map((line) => {
        switch (type) {
            case ShellItemType.abbr:
                let [name, ...output] = line.split(' ');
                let [replacement, comment] = output.join(' ').trim().split('# ');
                let doc = comment ? [`# ${comment}`, replacement].join('\n') : replacement;
                return {
                    label: name,
                    kind: CompletionItemKind.Text,
                    documentation: {
                        kind: 'markdown',
                        value: [
                            '```fish',
                            doc,
                            '```'
                        ].join('\n'),
                    },
                    insertText: replacement,
                    commitCharacters: [' ', '\t', '\n']
                }
            case ShellItemType.eventHandler:
                let [event, ...handler] = line.split(' ');
                let handlerCaller = handler.join(' ');
                return {
                    label: event,
                    kind: CompletionItemKind.Text,
                    documentation: {
                        kind: 'markdown',
                        value: [
                            '```fish',
                            handlerCaller,
                            '```'
                        ].join('\n'),
                    }
                }
            default: 
                return CompletionItem.create(line) 
        }
    })
}
// 