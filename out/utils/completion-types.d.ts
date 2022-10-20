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
export interface FishBuiltinCmp {
    text: string;
    description: string;
}
/**
 * line is an array of length 2 (Example below)
 *
 *     ta	Abbreviation: tmux attach -t
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
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
export declare function isBuiltIn(line: string[]): boolean;
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
    ABBR = 0,
    ALIAS = 1,
    BUILTIN = 2,
    GLOBAL_VAR = 3,
    LOCAL_VAR = 4,
    GLOBAL_FUNC = 5,
    LOCAL_FUNC = 6,
    FLAG = 7,
    CMD = 8,
    CMD_NO_DOC = 9,
    RESOLVE = 10
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
export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent;
    insertText?: string;
    data: {
        originalCompletion?: string;
        resolveCommand?: string;
        fishKind: FishCompletionItemKind;
        range?: Range;
    };
}
/**
 * @async buildCompletionItem() - takes the array of nodes from our string.
 *
 * @param {string[]} arr - [name, docs]
 * @returns {Promise<FishCompletionItem>} - CompletionItem to resolve onCompletion()
 */
export declare function buildCompletionItemPromise(arr: string[]): FishCompletionItem;
export declare function handleCompletionResolver(item: FishCompletionItem, console: RemoteConsole): Promise<FishCompletionItem>;
//# sourceMappingURL=completion-types.d.ts.map