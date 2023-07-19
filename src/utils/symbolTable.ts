import { SyntaxNode } from 'web-tree-sitter';
import { FishDocumentSymbol } from '../document-symbol';
import { isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isScope, isVariableDefinition} from './node-types';
import { getChildNodes, getRange } from './tree-sitter';
import { Range } from 'vscode-languageserver'


export class SymbolTable {
    private root: ScopeSymbol;

    constructor(node: SyntaxNode) {
        this.root = new ScopeSymbol(node);
    }

}

export class ScopeSymbol {
    private symbols: FishDocumentSymbol[] = [];
    public childScopes: SymbolTable[] = [];
    public parentScope: SymbolTable | null;
    private node: SyntaxNode;

    constructor(node: SyntaxNode, parent: SymbolTable | null = null) {
        this.node = node;
        this.parentScope = parent;
    }

    get range(): Range {
        return getRange(this.node);
    }

    get name(): string {
        return this.node.type;
    }

    public addSymbol(symbol: FishDocumentSymbol): void {
        this.symbols.push(symbol);
    }

    public addScope(scope: SymbolTable): void {
        this.childScopes.push(scope);
    }

    public contains(range: Range): boolean {
        return this.range.start.line <= range.start.line && this.range.end.line >= range.end.line;
    }

    public getSymbols(): FishDocumentSymbol[] {
        return this.symbols;
    }
}