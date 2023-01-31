import { DocumentSymbol, FoldingRange, FoldingRangeKind, Position, Range, SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from './document';
import { CommentRange, DocumentDefSymbol } from './symbols';
import { isForLoop, isFunctionDefinition, isScope, isVariable, isVariableDefinition } from './utils/node-types';
import { findFirstParent, getChildNodes, getNodeAtRange, getRange, getRangeWithPrecedingComments } from './utils/tree-sitter';
import { containsRange, getNodeFromSymbol, precedesRange } from './workspace-symbol';

export function DocumentSymbolTree(root: SyntaxNode) {
    /**
     * all caches the result of toClientTree(), so that it can be accessed in any other function.
     */
    const all: DocumentSymbol[] = toClientTree(root);
    
    return {
        all: () => all,
        flat: () => flattendClientTree(all),
        last: () => getLastOccurrences(all),
        nearby: (position: Position) => getNearbyCompletionSymbols(position, root, all),
        findDef: (node: SyntaxNode) => find(all, node),
        //findAll: (node: SyntaxNode) => findAll(all, node),
        findRefs: (node: SyntaxNode) => findRefrences(root, all, node),
        folds: (document: LspDocument) => getFolds(document, root, all),
        //exports: () => @TODO
    }
}

/**
 * This is the recursive solution to building the document symbols (for definitions).
 *
 * @see createFunctionDocumentSymbol
 * @see createVariableDocumentSymbol
 *
 * @param {SyntaxNode} node - the node to start the recursive search from
 * @returns {DocumentSymbol[]} - the resulting DocumentSymbols, which is a TREE not a flat list
 */
export function collapseToSymbolsRecursive(node: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    const docSymbol = DocumentDefSymbol();
    if (isFunctionDefinition(node)) {
        const symbol = docSymbol.createFunc(node);
        node.children.forEach((child) => {
            const childSymbols = collapseToSymbolsRecursive(child);
            if (!symbol.children) symbol.children = [];
            symbol.children.push(...childSymbols);
        })
        symbols.push(symbol);
    } else if (isVariableDefinition(node)) {
        const symbol = docSymbol.createVar(node);
        symbols.push(symbol);
    } else {
        node.children.forEach((child) => {
            symbols.push(...collapseToSymbolsRecursive(child));
        })
    }
    return symbols;
}

/**
 * gets all the symbols of a depth before the variableNode.
 *
 * `function func_a 
 *     set -l var_b; set -l var_c
 *  end
 *  set -l search_for
 *  echo $search_for `<-- starting here 
 *  would show a pruned tree of:
 *       - `func_a`
 *       - `search_for`
 *  `var_b`, and `var_c` are not reachable and have been pruned
 */
function pruneClientTree(rootNode: SyntaxNode, variableNode: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(rootNode);

    const prunedSymbols: DocumentSymbol[] = []
    let nextSymbols : DocumentSymbol[] = [...symbols]
    let currentNode: SyntaxNode | null = variableNode.parent;

    while (currentNode && currentNode?.type !== 'program') {
        currentNode = currentNode.parent;
        const currentLevel = [...nextSymbols.filter(n => n !== undefined)];
        prunedSymbols.push(...currentLevel);
        nextSymbols = [];
        currentLevel.forEach(symbol => {
            if (symbol.children) nextSymbols.push(...symbol.children)
        })
    }
    return prunedSymbols;
}

/****************************************************************************************
 *                                                                                      *
 * Used in the function DocSymbolTree                                                   *
 *                                                                                      *
 ****************************************************************************************/


/**
 * @param {SyntaxNode} root - The root node of the syntax tree.
 *
 * @returns {DocumentSymbol[]} - The document symbols, with duplicates in the same scope.
 */
export function toClientTree(root: SyntaxNode): DocumentSymbol[] {
    const symbols = collapseToSymbolsRecursive(root);
    const seenSymbols: Set<string> = new Set();
    const result: DocumentSymbol[] = [];

    for (const symbol of symbols) {
        const node = getNodeAtRange(root, symbol.range);
        let parent = node?.parent || node;
        while (parent) {
            if (isScope(parent)) {
                if (!seenSymbols.has(symbol.name)) {
                    seenSymbols.add(symbol.name);
                    result.push(symbol);
                }
                break;
            }
            parent = parent.parent;
        }
    }
    return result;
}


/**
 * Takes in a array of DocumentSymbol[], and returns the last definition for each 
 * duplicate identifier seen (per scope). Used directly to display the hierarchical
 */
function getLastOccurrences(symbols: DocumentSymbol[]) {
    const seenSymbols: Set<string> = new Set();
    const result: DocumentSymbol[] = [];
    for (const symbol of symbols) {
        if (!seenSymbols.has(symbol.name)) {
            seenSymbols.add(symbol.name);
            result.push(symbol);
        }
        if (symbol.children) {
            symbol.children = getLastOccurrences(symbol.children);
        }
    }
    return result;
}

/**
 * Flattens the array of DocumentSymbols, passed in (returns a new array). Is reffered
 * to as ClientTree, because ClientTree's have already removed duplicate identifiers
 * and can be used to display in the Client
 */
function flattendClientTree(symbols: DocumentSymbol[]) : DocumentSymbol[] {
    const stack: DocumentSymbol[] = [...symbols];
    const result: DocumentSymbol[] = [];
    while (stack.length > 0) {
        const symbol = stack.shift();
        if (!symbol) continue;
        result.push(symbol);
        if (symbol.children) stack.unshift(...symbol.children);
    }
    return result;
}


/**
 * creates the flat list of symbols, for the client to use as completions.
 */
function getNearbyCompletionSymbols(position: Position, root: SyntaxNode, all: DocumentSymbol[]) {
    const positionToRange: Range = Range.create(position.line, position.character, position.line, position.character + 1)
    const nearby: DocumentSymbol[] = [];
    const stack: DocumentSymbol[] = [...getLastOccurrences(all)];
    while (stack.length) {
        const symbol = stack.pop()!;
        if (!containsRange(symbol.range, positionToRange)) continue; 
        nearby.push(symbol);
        if (symbol.children) stack.push(...symbol.children)
    }
    // grab all enclosing nearby symbols, then pass in the all symbols
    // to pass in definitions that are found in the same scope.
    // Then we check for duplicates in the same scope, and lastly make sure that 
    // the resulting array does not have false positives.
    return [...nearby, ...all] 
        .filter((item: DocumentSymbol, index: number, self: DocumentSymbol[]) =>
            self.findIndex((otherItem) => item.name === otherItem.name) === index)
        .filter((symbol) => {
            if (symbol.kind === SymbolKind.Function) return true;
            if (symbol.kind === SymbolKind.Variable) {
                if (symbol.selectionRange.start.line > position.line) return false;
                const parentNode = getNodeAtRange(root, symbol.range);
                if (parentNode && isForLoop(parentNode)
                    && !containsRange(symbol.range, positionToRange)) return false;
            }
        return true
    })
}


/**
 * returns an array of folding ranges, currently only for function
 * @returns {FoldingRange} - the folding ranges for any node that is a child of rootNode
 */
function getFolds(document: LspDocument, root: SyntaxNode, all: DocumentSymbol[]): FoldingRange[] {
    const folds: FoldingRange[] = [];
    const flattendDocs = flattendClientTree(all).filter((symbol) => symbol.kind === SymbolKind.Function);
    for (const symbol of flattendDocs) {
        const node = getNodeAtRange(root, symbol.selectionRange);
        if (!node) continue;
        const range = getRangeWithPrecedingComments(node);
        const startLine = range.start.line;
        const endLine = range.end.line > 0 && document.getText(Range.create(
            Position.create(range.end.line, range.end.character - 1),
            range.end,
        )) === 'end' ? Math.max(range.end.line + 1, range.start.line) : range.end.line;
        const foldRange = CommentRange.create(node).toFoldRange()
        folds.push({
            startLine: foldRange.start.line,
            endLine: foldRange.end.line,
            collapsedText: symbol.name,
            kind: FoldingRangeKind.Region
        });
    }
    return folds;
}


/**
 * finds the ( SINGULAR ) DocumentSymbol that matches the node passed in.
 * Uses the DocumentSymbol[] tree passed in.
 * @returns {DocumentSymbol} - the most recent definition of the SyntaxNode passed in
 */
function find(all: DocumentSymbol[], node: SyntaxNode) {
    if (!node) return null;
    if (node.text === "argv" || node.text === "$argv") {
        return flattendClientTree(all).filter(symbol => symbol.kind === SymbolKind.Function && containsRange(symbol.range, targetRange))[0] || null
    }
    const matchingDocSymbols = findAll(all, node);
    if (matchingDocSymbols.length === 0) return null;
    if (!isVariable(node)) return matchingDocSymbols[0] || null
    const targetRange = getRange(node)
    const topDownSymbols = [...matchingDocSymbols]
    while (topDownSymbols.length) {
        const docSymbol = topDownSymbols.pop();
        if (docSymbol && precedesRange(docSymbol?.selectionRange, targetRange)) {
            return docSymbol;
        }
        if (docSymbol?.selectionRange.start.line === targetRange.start.line && docSymbol?.selectionRange.start.character === targetRange.start.character) {
            return docSymbol;
        }
    }
    return matchingDocSymbols[0] || null;
}

function findAll(all: DocumentSymbol[], node?: SyntaxNode) {
    if (!node) return [];
    const flattenedDocs = flattendClientTree(all);
    return flattenedDocs.filter((symbol) => symbol.name === node.text);
}

function findRefrences(root: SyntaxNode, all: DocumentSymbol[], node?: SyntaxNode) {
    if (!node) return [];
    const defDocumentSymbol = find(all, node);
    if (!defDocumentSymbol) return []
    const defNode = getNodeFromSymbol(root, defDocumentSymbol)
    const parentScope = findFirstParent(defNode, (n: SyntaxNode) => isScope(n));
    if (!parentScope) return [];
    return getChildNodes(parentScope).filter((child) => child.text === node.text);
}
