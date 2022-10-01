import { Hover, MarkupContent } from 'vscode-languageserver-protocol';
import { SyntaxNode } from 'web-tree-sitter';
import { CompletionArguments } from './utils/exec';
export declare type markdownFiletypes = 'fish' | 'man';
export declare function enrichToMarkdown(doc: string): MarkupContent;
export declare function enrichToCodeBlockMarkdown(doc: string, filetype?: markdownFiletypes): MarkupContent;
export declare function enrichCommandArg(doc: string): MarkupContent;
export declare function enrichToPlainText(doc: string): MarkupContent;
export declare function documentationHoverProvider(cmd: string): Promise<Hover | null>;
export declare function documentationHoverCommandArg(root: SyntaxNode, cmp: CompletionArguments): Hover;
export declare function forwardSubCommandCollect(rootNode: SyntaxNode): string[];
export declare function forwardArgCommandCollect(rootNode: SyntaxNode): string[];
export declare function collectCompletionOptions(rootNode: SyntaxNode): void;
export declare class HoverFromCompletion {
    private currentNode;
    private commandNode;
    private commandString;
    private entireCommandString;
    private completions;
    private oldOptions;
    private flagsGiven;
    constructor(commandNode: SyntaxNode, currentNode: SyntaxNode);
    /**
     * set this.commandString for possible subcommands
     * handles a command such as:
     *        $ string match -ra '.*' -- "hello all people"
     */
    private checkForSubCommands;
    private isSubCommand;
    /**
     * @see man complete: styles --> long options
     * enables the ability to differentiate between
     * short flags chained together, or a command
     * that
     * a command option like:
     *            '-Wall' or             --> returns true
     *            find -name '.git'      --> returns true
     *
     *            ls -la                 --> returns false
     * @param {string[]} cmpFlags - [TODO:description]
     * @returns {boolean} true if old styles are valid
     *                    false if short flags can be chained
     */
    private hasOldStyleFlags;
    /**
    * handles splitting short options if the command has no
    * old style flags.
    * @see this.hasOldStyleFlags()
    */
    private reparseFlags;
    buildCompletions(): Promise<string[][]>;
    findCompletion(flag: string): string[] | null;
    private checkForHoverDoc;
    generateForFlags(): Promise<Hover>;
    generateForSubcommand(): Promise<Hover | null>;
    generate(): Promise<Hover | void>;
}
//# sourceMappingURL=documentation.d.ts.map