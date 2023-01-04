import {
    SymbolInformation,
    SymbolKind,
    WorkspaceSymbol,
    DocumentSymbol,
    LocationLink,
    Location,
    DocumentUri,
    ColorInformation,
    Color,
    LinkedEditingRanges,
    
} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
//import {logger} from './logger';
import {isBuiltin} from './utils/builtins';
import {findFunctionScope, isCommand, isCommandFlag, isFunctionDefinitionName, isFunctionDefinition, scopeCheck, isStatement, isString, isVariable, isVariableDefinition, findParentCommand, isProgram, isCommandName, findEnclosingVariableScope} from './utils/node-types';
import {getChildNodes, getNodeAtRange, getPrecedingComments, getRange, nodesGen} from './utils/tree-sitter';


export interface FishSymbolMap {
    [uri: string]: FishSymbol[]
};

// ~~~~REMOVE IF UNUSED LATER~~~~
export function toSymbolKind(node: SyntaxNode): SymbolKind {
    if (isVariableDefinition(node)) {
        return SymbolKind.Variable
    } else if (isFunctionDefinitionName(node)) { // change from isFunctionDefinition(node)
        return SymbolKind.Function;
    } else if (isString(node)) { 
        return SymbolKind.String;
    } else if (isProgram(node) || isFunctionDefinition(node) || isStatement(node)) {
    //} else if (isProgram(node)) {
        return SymbolKind.Namespace
    } else if (isBuiltin(node.text) || isCommandName(node) || isCommand(node)) {
        return SymbolKind.Class;
    }
    return SymbolKind.Null
}

export function symbolKindToString(kind: SymbolKind) {
    switch (kind) {
        case SymbolKind.Variable:
            return 'Variable';
        case SymbolKind.Function:
            return 'Function';
        case SymbolKind.String:
            return 'String';
        case SymbolKind.Namespace:
            return 'Namespace';
        case SymbolKind.Class:
            return 'Class';
        case SymbolKind.Null:
            return 'Null';
        default:
            return 'Other'

    }
}

export interface FishSymbol extends WorkspaceSymbol {
    location: Location;
    data: SyntaxNode;
}

function createFishWorkspaceSymbol(node: SyntaxNode, uri: DocumentUri, containerName?: string): FishSymbol {
    const symbol = WorkspaceSymbol.create(node.text, toSymbolKind(node), uri, getRange(node));
    return {
        ...symbol,
        location: Location.create(uri, getRange(node)),
        data: node,
    }
}

export function collectFishSymbols(documentUri: string, rootNode: SyntaxNode): FishSymbol[] {
    const symbols: FishSymbol[] = [];
    for (const node of getChildNodes(rootNode)) {
        const symbolKind = toSymbolKind(node);
        switch (symbolKind) {
            case SymbolKind.Variable:
                const parentSymbolName = findEnclosingVariableScope(node)?.text || "block"
                symbols.push(createFishWorkspaceSymbol(node, documentUri, parentSymbolName));
                break;
            case SymbolKind.Function:
                symbols.push(createFishWorkspaceSymbol(node, documentUri));
                break;
            case SymbolKind.Namespace:
                symbols.push(createFishWorkspaceSymbol(node, documentUri));
                break;
            //case SymbolKind.Class:
            //    // findParent function or program
            //    symbols.push(createFishWorkspaceSymbol(node, documentUri));
            //    break;
            default:
                break;
        }
    }
    return symbols;
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

export function fishSymbolCompare(symbol1: FishSymbol, symbol2: FishSymbol) {
    return locationCompare(symbol1.location, symbol2.location)
}

function  locationCompare(location1: Location, location2: Location) {
    return location1.uri === location2.uri &&
        location1.range.start.line === location2.range.start.line &&
        location1.range.start.character === location2.range.start.character;
}

//export function findLocalDefinition(uri: DocumentUri, root: SyntaxNode, findNode: SyntaxNode): LocationLink[] | undefined {
//    const results: LocationLink[] = []
//    const possibleResults: LocationLink[] = [];
//    const fallbackResults: LocationLink[] = [];
//    if (findNode.text === "argv") { 
//        const func = findFunctionScope(findNode);
//        const funcName = func?.child(1) || func;
//        return [{
//            targetUri: uri,
//            targetRange: getRange(func),
//            originSelectionRange: getRange(findNode),
//            targetSelectionRange: getRange(funcName),
//        }]
//    }
//    for (const node of getChildNodes(root)) {
//        if (isFunctionDefinition(node) && node.child(1)?.text === findNode.text) {
//            const funcName = node?.child(1) || node;
//            results.push({
//                originSelectionRange: getRange(findNode),
//                targetUri: uri,
//                targetRange: getRange(node),
//                targetSelectionRange: getRange(funcName),
//            })
//        }
//        if (isVariableDefintion(node) && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
//            results.push({
//                originSelectionRange: getRange(findNode),
//                targetUri: uri,
//                targetRange: getRange(node),
//                targetSelectionRange: getRange(node),
//            })
//        }
//        if (node.type === 'variable_name' && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
//            possibleResults.push({
//                originSelectionRange: getRange(findNode),
//                targetUri: uri,
//                targetRange: getRange(node),
//                targetSelectionRange: getRange(node),
//            })
//        }
//        // @TODO: fix this now that definitions are now working
//        // for commands like:
//        //      read arg1 arg2 arg3 
//        //           or
//        //      function funcName -a arg1 arg2 arg3
//        //
//        if (node.type === 'word' && firstNodeBeforeSecondNodeComaprision(node, findNode)) {
//            fallbackResults.push({
//                originSelectionRange: getRange(findNode),
//                targetUri: uri,
//                targetRange: getRange(node),
//                targetSelectionRange: getRange(node),
//            })
//        }
//    }
//    if (results.length === 0 && possibleResults.length === 0) {
//        return fallbackResults
//    }
//    if (results.length === 0) {
//        return possibleResults
//    }
//    return results;
//}


// https://fishshell.com/docs/current/language.html#variables-scope
export function newGetFileDefintions(uri: DocumentUri, root: SyntaxNode, findNode: SyntaxNode): LocationLink[]{
    const results: LocationLink[] = [];
    if (findNode.text === "argv") { 
        const func = findFunctionScope(findNode);
        const funcName = func?.child(1) || func;
        return [LocationLink.create(uri, getRange(func), getRange(findNode), getRange(funcName))]
    }
    const allDefs = getChildNodes(root).filter((node) => {
        return isFunctionDefinitionName(node) || isVariableDefinition(node)
    })

    for (const node of allDefs) {
        if (isFunctionDefinition(node)) {
            const funcName = node?.child(1);
            if (funcName && funcName.text === findNode.text) {
                results.push(LocationLink.create(uri, getRange(node), getRange(funcName), getRange(findNode)))
            }
        } else if (node.text === findNode.text) {
            results.push(LocationLink.create(uri, getRange(node), getRange(node), getRange(findNode)))
        }
    }
    return results
}

export function collectDocumentSymbols(documentUri: string, rootNode: SyntaxNode): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    const functionNodes : SyntaxNode[] = getChildNodes(rootNode).filter((node) => isFunctionDefinitionName(node))
    //const variableNodes: SyntaxNode[] = getChildNodes(rootNode).filter((node) => isVariableDefintion(node))
    const variableNodes: SyntaxNode[] = []
    while (functionNodes.length > 0) {
        const node: SyntaxNode | undefined = functionNodes.shift();
        if (node) {
            const parent = node.parent || node
            const children = getNodesInScope(parent)
            const symbol = DocumentSymbol.create(
                node.text,
                parent.text,
                toSymbolKind(node),
                getRange(node),
                getRange(parent),
                children
            )
            //variableNodes.push(...children.map(child => getNodeAtRange(rootNode, child.range)));
            symbols.push(symbol);
        }
    }
    const globalVariableNodes = getChildNodes(rootNode).filter((node) => isVariableDefinition(node) && !variableNodes.includes(node))

    return symbols;
}

function getNodesInScope(functionNode: SyntaxNode) {
    const enclosingNodes: SyntaxNode[] = [];
    for (const node of getChildNodes(functionNode)) {
        if (isFunctionDefinition(node)) {
            enclosingNodes.push(node)
        } else if (isVariableDefinition(node)) {
            enclosingNodes.push(node)
        }
    }
    return enclosingNodes.map((node) => {
        return DocumentSymbol.create(
            node.text,
            node.text,
            toSymbolKind(node),
            getRange(node),
            getRange(node)
        )
    })
}

export function getReferences(symbols: FishSymbol[], node: SyntaxNode): FishSymbol[] {
    const refrences: FishSymbol[] = [];
    for (const newNode of symbols) {
        if (newNode.kind === SymbolKind.Variable && newNode.name === node.text) {
            refrences.push(newNode)
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
        if (isVariableDefinition(node) && node.parent) {
            symbols.push({
                name: node.text,
                kind: SymbolKind.Variable,
                detail: [getPrecedingComments(node.parent), node.parent.text].join('\n'),
                selectionRange: getRange(node),
                range: getRange(node.parent),
            })
        }
        // add variables (i.e. 'for i in ...; end;' -- i is not included in the symbols)
        if (isFunctionDefinitionName(node) && node.parent) {
            symbols.push({
                name: node.text,
                kind: SymbolKind.Function,
                detail: [getPrecedingComments(node.parent), node.text].join('\n'),
                selectionRange: getRange(node!),
                range: getRange(node.parent),
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
 * @returns {FishSymbol[]} - deduplicated symbols that are nearest to leaf
 */
export function getNearestSymbols(uri: DocumentUri, leaf: SyntaxNode, collectedSymbols: FishSymbol[] = []): FishSymbol[] {
    const leafRange = getRange(leaf);
    const filteredSymbols = new Map<string, FishSymbol>()
    for (const symbol of collectedSymbols) {
        if (symbol.kind === SymbolKind.Variable) {
            if (symbol.name === leaf.text && symbol.location.uri === uri &&
                symbol.location.range.start.line <= leafRange.start.line) {
                    filteredSymbols.set(symbol.name, symbol)
            }
        } else if (symbol.kind === SymbolKind.Function) {
           filteredSymbols.set(symbol.name, symbol)
        }
    }
    //for (const symbol of collectedSymbols) {
        //if (filteredSymbols.has(symbol.name) && symbol.range.start.line < leafRange.start.line) {
            //filteredSymbols.set(symbol.name, symbol)
            //continue;
        //}
        //if (!filteredSymbols.has(symbol.name) && ! isBuiltin(symbol.name)) {
            //filteredSymbols.set(symbol.name, symbol)
            //continue;
        //}
    //}
    return Array.from(filteredSymbols.values());
}

export function getDefinitionSymbols(uri: DocumentUri, root: SyntaxNode): SymbolInformation[] {
    return getChildNodes(root)
        .filter((node) => isFunctionDefinitionName(node) || isVariableDefinition(node))
        .map((node) => {
            return SymbolInformation.create(node.text, toSymbolKind(node), getRange(node), uri.toString());
        })
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

