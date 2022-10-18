import { Hover, Location } from "vscode-languageserver/node";
import { Position, TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
export declare class Analyzer {
    private parser;
    private uriTree;
    constructor(parser: Parser);
    analyze(document: TextDocument): void;
    getRoot(document: TextDocument): Parser.SyntaxNode;
    getLocalNodes(document: TextDocument): Parser.SyntaxNode[];
    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @returns {string} the current line in the document, or an empty string
     */
    currentLine(document: TextDocument, position: Position): string;
    nodeIsLocal(tree: SyntaxTree, node: SyntaxNode): Hover | void;
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri: string, line: number, column: number): string | null;
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