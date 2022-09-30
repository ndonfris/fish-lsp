import { CompletionItemKind, CompletionList } from "vscode-languageserver-protocol";
import { SyntaxNode } from "web-tree-sitter";
export declare enum FishCompletionItemType {
    function = 0,
    builtin = 1,
    abbr = 2,
    flag = 3,
    variable = 4
}
export declare function toCompletionItemKind(type: FishCompletionItemType): CompletionItemKind;
export declare class Completion {
    private currentNode;
    private commandNode;
    private globalVariableList;
    private abbrList;
    private localVariablesList;
    private localFunctions;
    private isInsideCompletionsFile;
    private completions;
    private isIncomplete;
    constructor();
    initialDefaults(): Promise<void>;
    private enrichCompletions;
    generate(node: SyntaxNode): Promise<CompletionList>;
}
//# sourceMappingURL=completion.d.ts.map