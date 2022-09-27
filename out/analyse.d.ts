import { Hover, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
export declare class MyAnalyzer {
    private parser;
    private uriToSyntaxTree;
    private globalDocs;
    private completions;
    private dependencies;
    constructor(parser: Parser);
    analyze(uri: string, document: TextDocument): Promise<void>;
    complete(params: TextDocumentPositionParams): Promise<void>;
    /**
     * Find the node at the given point.
     */
    private nodeAtPoint;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri: string, line: number, column: number): string | null;
    getHover(params: TextDocumentPositionParams): Hover | void;
    getTreeForUri(uri: string): SyntaxTree | null;
}
export declare class SyntaxTree {
    rootNode: SyntaxNode;
    tree: Tree;
    nodes: SyntaxNode[];
    functions: SyntaxNode[];
    commands: SyntaxNode[];
    variable_defintions: SyntaxNode[];
    variables: SyntaxNode[];
    constructor(tree: Tree);
    ensureAnalyzed(): any[];
    clearAll(): void;
    getUniqueCommands(): string[];
    getNodeRanges(): import("vscode-languageserver-types").Range[];
    hasRoot(): boolean;
    getNodes(): Parser.SyntaxNode[];
}
//# sourceMappingURL=analyse.d.ts.map