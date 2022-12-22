import {
    SymbolInformation,
    WorkspaceSymbol,
    SymbolKind,
    DocumentSymbol,
    LocationLink,
    Location,
    DocumentUri,
} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
//import {logger} from './logger';
import {execFindDependency} from './utils/exec';
import {findFunctionScope, isCommand, isCommandFlag, isFunctionDefinition, scopeCheck, isStatement, isString, isVariable, isVariableDefintion} from './utils/node-types';
import {getChildNodes, getPrecedingComments, getRange} from './utils/tree-sitter';

// using vscode-languageserver v8.0.2 sotherefore, you should use a more acvance exampled of
// SymbolKind, DocumentSymbol,


// ~~~~REMOVE IF UNUSED LATER~~~~
function toSymbolKind(node: SyntaxNode): SymbolKind {
    if (isVariableDefintion(node)) {
        return SymbolKind.Variable
    } else if (isFunctionDefinition(node)) {
        return SymbolKind.Function;
    } else if (isCommand(node)) {
        return SymbolKind.Class;
    } else if (isString(node)) { 
        return SymbolKind.String;
    } else if (isCommandFlag(node)) {
        return SymbolKind.Field;
    }
    return SymbolKind.Null
}


function firstNodeBeforeSecondNodeComaprision(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode
) {
    return (
        firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.text == secondNode.text
    )
}

export function findLocalDefinition(uri: DocumentUri, root: SyntaxNode, findNode: SyntaxNode): LocationLink[] | undefined {
    const results: LocationLink[] = []
    const possibleResults: LocationLink[] = [];
    const fallbackResults: LocationLink[] = [];
    if (findNode.text === "argv") { 
        const func = findFunctionScope(findNode);
        const funcName = func?.child(1) || func;
        return [{
            targetUri: uri,
            targetRange: getRange(func),
            originSelectionRange: getRange(findNode),
            targetSelectionRange: getRange(funcName),
        }]
    }
    for (const node of getChildNodes(root)) {
        if (isFunctionDefinition(node) && node.child(1)?.text === findNode.text) {
            const funcName = node?.child(1) || node;
            results.push({
                originSelectionRange: getRange(findNode),
                targetUri: uri,
                targetRange: getRange(node),
                targetSelectionRange: getRange(funcName),
            })
        }
        if (isVariableDefintion(node) && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
            results.push({
                originSelectionRange: getRange(findNode),
                targetUri: uri,
                targetRange: getRange(node),
                targetSelectionRange: getRange(node),
            })
        }
        if (node.type === 'variable_name' && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
            possibleResults.push({
                originSelectionRange: getRange(findNode),
                targetUri: uri,
                targetRange: getRange(node),
                targetSelectionRange: getRange(node),
            })
        }
        // for commands like:
        //      read arg1 arg2 arg3 
        //           or
        //      function funcName -a arg1 arg2 arg3
        //
        if (node.type === 'word' && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
            fallbackResults.push({
                originSelectionRange: getRange(findNode),
                targetUri: uri,
                targetRange: getRange(node),
                targetSelectionRange: getRange(node),
            })
        }
    }
    if (results.length === 0 && possibleResults.length === 0) {
        return fallbackResults
    }
    if (results.length === 0) {
        return possibleResults
    }
    return results;
}

export function getReferences(uri: DocumentUri, root: SyntaxNode, node: SyntaxNode): Location[] {
    const refrences: Location[] = [];
    for (const newNode of getChildNodes(root)) {
        if (isVariable(newNode) && newNode.text === node.text) {
            refrences.push({
                uri: uri,
                range: getRange(newNode),
            })
        }
    }
    return refrences;
}

/**
 * finds all LOCAL DocumentSymbols for a document (given by its root). getChildNodes is
 * used because if we were to instead try searching from the current node upwards, we
 * have an issue seeing what type of node the current node is. Would be "word", and parent
 * behavior is therefor non-deterministic. To find a symbol in the document, search
 * against the results of this function or another function from 'symbols.ts'
 *
 * @param {SyntaxNode} root - the root node of the document
 * @returns {DocumentSymbol[]} - an array of DocumentSymbols
 */
export function getLocalSymbols(root: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    for (const node of getChildNodes(root)) {
        if (isVariableDefintion(node) && node.parent) {
            symbols.push({
                name: node.text,
                kind: SymbolKind.Variable,
                detail: [getPrecedingComments(node.parent), node.parent.text].join('\n'),
                selectionRange: getRange(node),
                range: getRange(node.parent),
            })
        }
        // add variables (i.e. 'for i in ...; end;' -- i is not included in the symbols)
        if (isFunctionDefinition(node) && node.child(1)) {
            const funcName = node.child(1)!.text ;
            symbols.push({
                name: funcName,
                kind: SymbolKind.Function,
                detail: [getPrecedingComments(node), node.text].join('\n'),
                selectionRange: getRange(node.child(1)!),
                range: getRange(node),
            })
        }
    }
    return symbols;
}

/**
 * Returns a set of symbols on the given document, where the items in the set are 
 * only the nearest refrences to leaf param. Used for completionItems.
 *
 * @param {SyntaxNode} root - the root node to search from
 * @param {SyntaxNode} leaf - the node that results should be nearest to
 * @returns {DocumentSymbol[]} - deduplicated symbols that are nearest to leaf
 */
export function getNearestSymbols(root: SyntaxNode, leaf: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = getLocalSymbols(root);
    const leafRange = getRange(leaf);
    const filteredSymbols: Map<string, DocumentSymbol> = new Map<string, DocumentSymbol>()
    for (const symbol of symbols) {
        if (filteredSymbols.has(symbol.name) && symbol.range.start.line < leafRange.start.line) {
            filteredSymbols.set(symbol.name, symbol)
            continue;
        }
        if (!filteredSymbols.has(symbol.name)) {
            filteredSymbols.set(symbol.name, symbol)
            continue;
        }
    }
    return Array.from(filteredSymbols.values());
}


/**
 * Returns a locationLink to the function definition matching the name of findNode, in
 * the root of the document.
 *
 * @param {DocumentUri} uri - the uri of the document that 'fish_files/get-dependency.fish' found 
 * @param {SyntaxNode} root - the root of the new document
 * @param {SyntaxNode} findNode - the node to find the definition of in the new document
 * @returns {LocationLink[] | undefined} - the locationLink to the definition of findNode
 * or empty array if no definition is found
 */
export function findGlobalDefinition(uri: DocumentUri, root: SyntaxNode, findNode: SyntaxNode) : LocationLink[] | undefined {
    const results : LocationLink[] = [];
    for (const node of getChildNodes(root)) {
        if (isFunctionDefinition(node) && node.child(1)?.text === findNode.text) {
            const funcName = node?.child(1) || node;
            results.push({
                originSelectionRange: getRange(findNode),
                targetUri: uri,
                targetRange: getRange(node),
                targetSelectionRange: getRange(funcName),
            })
        }
    }
    return results;
}

