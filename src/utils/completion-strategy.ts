import { Position, CompletionContext, Command, CompletionItem, CompletionItemKind, MarkupContent } from 'vscode-languageserver';

export enum FishCompletionItemKind {
    ABBR,			          // interface
    ALIAS,			          // struct
    BUILTIN,			      // keyword
    GLOBAL_VARIABLE,		  // constant
    LOCAL_VARIABLE,			  // variable
    USER_FUNCTION,			  // function
    GLOBAL_FUNCTION,		  // method
    LOCAL_FUNCTION,			  // constructor
    FLAG,			          // field
    CMD,			          // class
    CMD_NO_DOC,			      // class
    RESOLVE,			      // unit
}


export const toCompletionKind: Record<FishCompletionItemKind, CompletionItemKind> = {
    [FishCompletionItemKind.ABBR]: CompletionItemKind.Interface,                // interface
    [FishCompletionItemKind.ALIAS]: CompletionItemKind.Struct,                  // struct
    [FishCompletionItemKind.BUILTIN]: CompletionItemKind.Keyword,               // keyword
    [FishCompletionItemKind.GLOBAL_VARIABLE]: CompletionItemKind.Constant,      // constant
    [FishCompletionItemKind.LOCAL_VARIABLE]: CompletionItemKind.Variable,       // variable
    [FishCompletionItemKind.USER_FUNCTION]: CompletionItemKind.Function,        // function
    [FishCompletionItemKind.GLOBAL_FUNCTION]: CompletionItemKind.Method,        // method
    [FishCompletionItemKind.LOCAL_FUNCTION]: CompletionItemKind.Constructor,    // constructor
    [FishCompletionItemKind.FLAG]: CompletionItemKind.Field,                    // field
    [FishCompletionItemKind.CMD]: CompletionItemKind.Class,                     // class
    [FishCompletionItemKind.CMD_NO_DOC]: CompletionItemKind.Unit,               // class
    [FishCompletionItemKind.RESOLVE]: CompletionItemKind.Unit                   // unit
}

export const toCompletionKindString: Record<FishCompletionItemKind, string> = {
    [FishCompletionItemKind.ABBR]: 'Interface',                // interface
    [FishCompletionItemKind.ALIAS]: 'Struct',                  // struct
    [FishCompletionItemKind.BUILTIN]: 'Keyword',               // keyword
    [FishCompletionItemKind.GLOBAL_VARIABLE]: 'Constant',      // constant
    [FishCompletionItemKind.LOCAL_VARIABLE]: 'Variable',       // variable
    [FishCompletionItemKind.USER_FUNCTION]: 'Function',        // function
    [FishCompletionItemKind.GLOBAL_FUNCTION]: 'Method',        // method
    [FishCompletionItemKind.LOCAL_FUNCTION]: 'Constructor',    // constructor
    [FishCompletionItemKind.FLAG]: 'Field',                    // field
    [FishCompletionItemKind.CMD]: 'Class',                     // class
    [FishCompletionItemKind.CMD_NO_DOC]: 'Unit',               // class
    [FishCompletionItemKind.RESOLVE]: 'Unit'                   // unit
}

export type FishCompletionData = {
    uri: string,
    line: string,
    word: string,
    position: Position,
    context?: CompletionContext,
}

export namespace FishCompletionData {
    export function create(uri: string, line: string, word: string, position: Position, context?: CompletionContext): FishCompletionData {
        return { uri, line, word, position, context};
    }
}

export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation: string | MarkupContent; 
    fishKind: FishCompletionItemKind; // VERBOSE form of kind
    localSymbol: boolean;
    data: FishCompletionData;
}


interface ICompletionItemBuilder {
    build(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem;
}

class BaseCompletionItemBuilder implements ICompletionItemBuilder {
    protected buildBase(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
        return {
            label: label,
            kind: toCompletionKind[kind],
            documentation: documentation,
            insertText: insertText,
            fishKind: kind,
            localSymbol: false,
            data: data,
        };
    }

    build(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
        return this.buildBase(label, kind, documentation, data, insertText);
    }
}
class AbbrCompletionItemBuilder extends BaseCompletionItemBuilder {
    build(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
        return {
            ...this.buildBase(label, kind, documentation, data, insertText),
            commitCharacters: [';', '\t', '<tab>'],
        }
    }
}

class LocalSymbolCompletionItemBuilder extends BaseCompletionItemBuilder {
    build(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
        return {
            ...this.buildBase(label, kind, documentation, data, insertText),
            localSymbol: true,
            fishKind: kind,
        }
    }
}

class FlagCompletionItemBuilder extends BaseCompletionItemBuilder {
    build(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
        const replaceText = label.startsWith('--') ? `${label} ` : label;
        return {
            ...this.buildBase(label, kind, documentation, data, insertText),
            command: Command.create('Complete', 'editor.action.triggerSuggest'),
            textEdit: {
                newText:label.slice(data.word.length),
                range: {
                    start: {
                        character: data.position.character,
                        line: data.position.line,
                    },
                    end: {
                        character: data.position.character,
                        line: data.position.line,
                    }
                }
            },
            filterText: label + '     ' + documentation,
            fishKind: FishCompletionItemKind.FLAG,
            localSymbol: false,
        }
    }
}


export const strategies: Record<FishCompletionItemKind, ICompletionItemBuilder> = {
    [FishCompletionItemKind.ABBR]:            new AbbrCompletionItemBuilder(),
    [FishCompletionItemKind.ALIAS]:           new BaseCompletionItemBuilder(),
    [FishCompletionItemKind.BUILTIN]:         new BaseCompletionItemBuilder(),
    [FishCompletionItemKind.GLOBAL_VARIABLE]: new LocalSymbolCompletionItemBuilder(),
    [FishCompletionItemKind.LOCAL_VARIABLE]:  new LocalSymbolCompletionItemBuilder(),
    [FishCompletionItemKind.USER_FUNCTION]:   new LocalSymbolCompletionItemBuilder(),
    [FishCompletionItemKind.GLOBAL_FUNCTION]: new LocalSymbolCompletionItemBuilder(),
    [FishCompletionItemKind.LOCAL_FUNCTION]:  new LocalSymbolCompletionItemBuilder(),
    [FishCompletionItemKind.FLAG]:            new FlagCompletionItemBuilder(),
    [FishCompletionItemKind.CMD]:             new BaseCompletionItemBuilder(),
    [FishCompletionItemKind.CMD_NO_DOC]:      new BaseCompletionItemBuilder(),
    [FishCompletionItemKind.RESOLVE]:         new BaseCompletionItemBuilder(),
}

export function createCompletionItem(label: string, kind: FishCompletionItemKind, documentation: string | MarkupContent, data: FishCompletionData, insertText?: string): FishCompletionItem {
    return strategies[kind].build(label, kind, documentation, data, insertText);
}