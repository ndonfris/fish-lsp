

import { DocumentSymbol, SymbolKind, Range, } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition } from './utils/node-types'
import { DocumentationStringBuilder } from './utils/symbol-documentation-builder';
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
export function betterGetFishDocumentSymbols(uri: string, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    for (const node of currentNodes) {
        const childrenSymbols = betterGetFishDocumentSymbols(uri, ...node.children);
        const { shouldCreate, kind, child, parent } = symbolCheck(node);
        if (shouldCreate) {
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


function symbolCheck(node: SyntaxNode): {
    shouldCreate: boolean;
    kind: SymbolKind;
    child: SyntaxNode;
    parent: SyntaxNode;
}{
    let shouldInclude = false;
    let [child, parent] = [ node, node ];
    let kind: SymbolKind = SymbolKind.Null;
    if (isVariableDefinition(node)) {
        parent = node.parent!;
        kind = SymbolKind.Variable;
        shouldInclude = true;
    }
    if (isFunctionDefinition(node)) {
        child = node.firstNamedChild!;
        kind = SymbolKind.Function;
        shouldInclude = true;
    }
    return {
        shouldCreate: shouldInclude,
        kind,
        child,
        parent,
    }
}


export function flattenFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const flattened: FishDocumentSymbol[] = [];
    symbols.forEach((symbol) => {
        flattened.push(symbol);
        flattened.push(...flattenFishDocumentSymbols(symbol.children));
    })
    return flattened;
}


