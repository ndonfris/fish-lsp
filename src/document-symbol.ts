

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

export function getFishDocumentSymbols(currentNode: SyntaxNode, uri: string): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    if (isFunctionDefinition(currentNode)) {
        const symbol = FishDocumentSymbol.create(
            currentNode.text,
            currentNode.text,
            SymbolKind.Function,
            getRange(currentNode),
            getRange(currentNode.firstNamedChild!)
        );
        currentNode.children.forEach((child: SyntaxNode) => {
            const childSymbols = getFishDocumentSymbols(child, uri);
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(currentNode)) {
        const symbol = FishDocumentSymbol.create(
            currentNode.text,
            currentNode.text,
            SymbolKind.Variable,
            getRange(currentNode),
            getRange(currentNode.firstNamedChild!),
            []
        );
        symbols.push(symbol);
    } else {
        currentNode.children.forEach((child) => symbols.push(...getFishDocumentSymbols(child, uri)))
    }
    return symbols;
}


