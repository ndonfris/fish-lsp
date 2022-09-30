/**
 * @async execEscapedComplete() - executes the fish command with
 *
 * @param {string} cmd - the current command to complete
 *
 * @returns {Promise<string[]>} - the array of completions, types will need to be added when
 *                                the fish completion command is implemented
 */
export declare function execEscapedCommand(cmd: string): Promise<string[]>;
export declare function execCompleteLine(cmd: string): Promise<string[]>;
export declare function execCompleteSpace(cmd: string): Promise<string[]>;
export declare function execCompleteCmdArgs(cmd: string): Promise<string[]>;
export declare function execCompleteVariables(): Promise<string[]>;
export declare function execCompleteAbbrs(): Promise<string[]>;
export declare function execCommandDocs(cmd: string): Promise<string>;
/**
 * runs: ../fish_files/get-type.fish <cmd>
 *
 * @param {string} cmd - command type from document to resolve
 * @returns {Promise<string>}
 *                     'command' -> cmd has man
 *                     'file' -> cmd is fish function
 *                     '' ->    cmd is neither
 */
export declare function execCommandType(cmd: string): Promise<string>;
export interface CompletionArguments {
    command: string;
    args: Map<string, string>;
}
export declare function documentCommandDescription(cmd: string): Promise<string>;
export declare function generateCompletionArguments(cmd: string): Promise<CompletionArguments>;
export declare function execFindDependency(cmd: string): Promise<string>;
//# sourceMappingURL=exec.d.ts.map