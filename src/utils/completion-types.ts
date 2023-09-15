import { homedir } from "os";
import {
    Command,
    CompletionItem,
    CompletionItemKind,
    CompletionItemLabelDetails,
    InsertReplaceEdit,
    InsertTextFormat,
    InsertTextMode,
    MarkupContent,
    RemoteConsole,
    TextEdit,
} from "vscode-languageserver";
import {
    enrichCommandArg,
    enrichToCodeBlockMarkdown,
    enrichToMarkdown,
} from "../documentation";
//import {  } from "./completion-strategy";
import { execCommandDocs, execCommandType, getGloablVariable } from "./exec";
import { getAbbrDocString, getAliasDocString, getBuiltinDocString, getCommandDocString, getEventHandlerDocString, getFunctionDocString, getStaticDocString, getVariableDocString } from './documentationCache';
import { CompletionExample } from './static-completions';

export const FishCompletionItemKind = {
    ABBR: "abbr",
    BUILTIN: "builtin",
    FUNCTION: "function",
    VARIABLE: "variable",
    EVENT: "event",
    PIPE: "pipe",
    ESC_CHARS: "esc_chars",
    STATUS: "status",
    WILDCARD: "wildcard",
    COMMAND: "command",
    ALIAS: "alias",
    REGEX: "regex",
    COMBINER: "combiner",
    FORMAT_STR: "format_str",
    STATEMENT: "statement",
    ARGUMENT: "argument",
    EMPTY: "empty",
} as const;
export type FishCompletionItemKind = typeof FishCompletionItemKind[keyof typeof FishCompletionItemKind]

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

export interface FishCompletionItem extends CompletionItem {
    detail: string;
    documentation: string;
    fishKind: FishCompletionItemKind;
    examples?: CompletionExample[];
    setKinds(kind: FishCompletionItemKind): FishCompletionItem;
}

export class FishCompletionItem implements FishCompletionItem {
    constructor(
        public label: string,
        public fishKind: FishCompletionItemKind,
        public detail: string,
        public documentation: string,
        public examples?: CompletionExample[]
    ) {
        this.setKinds(fishKind)
    }

    setKinds(kind: FishCompletionItemKind) {
        this.kind = toCompletionItemKind[kind];
        this.fishKind = kind;
        return this
    }
}

export class FishCommandCompletionItem extends FishCompletionItem {
    constructor(label: string, fishKind: FishCompletionItemKind, detail: string, documentation: string) {
        super(label, fishKind, detail, documentation)
    }
}

export class FishAbbrCompletionItem extends FishCommandCompletionItem {
    constructor(label: string, detail: string, documentation: string) {
        super(label, FishCompletionItemKind.ABBR, detail, documentation)
        this.insertText = documentation.slice(label.length + 1, documentation.lastIndexOf('#'))
        this.commitCharacters = ['\t', ';', ' ']
    }
}

export class FishAliasCompletionItem extends FishCommandCompletionItem {
    constructor(label: string, detail: string, documentation: string) {
        super(label, FishCompletionItemKind.ALIAS, detail, documentation)
        this.documentation = documentation.slice(label.length + 1)
    }
}

export namespace FishCompletionItem {
    export function create(label: string, kind: FishCompletionItemKind, detail: string, documentation: string, examples?: CompletionExample[]) {
        switch (kind) {
            case FishCompletionItemKind.ABBR:
                return new FishAbbrCompletionItem(label, detail, documentation)
            case FishCompletionItemKind.ALIAS:
                return new FishAliasCompletionItem(label, detail, documentation)
            case FishCompletionItemKind.COMMAND:
            case FishCompletionItemKind.BUILTIN:
            case FishCompletionItemKind.FUNCTION:
            case FishCompletionItemKind.VARIABLE:
            case FishCompletionItemKind.EVENT:
                return new FishCommandCompletionItem(label, kind, detail, documentation)
            default:
                return new FishCompletionItem(label, kind, detail, documentation, examples)
        }
    }

}

export async function getDocumentationResolver(item: FishCompletionItem): Promise<MarkupContent> {
    let docString: string = '';
    switch (item.fishKind) {
        case FishCompletionItemKind.ABBR:
            docString = await getAbbrDocString(item.label) || item.documentation
            break;
        case FishCompletionItemKind.ALIAS:
            const doc = item.documentation || `alias ${item.label}`
            docString = await getAliasDocString(item.label, doc) || item.documentation
            break;
        case FishCompletionItemKind.COMBINER:
        case FishCompletionItemKind.STATEMENT:
        case FishCompletionItemKind.BUILTIN:
            docString = await getBuiltinDocString(item.label) || item.documentation
            break;
        case FishCompletionItemKind.COMMAND:
            docString = await getCommandDocString(item.label) || item.documentation
            break;
        case FishCompletionItemKind.FUNCTION:
            docString = await getFunctionDocString(item.label) || item.documentation
            break;
        case FishCompletionItemKind.VARIABLE:
            docString = await getVariableDocString(item.label) || item.documentation
            break;
        case FishCompletionItemKind.EVENT:
            docString = await getEventHandlerDocString(item.documentation)
            break;
        case FishCompletionItemKind.STATUS:
        case FishCompletionItemKind.WILDCARD:
        case FishCompletionItemKind.REGEX:
        case FishCompletionItemKind.FORMAT_STR: 
        case FishCompletionItemKind.ESC_CHARS:
        case FishCompletionItemKind.PIPE:
            docString = await getStaticDocString(item as FishCompletionItem)
            break
        case FishCompletionItemKind.ARGUMENT:
        case FishCompletionItemKind.EMPTY:
        default:
            break;
    }
    return {
        kind: 'markdown',
        value: docString
    } as MarkupContent
}