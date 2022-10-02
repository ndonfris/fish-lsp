import { Hover, Location, TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import { Context } from './interfaces';
export declare class Analyzer {
    private parser;
    constructor(parser: Parser);
    /**
     * @async initialize() - intializes a SyntaxTree on context.trees[document.uri]
     *
     * @param {Context} context - context of lsp
     * @param {TextDocument} document - an initialized TextDocument from createTextDocumentFromFilePath()
     * @returns {Promise<SyntaxTree>} - SyntaxTree which is also stored on context.trees[uri]
     */
    initialize(context: Context, document: TextDocument): Promise<SyntaxTree>;
    analyze(context: Context, document: TextDocument): Promise<undefined>;
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(tree: SyntaxTree, line: number, column: number): Parser.SyntaxNode | null;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(tree: SyntaxTree, line: number, column: number): string | null;
    /**
     * Gets the entire current line inside of the document. Useful for completions
     *
     * @param {Context} context - lsp context
     * @param {string} uri - DocumentUri
     * @param {number} line - the line number from from a Position object
     * @returns {string} the current line in the document, or an empty string
     */
    currentLine(context: Context, uri: string, line: number): string;
    nodeIsLocal(tree: SyntaxTree, node: SyntaxNode): Hover | void;
    getHover(tree: SyntaxTree, params: TextDocumentPositionParams): Promise<Hover | void>;
    getHoverFallback(currentNode: SyntaxNode): Promise<Hover | void>;
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