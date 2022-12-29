import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, isCommandName, isFunctionDefinition, isFunctionDefinitionName, isProgram, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFilename} from './utils/translation';
import {getChildNodes, getRange} from './utils/tree-sitter';

export function collectSymbolInformation(uri: string, root: SyntaxNode) {
    const symbols: SymbolInformation[] = SpanTree.symbolInformationArray(SpanTree.defintionNodes(root), uri)
    return symbols;
}

export function collectDocumentSymbols(root: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = []
    const tempSymbols = SpanTree.documentSymbolArray(SpanTree.defintionNodes(root))
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
            .filter(innerSymbol => parentSymbol != innerSymbol)
            .filter((innerSymbol: DocumentSymbol) => containsRange(parentSymbol.range, innerSymbol.selectionRange))
    }

    export const nearbySymbols = (root: SyntaxNode, current: SyntaxNode) => {
        const symbols = SpanTree.documentSymbolArray(SpanTree.defintionNodes(root), '')
        const findRange = getRange(current)
        const nearby = symbols.filter((symbol) => containsRange(symbol.range, findRange))
        return nearby
    }

}

// for completions
// needs testcase
// retry with recursive range match against collected symbols
export function nearbySymbols(root: SyntaxNode, curr: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = collectDocumentSymbols(root)
    return flattenSymbols(symbols, []).filter( outer => containsRange(outer.range, getRange(curr)))
}

export function flattenSymbols(current: DocumentSymbol[], result: DocumentSymbol[]): DocumentSymbol[] {
    for (const symbol of current) {
        if (!result.includes(symbol)) result.unshift(symbol)
        if (symbol.children) {
            result.unshift(...flattenSymbols(symbol.children, result))
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






