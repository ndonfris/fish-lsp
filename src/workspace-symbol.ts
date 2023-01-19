//import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode, Tree} from 'web-tree-sitter';
import {Analyzer} from './analyze';
import {CommentRange, toSymbolKind} from './symbols';
import {isBuiltin} from './utils/builtins';
import {findEnclosingVariableScope, findParentFunction, isCommandName, isDefinition, isFunctionDefinition, isFunctionDefinitionName, isProgram, isScope, isStatement, isVariable, isVariableDefinition} from './utils/node-types';
import {nodeToDocumentSymbol, nodeToSymbolInformation, pathToRelativeFunctionName} from './utils/translation';
import {findEnclosingScope, findFirstParent, getChildNodes, getNodeAtRange, getParentNodes, getRange, positionToPoint} from './utils/tree-sitter';

export function createSymbol(node: SyntaxNode, children: DocumentSymbol[] = []) : DocumentSymbol | null {
    if (isDefinition(node)) {
        const formattedRange = CommentRange.create(node)
        return {
            ...formattedRange.toDocumentSymbol(),
            children,
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
    while (node1) {
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

function getMostRecentSymbols(symbols: DocumentSymbol[], range: Range) {
    const symbolMap: Map<string, DocumentSymbol> = new Map();
    for (const sym of symbols) {
        if (range.start.line <= sym.range.start.line) continue; // skip symbols on same line
        if (symbolMap.has(sym.name)) {                          // place duplicate symbols
            symbolMap.set(sym.name, sym);
            continue;
        } 
        symbolMap.set(sym.name, sym)                             // place initial symbols
    }
    return Array.from(symbolMap.values())
}

export function getNearbySymbols(root: SyntaxNode, range: Range) {
    const symbols: DocumentSymbol[] = getDefinitionSymbols(root);
    const flatSymbols : DocumentSymbol[] = flattenSymbols(symbols);
    const funcs = symbols.filter((sym) => sym.kind === SymbolKind.Function);
    const scopeSymbol = funcs.find((funcSym) => containsRange(funcSym.range, range))
    if (!scopeSymbol) {                                          // symbols outside of any local scope
        return [...getMostRecentSymbols(symbols, range), ...funcs].filter(
        (item: DocumentSymbol, index: number, self: DocumentSymbol[]) =>
            self.findIndex((otherItem) => item.name === otherItem.name) === index ) // remove duplicate function symbols
    }
    return [...getMostRecentSymbols(flatSymbols, range), ...funcs].filter(
        (item: DocumentSymbol, index: number, self: DocumentSymbol[]) =>
            self.findIndex((otherItem) => item.name === otherItem.name) === index 
    ) // remove duplicate function symbols
}

function flattenSymbols(symbols: DocumentSymbol[]) {
    const queue = [...symbols];
    const result: DocumentSymbol[] = [];
    while (queue.length > 0) {
        const symbol = queue.shift();
        if (symbol) result.push(symbol);
        if (symbol && symbol.children) queue.unshift(...symbol.children);
    }
    return result;
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



