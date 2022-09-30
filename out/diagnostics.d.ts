import { DocumentUri } from 'vscode-languageserver-textdocument';
import { SymbolInformation, Location, SymbolKind } from "vscode-languageserver/node";
import { SyntaxNode } from "web-tree-sitter";
import { SyntaxTree } from "./analyse";
export declare class FishDiagnostics {
    private locations;
    private symbols;
    constructor();
    initializeLocations(uri: string, tree: SyntaxTree): Promise<void>;
}
export declare class FishSymbol {
    private kind;
    private name;
    private range;
    private uri;
    private location;
    private refrences;
    private containerName?;
    private symbolInfo;
    private children;
    constructor(name: string, node: SyntaxNode, uri: DocumentUri, containerName?: string);
    getName(): string;
    getUri(): string;
    getSymbolInfo(): SymbolInformation;
    addChild(node: SyntaxNode): void;
    getLocalLocations(): Location[];
    addRefrence(uri: string, node: SyntaxNode): void;
    getGlobalLocations(): Location[];
    getAllLocations(): Location[];
    getRefrenceCount(): number;
    getDefinintion(): Location;
}
export declare function getSymbolKind(node: SyntaxNode): SymbolKind;
//# sourceMappingURL=diagnostics.d.ts.map