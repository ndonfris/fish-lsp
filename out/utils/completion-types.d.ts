import { CompletionItem, CompletionItemKind, MarkupContent, RemoteConsole } from 'vscode-languageserver';
/**
 * text: actual completion text
 * description: fish shell compleiton description
 *
 * bind        (Handle fish key binding)
 * text          description --> note: no parenthesis when outside of interactive shell
 *
 * Descriptions are optionally because things like function files will not show any
 * description, however we will indcate it empty string
 */
export interface CmdLineCmp {
    text: string;
    description: string;
}
export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent;
    data: {
        originalCompletion: string;
        fishKind: FishCompletionItemKind;
    };
    create(label: string): CompletionItem;
}
/**
 *     ta	Abbreviation: tmux attach -t
 *
 * @param {CmdLineCmp} line - a result from fish's builtin commandline completions
 *                     index[0]: the actual abbr
 *                     index[1]: Abbreviation: expansion
 *
 */
export declare function isAbbr(line: string[]): boolean;
/**
 * line is an array of length 2 (Example below)
 *
 *     vdiff	    alias vdiff=nvim -d
 *     vimdiff	    alias vimdiff=nvim -d
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 *                     index[0]: the alias
 *                     index[1]: alias shortend_cmd=some_longer_cmd
 */
export declare function isAlias(line: string[]): boolean;
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
export declare function isBuiltIn(line: string | [...string[]]): boolean;
/**
 *   line array length could be 1 or 2. User completions may not provide description
 *
 *   Example below, seen from 'test -'
 *
 *   -x     File is executable
 *   -w	    File is writable
 *   -u	    File set-user-ID bit is set
 */
export declare function isFlag(line: string[]): boolean;
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
export declare function isFishCommand(line: string[]): boolean;
/**
 * gets the completion item type for Generating a completion item
 *
 * @param {string[]} line - the line recieved from fish shell call
 * @returns {CompletionItemKind} - a completion item kind to display different types
 *                                 of items displayed in a CompletionList.
 *                                 CompletionResolver()  will use this info to enrich
 *                                 the Completion
 */
export declare function getCompletionItemKind(line: string[], fishKind?: FishCompletionItemKind): CompletionItemKind;
export declare enum FishCompletionItemKind {
    ABBR,
    ALIAS,
    BUILTIN,
    GLOBAL_VAR,
    LOCAL_VAR,
    USER_FUNC,
    GLOBAL_FUNC,
    LOCAL_FUNC,
    FLAG,
    CMD,
    CMD_NO_DOC,
    RESOLVE
}
export declare const fishCompletionItemKindMap: {
    readonly ABBR: 8;
    readonly ALIAS: 22;
    readonly BUILTIN: 14;
    readonly FLAG: 5;
    readonly LOCAL_VAR: 6;
    readonly GLOBAL_VAR: 21;
    readonly GLOBAL_FUNC: 2;
    readonly USER_FUNC: 3;
    readonly LOCAL_FUNC: 4;
    readonly CMD: 7;
    readonly CMD_NO_DOC: 7;
    readonly RESOLVE: 11;
};
export declare const completionItemKindMap: {
    readonly Interface: FishCompletionItemKind;
    readonly Struct: FishCompletionItemKind;
    readonly Keyword: FishCompletionItemKind;
    readonly Field: FishCompletionItemKind;
    readonly Variable: FishCompletionItemKind;
    readonly Constant: FishCompletionItemKind;
    readonly Method: FishCompletionItemKind;
    readonly Function: FishCompletionItemKind;
    readonly Constructor: FishCompletionItemKind;
    readonly Class: FishCompletionItemKind;
    readonly Unit: FishCompletionItemKind;
};
export declare function getFishCompletionItemType(itemKind: CompletionItemKind, options?: {
    local?: boolean;
    usrFile?: boolean;
    fishFile?: boolean;
}): FishCompletionItemKind;
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
export declare function buildCompletionItemPromise(arr: string[]): FishCompletionItem;
export declare function handleCompletionResolver(item: FishCompletionItem, console: RemoteConsole): Promise<FishCompletionItem>;
//# sourceMappingURL=completion-types.d.ts.map