import {CompletionItem, CompletionItemKind} from "vscode-languageserver"
//import {FishCompletionItem, FishCompletionItemKind} from "./completion-strategy";
//import { StaticItems } from "./completion-types"
import { execCmd, getGloablVariable } from './exec';
import { getAbbrDocString, getBuiltinDocString, getFunctionDocString } from './documentationCache';
import { getVariableScope } from './definition-scope';


//export enum FishCompletionItemKind {
//    ABBR = "abbr",
//    BUILTIN = "builtin",
//    FUNCTION = "function",
//    VARIABLE = "variable",
//    EVENT = "event",
//    PIPE = "pipe",
//    ESC_CHARS = "esc_chars",
//    STATUS = "status",
//    WILDCARD = "wildcard",
//    COMMAND = "command",
//    REGEX = "regex",
//    COMBINER = "combiner",
//    FORMAT_STR = "format_str",
//    STATEMENT = "statement",
//    ARGUMENT = "argument",
//}
//export namespace FishCompletionItemKind {
//     // Exclude functions and get the real enum keys/values
//    type EnumKeys = { [K in keyof typeof FishCompletionItemKind]: typeof FishCompletionItemKind[K] extends string ? K : never }[keyof typeof FishCompletionItemKind];
//    type EnumValues = typeof FishCompletionItemKind[EnumKeys];
//    export function getRemoveLabels(kind: FishCompletionItemKind): string[] {
//        switch (kind) {
//            case FishCompletionItemKind.BUILTIN:
//                return ['.', ':']
//            default:
//                return []
//        }
//    }
//    export function getEntries(): [EnumKeys, EnumValues][] {
//        return Object.entries(FishCompletionItemKind).filter(
//            ([key, value]) => typeof value !== 'function'
//        ) as [EnumKeys, EnumValues][];
//    }
//    export function getKeys(): EnumKeys[] {
//        return Object.keys(FishCompletionItemKind).filter(
//            (key) => typeof FishCompletionItemKind[key as EnumKeys] !== 'function'
//        ) as EnumKeys[];
//    }
//    export function getValues(): EnumValues[] {
//        return getEntries().map(([_, v]) => v.toString()) as EnumValues[];
//    }
//    export function getEnumKey(input: EnumKeys | EnumValues): EnumKeys | null{
//        const entries = getEntries()
//        for (const [key, value] of entries) {
//            if (key === input || value === input) return key
//            continue;
//        }
//        return null
//    }
//    export function getEnumKind(input: EnumKeys | EnumValues| string): EnumValues | null {
//        for (const [key, value] of getEntries()) {
//            if (key === input || value === input) return value
//            continue;
//        }
//        return null
//    }
//}
//type SetupResolverKind = 'command' | 'simple' | 'types' | 'none' | 'after'
//interface SetupResolver {
//    command: string
//    kind: SetupResolverKind
//    promise: Promise<string[]>
//    deleteLabels: string[]
//}
//export namespace SetupResolver {
//    export function create(
//        command: string = '',
//        kind: SetupResolverKind = 'none',
//        promise: Promise<string[]> = SetupPromises.empty(),
//        deleteLabels: string[] = [],
//    ) {
//        return {
//            command: command,
//            kind: kind,
//            promise: promise,
//            deleteLabels: deleteLabels,
//        } as SetupResolver;
//    }
//}
//export namespace SetupPromises {
//    export async function labels<T extends CompletionItem>(items: T[]): Promise<string[]> {
//        return items.map((item) => item.label)
//    }
//    export async function empty(): Promise<string[]> {
//        return [] as string[]
//    }
//    export async function command(command: string): Promise<string[]> {
//        return execCmd(command)
//    }
//}
//
//type DocumentationCallback = (...params: any[]) => Promise<string>
//export interface ICached {
//    setupResolver: SetupResolver
//    labels: Set<string>
//    items: CompletionItem[]
//    toCompletionItemKind: CompletionItemKind
//    toFishCompletionItemKind: FishCompletionItemKind,
//    docCallbackFn(...params: any[]): Promise<string>,
//}
//export namespace ICached {
//    export function create(
//        setupResolver: SetupResolver,
//        labels: Set<string>,
//        items: CompletionItem[],
//        toCompletionItemKind: CompletionItemKind,
//        toFishCompletionItemKind: FishCompletionItemKind,
//        docCallbackFn: (...params: any[]) => Promise<string|undefined> = async () => { return '' }
//    ) {
//        return {
//            setupResolver,
//            labels,
//            items,
//            toCompletionItemKind,
//            toFishCompletionItemKind,
//            docCallbackFn
//        } as ICached
//    }
//
//    async function getCommandCallback(toFishCompletionItemKind: FishCompletionItemKind, item: CompletionItem) {
//        switch (toFishCompletionItemKind) {
//            case FishCompletionItemKind.BUILTIN:
//                return getBuiltinDocString(item.label)
//            case FishCompletionItemKind.FUNCTION:
//                return getFunctionDocString(item.label)
//            case FishCompletionItemKind.ABBR:
//                return getAbbrDocString(item.label)
//            case FishCompletionItemKind.VARIABLE:
//                return getGloablVariable(item.label)
//            default:
//                return item.documentation
//        }
//    }
//
//    export function createWithCommand(command: string, toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
//        let removeLabels = FishCompletionItemKind.getRemoveLabels(toFishCompletionItemKind)
//        const setupResolver = SetupResolver.create(command, 'command', SetupPromises.command(command), removeLabels);
//        return create(
//            setupResolver,
//            new Set(),
//            new Array(),
//            toCompletionItemKind,
//            toFishCompletionItemKind,
//            async (label: string) => {
//                return getBuiltinDocString(label)
//            }
//        );
//    }
//    export function createSimpleCompletion(items: FishSimpleCompletionItem[], toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
//        const setupResolver = SetupResolver.create('', 'simple', SetupPromises.labels(items));
//        return create(setupResolver, new Set(), items, toCompletionItemKind, toFishCompletionItemKind)
//    }
//    export function createTypes(toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
//        const setupResolver  = SetupResolver.create('', 'types', SetupPromises.empty());
//        return create(setupResolver, new Set(), new Array(), toCompletionItemKind, toFishCompletionItemKind)
//    }
//    export function createCommands(command: string, toCompletionItemKind: CompletionItemKind, toFishCompletionItemKind: FishCompletionItemKind) {
//        const setupResolver = SetupResolver.create(command, 'after', SetupPromises.command(command));
//        return create(setupResolver, new Set(), new Array(), toCompletionItemKind, toFishCompletionItemKind)
//    }
//}
//
//export class _Cached {
//    private static ABBR: ICached = ICached.createWithCommand(
//        "abbr --list",
//        CompletionItemKind.Snippet,
//        FishCompletionItemKind.ABBR
//    )
//}
//const _cached: Record<FishCompletionItemKind, ICached> = {
//    [FishCompletionItemKind.ABBR]: ICached.createWithCommand(
//        "abbr --list",
//        CompletionItemKind.Snippet,
//        FishCompletionItemKind.ABBR
//    ),
//    [FishCompletionItemKind.BUILTIN]: ICached.createWithCommand(
//        "builtin --names",
//        CompletionItemKind.Keyword,
//        FishCompletionItemKind.BUILTIN
//    ),
//    [FishCompletionItemKind.FUNCTION]: ICached.createWithCommand(
//        "functions --names | string collect",
//        CompletionItemKind.Function,
//        FishCompletionItemKind.FUNCTION
//    ),
//    [FishCompletionItemKind.VARIABLE]: ICached.createWithCommand(
//        "set --names",
//        CompletionItemKind.Variable,
//        FishCompletionItemKind.VARIABLE
//    ),
//    [FishCompletionItemKind.EVENT]: ICached.createWithCommand(
//        "functions --handlers | string match -vr '^Event \\w+' | string split -f1 ' '",
//        CompletionItemKind.Event,
//        FishCompletionItemKind.EVENT
//    ),
//    [FishCompletionItemKind.PIPE]: ICached.createSimpleCompletion(
//        PipeItems,
//        CompletionItemKind.Operator,
//        FishCompletionItemKind.PIPE
//    ),
//    [FishCompletionItemKind.ESC_CHARS]: ICached.createSimpleCompletion(
//        EscapeCharItems,
//        CompletionItemKind.Text,
//        FishCompletionItemKind.ESC_CHARS
//    ),
//    [FishCompletionItemKind.STATUS]: ICached.createSimpleCompletion(
//        StatusNumbers,
//        CompletionItemKind.EnumMember,
//        FishCompletionItemKind.STATUS
//    ),
//    [FishCompletionItemKind.COMBINER]: ICached.createSimpleCompletion(
//        CombinerCompletionItems,
//        CompletionItemKind.Operator,
//        FishCompletionItemKind.COMBINER
//    ),
//    [FishCompletionItemKind.FORMAT_STR]: ICached.createSimpleCompletion(
//        FormatSpecifierCompletionItems,
//        CompletionItemKind.TypeParameter,
//        FishCompletionItemKind.FORMAT_STR
//    ),
//    [FishCompletionItemKind.STATEMENT]: ICached.createSimpleCompletion(
//        StatementCompletionItems,
//        CompletionItemKind.Keyword,
//        FishCompletionItemKind.STATEMENT
//    ),
//    [FishCompletionItemKind.REGEX]: ICached.createSimpleCompletion(
//        StringRegexExpressions,
//        CompletionItemKind.Text,
//        FishCompletionItemKind.REGEX
//    ),
//    [FishCompletionItemKind.COMMAND]: ICached.createTypes(
//        CompletionItemKind.Module,
//        FishCompletionItemKind.COMMAND
//    ),
//    [FishCompletionItemKind.WILDCARD]: ICached.createTypes(
//        CompletionItemKind.Text,
//        FishCompletionItemKind.WILDCARD
//    ),
//    [FishCompletionItemKind.ARGUMENT]: ICached.createTypes(
//        CompletionItemKind.Property,
//        FishCompletionItemKind.ARGUMENT
//    ),
//    //WILDCARD:
//    //FunctionCompletionEvents:
//    //Argument
//    //Command
//} as const;
//
//export async function initFishCompletionItemKinds(){
//    const executeSetup = Object.entries(_cached).map(async ([key, value]) => {
//        const keyAsEnum = value.toFishCompletionItemKind!
//        const current = value
//        const setup = current.setupResolver
//        try {
//            const labels = await Promise.resolve(setup.promise)
//            current.labels = new Set(labels)
//        } catch (Error) {
//            console.log(`Error executingSetup for FishCompletionItemKind[${key}]`);
//        }
//
//        if (!setup.deleteLabels.length) return
//
//        setup.deleteLabels.forEach((label: string) => {
//            current.labels.delete(label)
//            const index = current.items.findIndex((object) => {
//                return object.label === label;
//            });
//            if (index !== -1) current.items.splice(index, 1);
//        });
//    })
//
//    await Promise.all(executeSetup);
//    //const entries = Object.entries(_cached)
//
//    return _cached;
//}
//
//
