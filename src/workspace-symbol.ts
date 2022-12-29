import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {Analyzer} from './analyze';
import {toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, findParentFunction, isCommandName, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFilename} from './utils/translation';
import {getChildNodes, getRange, positionToPoint} from './utils/tree-sitter';

export function collectSymbolInformation(uri: string, root: SyntaxNode) {
    const symbols: SymbolInformation[] = SpanTree.symbolInformationArray(SpanTree.defintionNodes(root), uri)
    return symbols;
}

export function collectDocumentSymbols(mixedNodes: SyntaxNode[]): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = []
    const tempSymbols = SpanTree.documentSymbolArray(mixedNodes)
    for (const symbol of tempSymbols) {
        symbol.children = SpanTree.childDocumentSymbols(symbol, tempSymbols)
        symbol.children.forEach((child) => {
            tempSymbols.splice(tempSymbols.indexOf(child), 1)
        })
        symbols.push(symbol)
    }
    return symbols
}

export namespace SpanTree {

    export const defintionNodes = (root: SyntaxNode) => 
        getChildNodes(root).filter((node: SyntaxNode) => 
            isFunctionDefinitionName(node) || isVariableDefinition(node))

    export const refrenceNodes = (root: SyntaxNode) => 
        getChildNodes(root).filter((node: SyntaxNode) => isVariable(node))

    export const commandNodes = (root: SyntaxNode) => getChildNodes(root)
        .filter((node: SyntaxNode) => isCommandName(node))
        .filter((node: SyntaxNode) => !isBuiltin(node.text))

    export const scopeNodes = (root: SyntaxNode) => getChildNodes(root)
        .filter((node: SyntaxNode) => isStatement(node) || isProgram(node) || isFunctionDefinition(node))

    export const documentSymbolArray = (nodes: SyntaxNode[]) =>
        nodes.map((node: SyntaxNode) => nodeToDocumentSymbol(node))

    export const symbolInformationArray = (nodes: SyntaxNode[], uri: string) =>
        nodes.map((node: SyntaxNode) => nodeToSymbolInformation(node, uri)) 

    export const childDocumentSymbols = (parentSymbol: DocumentSymbol, allSymbols: DocumentSymbol[]) => {
        if (parentSymbol.kind === SymbolKind.Variable) {
            return []
        }
        return allSymbols
            .filter((innerSymbol: DocumentSymbol) => parentSymbol != innerSymbol)
            .filter((innerSymbol: DocumentSymbol) => containsRange(parentSymbol.range, innerSymbol.selectionRange))
    }

    export const nearbySymbols = (root: SyntaxNode, current: SyntaxNode) => {
        const symbols = SpanTree.documentSymbolArray(SpanTree.defintionNodes(root))
        const currRange = getRange(current)
        const nearby = symbols.filter((symbol) => containsRange(symbol.range, currRange))
        return nearby
    }

    export const findDefinitions = (uri: string, root: SyntaxNode, current: SyntaxNode) => {
        const symbols = collectDocumentSymbols(defintionNodes(root))
        const currRange = getRange(current)
        const found : DocumentSymbol[] = symbols.filter(symbol => containsRange(symbol.range, currRange));
        const results: Location[] = []
        let last: DocumentSymbol;
        found.forEach(sym => {
            sym.children?.forEach(child => {
                if (child.name === current.text && beforeRange(child.range, currRange)) {
                    results.push(Location.create(uri, child.range))
                }
            })
        })
    }


}
export function countParentScopes(first: SyntaxNode){
    let node1 : SyntaxNode | null = first;
    let count = 0;
    while (node1 ) {
        if (isScope(node1)) {
            count++;
        }
        node1 = node1.parent
    }
    return count - 1;
}

export function compareParentScopes(first: SyntaxNode, second: SyntaxNode){
    let node1 : SyntaxNode | null = first;
    let node2 : SyntaxNode | null = second;
    while (node1 && node2) {
        if (node1 !== node2) {
            break;
        }
        node1 = node1.parent
        node2 = node2.parent
    }
    return node1?.parent === null && node2?.parent === null;
}

export function getNodeFromRange(root: SyntaxNode, range: Range) {
    return root.descendantForPosition(
        positionToPoint(range.start),
        positionToPoint(range.end)
    ); 
}
export function getNodeFromSymbol(root: SyntaxNode, symbol: DocumentSymbol) {
    return getNodeFromRange(root, symbol.selectionRange)
}

// for completions
// needs testcase
// retry with recursive range match against collected symbols
export function nearbySymbols(root: SyntaxNode, curr: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = collectDocumentSymbols(SpanTree.defintionNodes(root))
    return flattenSymbols(symbols, []).filter( outer => containsRange(outer.range, getRange(curr)))
}

// not really necessary since symbols are converted from flat default
export function flattenSymbols(current: DocumentSymbol[], result: DocumentSymbol[], height?: number): DocumentSymbol[] {
    for (const symbol of current) {
        if (height === undefined) {
            if (!result.includes(symbol)) result.unshift(symbol)
            if (symbol.children) {
                result.unshift(...flattenSymbols(symbol.children, result))
            }
        } else {
            if (height >= 0) {
                if (!result.includes(symbol)) result.unshift(symbol)
                if (symbol.children) {
                    result.unshift(...flattenSymbols(symbol.children, result, height - 1))
                }
            }
        }
    }
    return Array.from(new Set(result))
}

export function flattenScopeSymbols(current: DocumentSymbol[], result: DocumentSymbol[], height: number): DocumentSymbol[] {
    for (const symbol of current) {
        if (!result.includes(symbol)) result.unshift(symbol)
        if (symbol.children && height >= 0) {
            result.unshift(...flattenScopeSymbols(symbol.children, result, height-1))
        }
    }
    return Array.from(new Set(result))
}

export function containsRange(range: Range, otherRange: Range): boolean {
  if (otherRange.start.line < range.start.line || otherRange.end.line < range.start.line) {
    return false
  }
  if (otherRange.start.line > range.end.line || otherRange.end.line > range.end.line) {
    return false
  }
  if (otherRange.start.line === range.start.line && otherRange.start.character < range.start.character) {
    return false
  }
  if (otherRange.end.line === range.end.line && otherRange.end.character > range.end.character) {
    return false
  }
  return true
}

export function beforeRange(range: Range, otherRange: Range): boolean {
    if (range.start.line < otherRange.start.line) {
        return true
    } else if (range.start.line === otherRange.start.line) {
        return range.start.character < otherRange.start.character
    } 
    return false
}

export enum DefinitionKind {
    LOCAL,
    FILE,
    NONE
}

// Heres a way better idea: 
// • get scopes
// • pass nodes to localSymbols(collectDocumentSymbols(scope_node))
// • find scope in range
// • look for definition
export function getDefinitionKind(uri: string, root: SyntaxNode, current: SyntaxNode, locations: Location[]): DefinitionKind {
    if (isBuiltin(current.text)) return DefinitionKind.NONE;

    let hasLocalSymbols = false;
    const currentRange = getRange(current)
    let localSymbols: DocumentSymbol[] = []
    const currentHeight = countParentScopes(current)
    

    localSymbols = flattenSymbols(collectDocumentSymbols(SpanTree.defintionNodes(root)), localSymbols, currentHeight)
        .filter((symbol: DocumentSymbol) => {
            if (current.text === 'argv') {
                return symbol.kind === SymbolKind.Function && containsRange(symbol.range, currentRange)
            } else {
                return symbol.name === current.text
            }
        });

    if (localSymbols.length > 0) {
        if (isVariable(current) && current.text !== 'argv') {
            const variableScopes = localSymbols
                .filter(symbol => containsRange(symbol.range, currentRange) || symbol.kind === SymbolKind.Variable)
                .filter((symbol: DocumentSymbol) => beforeRange(symbol.selectionRange, currentRange))

            let last: DocumentSymbol = variableScopes.at(-1)!;
            variableScopes.forEach(node => {
                if (beforeRange(last.selectionRange, node.selectionRange)) {
                    last = node
                }
            })
            locations.push(Location.create(uri, last.selectionRange))
        } else {
            for (const symbol of localSymbols) {
                locations.push(Location.create(uri, symbol.selectionRange))
            }
        }
        return DefinitionKind.LOCAL;
    }
    if (isCommandName(current)) return DefinitionKind.FILE;
    return DefinitionKind.NONE;
}




