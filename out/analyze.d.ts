import { Hover, Location, RemoteConsole } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
export declare class Analyzer {
    private parser;
    private uriTree;
    private console;
    constructor(parser: Parser, console: RemoteConsole);
    analyze(document: TextDocument): Promise<void>;
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri: string, line: number, column: number): string | null;
    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @param {Context} context - lsp context
     * @param {string} uri - DocumentUri
     * @param {number} line - the line number from from a Position object
     * @returns {string} the current line in the document, or an empty string
     */
    currentLine(document: TextDocument, line: number): string;
    nodeIsLocal(tree: SyntaxTree, node: SyntaxNode): Hover | void;
}
export declare class SyntaxTree {
    rootNode: SyntaxNode;
    tree: Tree;
    nodes: SyntaxNode[];
    functions: SyntaxNode[];
    commands: SyntaxNode[];
    variable_definitions: SyntaxNode[];
    variables: SyntaxNode[];
    statements: SyntaxNode[];
    locations: Location[];
    constructor(tree: Parser.Tree);
    ensureAnalyzed(): Parser.SyntaxNode[];
    clearAll(): void;
    getUniqueCommands(): string[];
    getNodeRanges(): import("vscode-languageserver-types").Range[];
    hasRoot(): boolean;
    getNodes(): Parser.SyntaxNode[];
    getLocalFunctionDefinition(searchNode: SyntaxNode): Parser.SyntaxNode | undefined;
    getNearestVariableDefinition(searchNode: SyntaxNode): Parser.SyntaxNode | undefined;
    getOutmostScopedNodes(): Parser.SyntaxNode[];
}
//# sourceMappingURL=analyze.d.ts.map