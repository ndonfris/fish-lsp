import { CompletionItem, CompletionList } from "vscode-languageserver-protocol/node";
import { SyntaxNode } from "web-tree-sitter";
export declare function getShellCompletions(cmd: string): Promise<[string, string, string][]>;
export declare class Completion {
    userFunctions: string[];
    globalFunctions: string[];
    private isInsideCompletionsFile;
    private completions;
    private isIncomplete;
    static initialDefaults(): Promise<Completion>;
    constructor();
    generateLineCmpNew(line: string): Promise<CompletionItem[] | null>;
    generate(node: SyntaxNode): Promise<CompletionList>;
    reset(): void;
    fallbackComplete(): CompletionList;
}
export declare function buildRegexCompletions(): CompletionItem[];
export declare function buildDefaultCompletions(): CompletionItem[];
//# sourceMappingURL=completion.d.ts.map