import {
    SymbolInformation,
    SymbolKind,
    DocumentSymbol,
    LocationLink,
    Location,
    DocumentUri,
} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {logger} from './logger';
import {execFindDependency} from './utils/exec';
import {findFunctionScope, isCommand, isCommandFlag, isFunctionDefinintion, scopeCheck, isStatement, isString, isVariable, isVariableDefintion} from './utils/node-types';
import {ancestorMatch, descendantMatch, getChildNodes, getPrecedingComments, getRange} from './utils/tree-sitter';



function toSymbolKind(node: SyntaxNode): SymbolKind {
    if (isVariableDefintion(node)) {
        return SymbolKind.Variable
    } else if (isFunctionDefinintion(node)) {
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

type lspType = 'definition' | 'refrence';

export interface FishLspSymbol extends SymbolInformation {
    node: SyntaxNode;
    lspType: lspType;
}


function toFishLspSymbol(node: SyntaxNode, lspType: lspType, uri: DocumentUri): FishLspSymbol {
    const symbolType: SymbolKind = toSymbolKind(node);
    const symbol: FishLspSymbol = {
        node: node,
        name: node.text,
        kind: symbolType,
        location: {uri: uri, range: getRange(node)},
        lspType: lspType,
    }
    return symbol;


}



//Servers should whenever possible return DocumentSymbol since it is the richer data structure.
export function getDocumentSymbols(root: SyntaxNode, uri: string) {
    const symbols: FishLspSymbol[] = [];
    for (const node of getChildNodes(root)) {
        if (isFunctionDefinintion(node)) {
            const symb: FishLspSymbol = toFishLspSymbol(node, 'definition', uri);
            symbols.push(symb)
        }
        if (isVariableDefintion(node)) {
            const symb = toFishLspSymbol(node, 'definition', uri);
            symbols.push(symb)
        }
        if (isCommand(node)) {
            const symb = toFishLspSymbol(node, 'refrence', uri);
            symbols.push(symb)
        }
        if (isVariable(node)) {
            const symb = toFishLspSymbol(node, 'refrence', uri);
            if (symb.name === "argv") {
                symb.containerName = ancestorMatch(node, isFunctionDefinintion).at(0)?.child(1)?.text || "";
            }
            symbols.push(symb)
        }
    }
    return symbols
}


//export function getDef(uri: string, root: SyntaxNode, node: SyntaxNode,): LocationLink[] {
//    const def: LocationLink[] = [];
//    const defintions = getDocumentSymbols(root, uri).filter(sym => sym.lspType === 'definition')
//
//    //defintions.includes()
//    for (const fishSymbol of defintions) {
//
//
//    }
//    return def;
//}

//function getVariableSymbols(root: SyntaxNode, map: Map<SyntaxNode, DocumentSymbol[]>): Map<SyntaxNode, DocumentSymbol[]> {
//    for (const node of getChildNodes(root)) {
//        const symbolType = toSymbolKind(node);
//        if (symbolType !== SymbolKind.Variable) {
//            continue;
//        }
//        const symbol: DocumentSymbol = {
//            name: node.text,
//            kind: symbolType,
//            detail: [getPrecedingComments(node), node.text].join('\n'),
//            selectionRange: getRange(node),
//            range: getRange(node),
//        }
//        map.set(node, [symbol]);
//    }
//    return map;
//}

export function findVariableDefinition(uri: DocumentUri, root: SyntaxNode, node: SyntaxNode): LocationLink[] | undefined {
    for (const newNode of getChildNodes(root)) {
        if (isVariableDefintion(newNode) && newNode.text === node.text) {
            return [{
                targetUri: uri,
                targetRange: getRange(newNode),
                originSelectionRange: getRange(node),
                targetSelectionRange: getRange(newNode),
            }]
        }
    }
    return []
}

//const refrences = ancestorMatch(node,
//    isVariableDefintion
//, false).filter((varDef: SyntaxNode) => varDef.text === node.text);

//if (refrences.length === 0) {
//    return []
//}

//for (const ref of refrences) {
//    logger.logNode(ref, 'insideDef')
//}

//return refrences.map(resultNode => {
//    return {
//        originSelectionRange: getRange(node),
//        targetUri: uri,
//        targetRange: getRange(resultNode),
//        targetSelectionRange: getRange(resultNode),
//    } as LocationLink
//});




function firstNodeBeforeSecondNodeComaprision(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode
) {
    return (
        firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.text == secondNode.text
        //firstNode.startPosition.column < secondNode.startPosition.column &&
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
        if (isFunctionDefinintion(node) && node.child(1)?.text === findNode.text) {
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
        if (isFunctionDefinintion(node) && node.child(1)) {
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

//export function findLocalCommandDefinitions(node: SyntaxNode, uri: DocumentUri): LocationLink[] | undefined {
//
//    const refrences = ancestorMatch(node,
//        isFunctionDefinintion
//    , false).filter((command: SyntaxNode) => command.child(1)?.text === node.text);
//
//    if (refrences.length === 0) {
//        return []
//    }
//
//    for (const ref of refrences) {
//        logger.logNode(ref, 'insideDef')
//    }
//
//    return refrences.map(resultNode => {
//        return {
//            originSelectionRange: getRange(node),
//            targetUri: uri,
//            targetRange: getRange(resultNode),
//            targetSelectionRange: getRange(resultNode),
//        } as LocationLink
//    });
//}


export function findGlobalDefinition(uri: DocumentUri, root: SyntaxNode, findNode: SyntaxNode) : LocationLink[] | undefined {
    const results : LocationLink[] = [];
    for (const node of getChildNodes(root)) {
        if (isFunctionDefinintion(node) && node.child(1)?.text === findNode.text) {
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




