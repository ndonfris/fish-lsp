import { Hover, TextDocumentPositionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
export declare class MyAnalyzer {
    private parser;
    uriToSyntaxTree: {
        [uri: string]: SyntaxTree | null;
    };
    private globalDocs;
    private completions;
    private dependencies;
    constructor(parser: Parser);
    initialize(uri: string): Promise<void>;
    analyze(uri: string, document: TextDocument): Promise<void>;
    complete(params: TextDocumentPositionParams): Promise<void>;
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri: string, line: number, column: number): string | null;
    nodeIsLocal(uri: string, node: SyntaxNode): Hover | void;
    getHover(params: TextDocumentPositionParams): Promise<Hover | void>;
    getHoverFallback(uri: string, currentNode: SyntaxNode): Promise<void>;
    getTreeForUri(uri: string): SyntaxTree | null;
}
export declare class SyntaxTree {
    rootNode: SyntaxNode;
    tree: Tree;
    nodes: SyntaxNode[];
    functions: SyntaxNode[];
    commands: SyntaxNode[];
    variable_definitions: SyntaxNode[];
    variables: SyntaxNode[];
    constructor(tree: Tree);
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
//# sourceMappingURL=analyse.d.ts.map