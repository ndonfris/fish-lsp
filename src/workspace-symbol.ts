import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {Analyzer} from './analyze';
import {toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, findParentFunction, isCommandName, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFilename} from './utils/translation';
import {getChildNodes, getParentNodes, getRange, positionToPoint} from './utils/tree-sitter';

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

export class SymbolTree {

    root: SyntaxNode;
    _defs: DocumentSymbol[] = [];
    _scopes: SyntaxNode[] = [];

    constructor(root: SyntaxNode) {
        this.root = root;
    }

    setDefinitions() {
        this._defs = getDefinitionSymbols(this.root);
    }

    get definitions() {
        return this._defs;
    }

    setScopes() {
        this._scopes = getChildNodes(this.root).filter((node: SyntaxNode) => isScope(node))
    }

    get functions() {
        return this._defs.filter((symbol: DocumentSymbol) => symbol.kind === SymbolKind.Function)
    }

    getReferences(node: SyntaxNode) {
        if (isVariable(node)) {
            for (const scope of this._scopes) {
                if (containsRange(getRange(scope), getRange(node))) {
                    return getChildNodes(scope).filter((child: SyntaxNode) => isVariable(child) && child.text === node.text)
                }
            }
            //}
            //for (const c of this.functions) {
                //const current = getNodeFromRange(this.root, c.range)
                //if (containsRange(getRange(current), getRange(node))) {
                    //return getChildNodes(current).filter((n: SyntaxNode) => n.text === node.text)
                //}
            //}
        }
        return getChildNodes(this.root).filter((n: SyntaxNode) => n.text === node.text)
    }

    getDefinition(node: SyntaxNode) {
        const result: SyntaxNode[] = []
        if (isVariable(node)) {
            const vars = this.definitions
                .filter((sym: DocumentSymbol) => sym.name === node.text)
                .map((sym: DocumentSymbol) => getNodeFromRange(this.root, sym.range))

            for (const func of this.functions) {
                if (containsRange(func.range, getRange(node))) {
                    const first = func.children?.filter((sym: DocumentSymbol) => sym.name === node.text)
                    //return getNodeFromRange(this.root, first)
                }
            
            }

            for (const c of this.definitions) {
                result.push(getNodeFromRange(this.root, c.selectionRange))
            }
        }
        return null
    }

    get scopes() {
        return this._scopes;
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

export function beforeRange(range: Range, otherRange: Range): boolean {
    if (range.start.line < otherRange.start.line) {
        return true
    } else if (range.start.line === otherRange.start.line) {
        return range.start.character < otherRange.start.character
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

// Heres a way better idea: 
// • get scopes
// • pass nodes to localSymbols(collectDocumentSymbols(scope_node))
// • find scope in range
// • look for definition
export function getDefinitionKind(uri: string, root: SyntaxNode, current: SyntaxNode, locations: Location[]): DefinitionKind {
    if (isBuiltin(current.text)) return DefinitionKind.NONE;
    const currentRange = getRange(current)
    let localSymbols: DocumentSymbol[] = []
    const currentHeight = countParentScopes(current)
    localSymbols = flattenSymbols(
        collectDocumentSymbols(SpanTree.defintionNodes(root)),
        localSymbols,
        currentHeight
    ).filter((symbol: DocumentSymbol) => {
        if (current.text === "argv") {
            return (
                symbol.kind === SymbolKind.Function &&
                containsRange(symbol.range, currentRange)
            );
        } else {
            return symbol.name === current.text;
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


export function getReferences(uri: string, root: SyntaxNode, current: SyntaxNode) {
    const currentText = current.text
    const definition: Location[] = [];
    const newRoot = findEnclosingVariableScope(current) || root
    //const newRoot = getNodeFromRange(root, definition.at(0)!.range).parent!
    return flattenSymbols(collectDocumentSymbols(SpanTree.refrenceNodes(newRoot)), [])
        .filter(symbol => symbol.name === currentText)
        .map(symbol => Location.create(uri, symbol.selectionRange)).reverse()
}

