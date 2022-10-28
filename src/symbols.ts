import {
    SymbolInformation,
    SymbolKind,
    DocumentSymbol,
    LocationLink,
    DocumentUri,
} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {logger} from './logger';
import {isCommand, isCommandFlag, isFunctionDefinintion, isStatement, isString, isVariable, isVariableDefintion} from './utils/node-types';
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


//Servers should whenever possible return DocumentSymbol since it is the richer data structure.
export function getDocumentSymbols(root: SyntaxNode) {
    let symbolMap = new Map<SyntaxNode, DocumentSymbol[]>();
    symbolMap = getVariableSymbols(root, symbolMap);
    //for (const node of getChildNodes(root)) {
    //    const symbolType = toSymbolKind(node);
    //    if (symbolType === SymbolKind.Null || symbolMap.has(node)) {
    //        continue;
    //    }
    //    if (symbolType === SymbolKind.Variable) {
    //        const commentText = getPrecedingComments(node)
    //        const symbol : DocumentSymbol = {
    //            name: node.text,
    //            kind: symbolType,
    //            detail: commentText,
    //            range: getRange(node),
    //            selectionRange: getRange(node),
    //        }
    //        //if (symbolType === SymbolKind.Function) {
    //        //    symbol.children = getChildNodes(node).map(child => {
    //        //        const childSymbol = {
    //        //            name: child.text,
    //        //            kind: toSymbolKind(child),
    //        //            detail: getPrecedingComments(child),
    //        //            range: getRange(child),
    //        //            selectionRange: getRange(child),
    //        //        }
    //        //        symbolMap.set(child, childSymbol);
    //        //        return childSymbol
    //        //    })
    //        //}
    //        symbolMap.set(node, symbol);
    //    }
    //}

    return symbolMap


    //descendantMatch(root, isFunctionDefinintion, false).forEach((node: SyntaxNode) => {
    //    const symbol = symbolMap.get(node);
    //    if (symbol) {
    //        symbol.children?.push(...getChildNodes(node).filter((child) => symbolMap.get(child) !== undefined).map((child) => symbolMap.get(child)))
    //    }
    //})

    //descendantMatch(root, isVariableDefintion, false).forEach((node) => {
    //    const symbol = symbolMap.get(node);
    //    if (symbol) {
    //        symbol.children?.push(getChildNodes(node).filter((child) => symbolMap.get(child) !== undefined).map((child) => symbolMap.get(child)))
    //    }
    //})

}


function getVariableSymbols(root: SyntaxNode, map: Map<SyntaxNode, DocumentSymbol[]>): Map<SyntaxNode, DocumentSymbol[]> {
    for (const node of getChildNodes(root)) {
        const symbolType = toSymbolKind(node);
        if (symbolType !== SymbolKind.Variable) {
            continue;
        }
        const symbol: DocumentSymbol = {
            name: node.text,
            kind: symbolType,
            detail: [getPrecedingComments(node), node.text].join('\n'),
            selectionRange: getRange(node),
            range: getRange(node),
        }
        map.set(node, [symbol]);
    }
    return map;
}

export function findVariableDefinition(node: SyntaxNode, uri: DocumentUri): LocationLink[] | undefined {

    const refrences = ancestorMatch(node,
        isVariableDefintion
    , false).filter((varDef: SyntaxNode) => varDef.text === node.text);

    if (refrences.length === 0) {
        return []
    }

    for (const ref of refrences) {
        logger.logNode(ref, 'insideDef')
    }

    return refrences.map(resultNode => {
        return {
            originSelectionRange: getRange(node),
            targetUri: uri,
            targetRange: getRange(resultNode),
            targetSelectionRange: getRange(resultNode),
        } as LocationLink
    });
}






