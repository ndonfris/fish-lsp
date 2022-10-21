import { CompletionItem, CompletionItemKind, CompletionList } from "vscode-languageserver-protocol/node";
import { SyntaxNode } from "web-tree-sitter";
import { FilepathResolver } from './utils/filepathResolver';
export declare enum FishCompletionItemType {
    function = 0,
    builtin = 1,
    abbr = 2,
    flag = 3,
    variable = 4,
    line = 5
}
export declare function toCompletionItemKind(type: FishCompletionItemType): CompletionItemKind;
export declare class Completion {
    private currentNode;
    private commandNode;
    lineCmps: CompletionItem[];
    globalAbbrs: CompletionItem[];
    private globalVars;
    globalAlaises: CompletionItem[];
    globalCmds: CompletionItem[];
    globalBuiltins: CompletionItem[];
    private localVariables;
    private localFunctions;
    private isInsideCompletionsFile;
    private completions;
    private isIncomplete;
    filepathResolver: FilepathResolver;
    static initialDefaults(filepathResolver: FilepathResolver): Promise<Completion>;
    constructor(filepathResolver: FilepathResolver);
    generateLineCmpNew(line: string): Promise<CompletionItem[]>;
    generate(node: SyntaxNode): Promise<CompletionList>;
    fallbackComplete(): CompletionList;
}
export declare function buildGlobalAbbrs(): Promise<CompletionItem[]>;
export declare function buildGlobalVars(): Promise<CompletionItem[]>;
export declare function buildGlobalBuiltins(): Promise<CompletionItem[]>;
export declare function buildGlobalCommands(): Promise<CompletionItem[]>;
export declare function buildGlobalAlaises(): Promise<CompletionItem[]>;
//# sourceMappingURL=completion.d.ts.map