import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {Analyzer} from './analyze';
import {toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, findParentFunction, isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFilename} from './utils/translation';
import {findEnclosingScope, findFirstParent, getChildNodes, getNodeAtRange, getParentNodes, getRange, positionToPoint} from './utils/tree-sitter';


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
        getChildNodes(root).filter((node: SyntaxNode) => isVariable(node) || isCommandName(node))

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

    export const spans = (root: SyntaxNode) => {
        const spans: Range[] = []
        const scopeNodes = SpanTree.scopeNodes(root)
        for (const scope of scopeNodes) {
            const span = getRange(scope)
            spans.push(span)
        }
        return spans
    }
}

function createSymbol(node: SyntaxNode, children?: DocumentSymbol[]) : DocumentSymbol | null{
    const parent = node.parent || node;
    if (isVariableDefinition(node)) {
        return {
            name: node.text,
            kind: toSymbolKind(node),
            range: getRange(parent),
            selectionRange: getRange(node),
            children: children || []
        }
    } else if (isFunctionDefinitionName(node)) {
        const name = node.firstNamedChild || node
        return {
            name: name.text,
            kind: toSymbolKind(name),
            range: getRange(parent),
            selectionRange: getRange(name),
            children: children || []
        }
    } else {
        return null;
    }
}

export function getDefinitionSymbols(root: SyntaxNode) {
    let parentSymbol: DocumentSymbol | null = null;
    let currentSymbol: DocumentSymbol | null = null;
    let symbols: DocumentSymbol[] = [];
    let queue: SyntaxNode[] = [root];

    while (queue.length > 0) {
        const node = queue.shift()!;
        if (isVariableDefinition(node)) {
            currentSymbol = createSymbol(node);
            if (!currentSymbol) continue; // should never happen
            if (!parentSymbol) symbols.push(currentSymbol);
            if (parentSymbol && containsRange(parentSymbol.range, currentSymbol.range)) {
                if (!parentSymbol.children) {
                    parentSymbol.children = [];
                }
                parentSymbol.children.push(currentSymbol);
            }
        } else if (isFunctionDefinitionName(node)) {
            currentSymbol = createSymbol(node);
            parentSymbol = currentSymbol;
        } else if (parentSymbol && !containsRange(parentSymbol.range, getRange(node))) {
            symbols.push(parentSymbol)
            parentSymbol = null;
        }
        queue.unshift(...node?.children)
    }
    return symbols;
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

export function precedesRange(before: Range, after: Range): boolean {
  if (before.start.line < after.start.line) {
    return true
  } 
  if (before.start.line === after.start.line && before.start.character < after.start.character) {
    return true
  }
  return false
}

/* Either we need to open a new doc or we have a definition in our current document
 * Or there is no definition (i.e. a builtin)
 */
export enum DefinitionKind {
    LOCAL,
    FILE,
    NONE
}


export function getDefinitionKind(uri: string, root: SyntaxNode, current: SyntaxNode, localDefintions: Location[]): DefinitionKind {
    if (isBuiltin(current.text)) return DefinitionKind.NONE;
    localDefintions.push(...getLocalDefs(uri, root, current))
    if (localDefintions.length > 0) {
        return DefinitionKind.LOCAL;
    }
    if (isCommandName(current)) return DefinitionKind.FILE;
    return DefinitionKind.NONE;
}

export function getLocalDefs(uri: string, root: SyntaxNode, current: SyntaxNode) {
    const definition = current.text === "argv" 
        ? findEnclosingScope(current)
        : getReferences(uri, root, current)
            .map(refLocation => getNodeAtRange(root, refLocation.range))
            .filter(n => n)
            .find(n => n && isDefinition(n)) 
    if (!definition) return []
    return [Location.create(uri, getRange(definition))]
}

export function getReferences(uri: string, root: SyntaxNode, current: SyntaxNode) : Location[]{
    return getChildNodes(root)
        .filter((n) => n.text === current.text)
        .filter((n) => isVariable(n) || isFunctionDefinitionName(n) || isCommandName(n))
        .filter((n) => containsRange(getRange(findEnclosingScope(n)), getRange(current)))
        .map((n) => Location.create(uri, getRange(n))) || []
}

export function getMostRecentReference(uri: string, root: SyntaxNode, current: SyntaxNode) {
    const definitions : SyntaxNode[] = current.text === "argv"
        ? [findEnclosingScope(current)]
        : getChildNodes(root)
        .filter((n) => n.text === current.text)
        .filter((n) => isDefinition(n))

    let mostRecent = definitions.find(n => n && isDefinition(n))
    definitions.forEach(defNode => {
        if (isVariable(current) && precedesRange(getRange(defNode), getRange(current))) {
            mostRecent = defNode
        }
    })
    return mostRecent
}
