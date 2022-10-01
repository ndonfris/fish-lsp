import { Hover, Location, TextDocumentPositionParams } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
export declare class MyAnalyzer {
    private parser;
    uriToSyntaxTree: {
        [uri: string]: SyntaxTree;
    };
    uriToTextDocument: {
        [uri: string]: TextDocument;
    };
    constructor(parser: Parser);
    initialize(uri: string): Promise<TextDocument>;
    analyze(uri: string, newDocument: TextDocument | undefined): Promise<void>;
    /**
     * Find the node at the given point.
     */
    nodeAtPoint(uri: string, line: number, column: number): Parser.SyntaxNode | null;
    /**
     * Find the full word at the given point.
     */
    wordAtPoint(uri: string, line: number, column: number): string | null;
    currentLine(uri: string, line: number): string;
    nodeIsLocal(uri: string, node: SyntaxNode): Hover | void;
    getHover(params: TextDocumentPositionParams): Promise<Hover | void>;
    getHoverFallback(uri: string, currentNode: SyntaxNode): Promise<Hover | void>;
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