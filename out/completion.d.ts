import { CompletionList } from 'vscode-languageserver-protocol';
export declare class Completion {
    private currentNode;
    private commandNode;
    private globalVariableList;
    private abbrList;
    private localVariablesList;
    private localFunctions;
    private completions;
    private isIncomplete;
    constructor();
    initialDefaults(): Promise<void>;
    private enrichCompletions;
    generate(): Promise<CompletionList>;
}
//# sourceMappingURL=completion.d.ts.map