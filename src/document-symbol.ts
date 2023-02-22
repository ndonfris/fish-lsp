

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
    export function create(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range, children: FishDocumentSymbol[] = []): FishDocumentSymbol {
        return {
            name,
            detail,
            kind,
            range,
            selectionRange,
            children
        } as FishDocumentSymbol;
    }
}


export function getPrecedingComments(node: SyntaxNode): string {
    const comments: string[] = [node.text];
    let current: SyntaxNode | null = node.previousNamedSibling;
    while (current && current.type === 'comment') {
        comments.unshift(current.text);
        current = current.previousNamedSibling;
    }
    return comments.join('\n');
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
    if (isFunctionDefinition(currentNode)) {
        const namedNode = currentNode.firstNamedChild!;
        const symbol = FishDocumentSymbol.create(
            namedNode.text,
            getPrecedingComments(currentNode),
            SymbolKind.Function,
            getRange(currentNode),
            getRange(namedNode!)
        );
        currentNode.children.forEach((child: SyntaxNode) => {
            const childSymbols = getFishDocumentSymbols(child, uri);
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(currentNode)) {
        const symbol = FishDocumentSymbol.create(
            currentNode.text,
            getPrecedingComments(currentNode.parent!),
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


