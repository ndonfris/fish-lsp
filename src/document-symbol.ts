

import { DocumentSymbol, SymbolKind, Range, } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition } from './utils/node-types'
import { getRange } from './utils/tree-sitter';

export interface FishDocumentSymbol extends DocumentSymbol {
    name: string;
    detail: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    children: FishDocumentSymbol[];
}

export namespace FishDocumentSymbol {
    /**
     * Creates a new symbol information literal.
     *
     * @param name The name of the symbol.
     * @param detail The detail of the symbol.
     * @param kind The kind of the symbol.
     * @param range The range of the symbol.
     * @param selectionRange The selectionRange of the symbol.
     * @param children Children of the symbol.
     */
    export function create(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range, children: FishDocumentSymbol[]): FishDocumentSymbol {
        return {
            name,
            detail,
            kind,
            range,
            selectionRange,
            children,
        } as FishDocumentSymbol;
    }
}



// write out different methods to structure this function
// 1.) recursive approach with if statements
//     1.1 -> FishDocumentSymbol namespace takes either (functionDefinitionName, variableDefinition) node as argument
//     1.2 -> 
// 2.) recursive approach with (child) nodes to search over as argument 
// 3.) iterative approach
//     2.1 -> 
//     


export function getFishDocumentSymbols(currentNode: SyntaxNode, uri: string): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    //if (isFunctionDefinition(currentNode)) {
    //    const namedNode = currentNode.firstNamedChild!;
    //    const symbol = FishDocumentSymbol.create(
    //        namedNode.text,
    //        getPrecedingCommentString(currentNode),
    //        SymbolKind.Function,
    //        getRange(currentNode),
    //        getRange(namedNode!)
    //    );
    //    currentNode.children.forEach((child: SyntaxNode) => {
    //        const childSymbols = getFishDocumentSymbols(child, uri);
    //        symbol.children.push(...childSymbols);
    //    })
    //    symbols.push(symbol);
    if (isFunctionDefinitionName(currentNode)) { 
        const symbol = FishDocumentSymbol.create(
            currentNode.text,
            getPrecedingCommentString(currentNode.parent!),
            SymbolKind.Function,
            getRange(currentNode.parent!),
            getRange(currentNode),
            []
        );
      currentNode.parent!.children.filter(n => !n.equals(currentNode)).forEach((child: SyntaxNode) => {
        const childSymbols = getFishDocumentSymbols(child, uri);
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(currentNode)) {
        const symbol = FishDocumentSymbol.create(
            currentNode.text,
            getPrecedingCommentString(currentNode.parent!),
            SymbolKind.Variable,
            getRange(currentNode.parent!),
            getRange(currentNode),
            []
        );
        symbols.push(symbol);
    } else {
        currentNode.children.forEach((child) => symbols.push(...getFishDocumentSymbols(child, uri)))
    }
    return symbols;
}


export function betterGetFishDocumentSymbols(currentNodes: SyntaxNode[], uri: string): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    for (const node of currentNodes) {
        const childrenSymbols = betterGetFishDocumentSymbols(node.children, uri);
        let [child, parent] = [ node, node ];
        let kind: SymbolKind = SymbolKind.Null;
        if (isVariableDefinition(node)) {
            parent = node.parent!;
            //parent = node.parent!;
            //const symbol = FishDocumentSymbol.create(
            //    node.text,
            //    getPrecedingCommentString(node.parent!),
            //    SymbolKind.Variable,
            //    getRange(node.parent!),
            //    getRange(node),
            //    childrenSymbols
            //);
            //symbols.push(symbol);
            kind = SymbolKind.Variable;
        } else if (isFunctionDefinition(node)) {
            //const symbol = FishDocumentSymbol.create(
            //    node.firstNamedChild!.text,
            //    getPrecedingCommentString(node),
            //    SymbolKind.Function,
            //    getRange(node),
            //    getRange(node.firstNamedChild!),
            //    childrenSymbols
            //);
            //symbols.push(symbol);
            child = node.firstNamedChild!;
            kind = SymbolKind.Function;
        } 
        if (SymbolKind.Null !== kind) {
            symbols.push(FishDocumentSymbol.create(
                child.text,
                new DocumentationStringBuilder(child, parent).toString(),
                kind,
                getRange(parent),
                getRange(child),
                childrenSymbols
            ));
        } else  {
            symbols.push(...childrenSymbols);
        }
    }
    return symbols;
}

export function flattenFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const flattened: FishDocumentSymbol[] = [];
    symbols.forEach((symbol) => {
        flattened.push(symbol);
        flattened.push(...flattenFishDocumentSymbols(symbol.children));
    })
    return flattened;
}


export class DocumentationStringBuilder {
    private _documentation: string[] = [];
    constructor(private inner: SyntaxNode = inner, private outer: SyntaxNode | null = inner.parent ) { }

    private get precedingComments(): string {
        if (hasPrecedingFunctionDefinition(this.inner) && isVariableDefinition(this.inner)) {
            return this.inner.text
        }
        return getPrecedingCommentString(this.outer || this.inner);
    }

    get text(): string {
        const text = this.precedingComments;
        const lines = text.split('\n');
        if (lines.length > 1 && this.outer) {
            const lastLine = this.outer.lastChild?.startPosition.column || 0;
            return lines.map(line => line.replace(' '.repeat(lastLine), '')).join('\n');
        }
        return text;
    }

    toString() {
        return [this.text].join('\n');
    }
}

export function getPrecedingCommentString(node: SyntaxNode): string {
    const comments: string[] = [node.text];
    let current: SyntaxNode | null = node.previousNamedSibling;
    while (current && current.type === 'comment') {
        comments.unshift(current.text);
        current = current.previousNamedSibling;
    }
    return comments.join('\n');
}

export function hasPrecedingFunctionDefinition(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node.previousSibling;
    while (current) {
        if (isFunctionDefinitionName(current)) {
            return true;
        }
        current = current.previousSibling;
    }
    return false;
}
