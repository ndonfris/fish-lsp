

import { DocumentSymbol, SymbolKind, Range, } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isFunctionDefinitionName, isDefinition, isVariableDefinition, isFunctionDefinition, isVariableDefinitionName, refinedFindParentVariableDefinitionKeyword } from './utils/node-types'
import { DocumentationStringBuilder } from './utils/symbol-documentation-builder';
import { getRange } from './utils/tree-sitter';

// add some form of tags to the symbol so that we can extend the symbol with more information
// current implementation is WIP inside file : ./utils/options.ts
export interface FishDocumentSymbol extends DocumentSymbol {
    name: string;
    uri: string;
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
     * @param uri The documentUri of the symbol.
     * @param range The range of the symbol.
     * @param selectionRange The selectionRange of the symbol.
     * @param children Children of the symbol.
     */
    export function create(name: string,  uri: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range, children: FishDocumentSymbol[]): FishDocumentSymbol {
        return {
            name,
            uri,
            detail,
            kind,
            range,
            selectionRange,
            children,
        } as FishDocumentSymbol;
    }

    export function copy(symbol: FishDocumentSymbol, newChildren: FishDocumentSymbol[] = []): FishDocumentSymbol {
        return {
            name: symbol.name,
            uri: symbol.uri,
            detail: symbol.detail,
            kind: symbol.kind,
            range: symbol.range,
            selectionRange: symbol.selectionRange,
            children: newChildren,
        } as FishDocumentSymbol;
    }
}



export function getFishDocumentSymbols(uri: string, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    for (const node of currentNodes) {
        const childrenSymbols = getFishDocumentSymbols(uri, ...node.children);
        const { shouldCreate, kind, child, parent } = symbolCheck(node);
        if (shouldCreate) {
            symbols.push(FishDocumentSymbol.create(
                child.text,
                uri,
                new DocumentationStringBuilder(child, parent).toString(),
                kind,
                getRange(parent),
                getRange(child),
                childrenSymbols
            ));
            delete currentNodes[currentNodes.indexOf(node)];
            continue;
        }
        symbols.push(...childrenSymbols);
    }
    return symbols;
}

function symbolCheck(node: SyntaxNode): {
    shouldCreate: boolean;
    kind: SymbolKind;
    child: SyntaxNode;
    parent: SyntaxNode;
}{
    let shouldCreate = false;
    let [child, parent] = [ node, node.parent || node ];
    let kind: SymbolKind = SymbolKind.Null;
    if (isVariableDefinition(node)) {
        parent = node.parent || node.firstChild || node
        //console.log('V PARENT : ' + parent.text);
        kind = SymbolKind.Variable;
        shouldCreate = true;
    } else if (isFunctionDefinitionName(node)) {
        parent = node.parent!;
        //console.log('PARENT : ' + parent.text);
        kind = SymbolKind.Function;
        shouldCreate = true;
    }
    return {
        shouldCreate,
        kind,
        child,
        parent,
    }
}

export function flattenFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const queue = [...symbols];
    const result: FishDocumentSymbol[] = [];
    while (queue.length > 0) {
        const symbol = queue.shift();
        if (symbol) result.push(symbol);
        if (symbol && symbol.children) queue.unshift(...symbol.children);
    }
    return result;
}

export function filterLastFishDocumentSymbols(symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
    const result: FishDocumentSymbol[] = []
    for (const symbol of symbols) {
        const uniqs: FishDocumentSymbol[] = [];
        const dupes = filterLastFishDocumentSymbols(symbol.children)
        while (dupes.length > 0) {
            const child = dupes.pop();
            if (child && uniqs.filter(uniq => uniq.name === child.name).length === 0) {
                uniqs.unshift(child);
                continue;
            }
        }
        result.push(FishDocumentSymbol.copy(symbol, uniqs));
    }
    return result;
}


export function tagsParser(child: SyntaxNode, parent: SyntaxNode, uri: string) {
    return;
}

