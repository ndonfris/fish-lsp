import { CompletionItem, CompletionItemKind, MarkupContent, RemoteConsole } from 'vscode-languageserver';
export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent;
    data: {
        originalCompletion: string;
        fishKind: FishCompletionItemKind;
    };
}
/**
 * line is an array of length 2 (Example's below). External commands MIGHT have man-pages,
 * and are retrieved as executeables in $PATH.
 *
 *     acpi_listen	command
 *     adhocfilelist	command link
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an Shell External Command.
 */
export declare function isCommand(line: string[]): boolean;
export declare const BuiltInList: string[];
/**
 * line is an array of length 2 (Example's below). Builtins are retreived via:
 *          builtins --names
 * builtins
 *
 *     true	Do nothing, successfully
 *     while	Perform a command multiple times
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an builtin
 */
export declare function isBuiltIn(line: string): boolean;
export declare const escapeChars: {
    [char: string]: string;
};
interface pipeObj {
    altLabel: string;
    insertText: string;
    documentation: string | MarkupContent;
}
export declare const pipes: {
    [pipe: string]: pipeObj;
};
export declare const statusNumbers: {
    [statusNumber: string]: string;
};
interface wildcardCompletionItem {
    label: string;
    documentation: string;
    kind: CompletionItemKind;
    examples: [string, string][];
}
export declare const WildcardItems: {
    [char: string]: wildcardCompletionItem;
};
export declare const bashEquivalentChars: {
    [char: string]: string;
};
interface regexItem {
    label: string;
    insertText: string;
    insertTextFormat?: number;
    description: string;
    examples?: string[];
}
export declare const stringRegexExpressions: regexItem[];
/**
 * line is an array of length 2 (Example's below). Retrieving a gloabl varaible can be
 * done through the shell in any of the following methods. (We use method 1)
 *
 *       complete --do-complete '$'
 *       ~~~~~~~~~~~~~~ or ~~~~~~~~~~~
 *       set --show
 *       ~~~~~~~~~~~~~~ or ~~~~~~~~~~~
 *       set --names
 *
 *
 *    $BAT_THEME	Variable: base16
 *    $CMD_DURATION	Variable: 3
 *    $COLUMNS	        Variable: 127
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an builtin
 */
export declare function isGlobalVariable(line: string[]): boolean;
/**
 * gets the completion item type for Generating a completion item
 *
 * @param {string[]} line - the line recieved from fish shell call
 * @returns {CompletionItemKind} - a completion item kind to display different types
 *                                 of items displayed in a CompletionList.
 *                                 CompletionResolver()  will use this info to enrich
 *                                 the Completion
 */
export declare enum FishCompletionItemKind {
    ABBR = 0,
    ALIAS = 1,
    BUILTIN = 2,
    GLOBAL_VAR = 3,
    LOCAL_VAR = 4,
    USER_FUNC = 5,
    GLOBAL_FUNC = 6,
    LOCAL_FUNC = 7,
    FLAG = 8,
    CMD = 9,
    CMD_NO_DOC = 10,
    RESOLVE = 11
}
export declare function getFishCompletionItemType(itemKind: CompletionItemKind, options?: {
    local?: boolean;
    usrFile?: boolean;
    fishFile?: boolean;
}): FishCompletionItemKind.ABBR | FishCompletionItemKind.ALIAS | FishCompletionItemKind.BUILTIN | FishCompletionItemKind.GLOBAL_VAR | FishCompletionItemKind.LOCAL_VAR | FishCompletionItemKind.GLOBAL_FUNC | FishCompletionItemKind.LOCAL_FUNC | FishCompletionItemKind.FLAG | FishCompletionItemKind.CMD | FishCompletionItemKind.RESOLVE;
/**
 * TODO: convert to promise.all() -> Promise.all should be able to be called in
 *       completion since it returns a promise
 * @async resolveFishCompletionItemType(cmd) - here we are checking if the command,
 *                                             (from fish completion line [cmd, ...])
 *                                             has either a manpage or fish file.
 *
 *  Output from execCommandType ->
 *       • "command" ==> show using man
 *       • "file"    ==> show using functions query
 *       • ""        ==> show location? TODO
 *
 * @param {string} cmd - first index of completion.stdout.split('\t') array of fish
 *                       temrinal completions.
 * @returns {Promise<FishCompletionItemKind>} - the corresponding FishCompletionItemKind
 *                                              matching cmd.
 */
export declare function resolveFishCompletionItemType(cmd: string): Promise<FishCompletionItemKind>;
/**
 * @async buildCompletionItem() - takes the array of nodes from our string.
 *
 * @param {string[]} arr - [name, docs]
 * @returns {Promise<FishCompletionItem>} - CompletionItem to resolve onCompletion()
 */
export declare function handleCompletionResolver(item: FishCompletionItem, console: RemoteConsole): Promise<FishCompletionItem>;
export {};
//# sourceMappingURL=completion-types.d.ts.map