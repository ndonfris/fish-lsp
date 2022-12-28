import {green} from 'colors';
import {SymbolInformation, Range, SymbolKind, DocumentUri, Location, WorkspaceSymbol, DocumentSymbol} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {toSymbolKind} from './symbols';
import {findEnclosingVariableScope, isFunctionDefinitionName, isProgram, isVariableDefinition} from './utils/node-types';
import {pathToRelativeFilename} from './utils/translation';
import {getChildNodes, getRange} from './utils/tree-sitter';

export function collectSymbolInformation(uri: string, parent: SyntaxNode, symbols: SymbolInformation[], parentName?: string) {
    let shouldInclude = shouldIncludeNode(parent);
    const children = new Set(parent.children);
    const symbolInfo = createSymbolInformation(parent, uri, parentName)
    for (const child of children) {
        const includedChild = collectSymbolInformation(uri, child, symbols);
        //if (containsRange(getRange(parent), getRange(child))) {
        //    shouldInclude = shouldInclude || includedChild;
        //}
    }
    if (shouldInclude) {
        symbols.push(symbolInfo)
    }
    return shouldInclude
}

export function collectDocumentSymbols(uri: string, parent: SyntaxNode,  symbols: DocumentSymbol[]): boolean {
    let shouldInclude = shouldIncludeNode(parent);
    const children = new Set(parent.children || []);
    let includedChild = false;
    const docSymbol = createDocSymbol(parent, uri);
    //const docChildren: DocumentSymbol[] = []
    //if (Array.from(children).some( c => shouldIncludeNode(c))) {
    for (const child of children) {
        if (!docSymbol.children) docSymbol.children = []
        //if (child.children.some( c => shouldIncludeNode(c))) {
        includedChild = collectDocumentSymbols(uri, child, docSymbol.children);
        //}
        //shouldInclude = shouldInclude || includedChild;
        children.delete(child)
        //for (const grandChild of getChildNodes(child)) {
            //children.delete(grandChild)
        //}
        //includedChild = collectDocumentSymbols(uri, child, docSymbol.children);
        if (!shouldInclude && includedChild && docSymbol.children) {
            symbols.push(...docSymbol.children)
        }
    }
    if (shouldInclude) {
        symbols.push(docSymbol)
    }

    return shouldInclude
}


function createDocSymbol(node: SyntaxNode, uri: string): DocumentSymbol {
    const kind = toSymbolKind(node);
    switch (kind) {
        case SymbolKind.Namespace:
            return DocumentSymbol.create(pathToRelativeFilename(uri), 'block', kind, getRange(node), getRange(node))
        case SymbolKind.Function:
            const funcName = node.firstNamedChild as SyntaxNode;
            return DocumentSymbol.create(funcName.text, node.text, kind, getRange(node), getRange(funcName))
        case SymbolKind.Variable:
            return node.parent ? DocumentSymbol.create(node.text, node.parent.text, kind, getRange(node.parent), getRange(node))
                          : DocumentSymbol.create(node.text, '', kind, getRange(node), getRange(node))
        case SymbolKind.Class:
            return DocumentSymbol.create(node.text, node.text, kind, getRange(node), getRange(node))
        default:
            //console.log(green('null: '), node.text, node.type.bgWhite);
            return DocumentSymbol.create(node.text, node.type, kind, getRange(node), getRange(node))
    }
}
// function convertNavTree(
//     output: DocumentSymbol[],
//     item: Proto.NavigationTree,
// ): boolean {
//     let shouldInclude = TypeScriptDocumentSymbolProvider.shouldIncludeEntry(item)
//     const children = new Set(item.childItems || [])
//     for (const span of item.spans) {
//         const range = typeConverters.Range.fromTextSpan(span)
//         const symbolInfo = TypeScriptDocumentSymbolProvider.convertSymbol(item, range)
//         if (children.size) symbolInfo.children = []
// 
//         for (const child of children) {
//             if (child.spans.some(span => !!containsRange(range, typeConverters.Range.fromTextSpan(span)))) {
//                 const includedChild = TypeScriptDocumentSymbolProvider.convertNavTree(symbolInfo.children, child)
//                 shouldInclude = shouldInclude || includedChild
//                 children.delete(child)
//             }
//         }
// 
//         if (shouldInclude) {
//             output.push(symbolInfo)
//         }
//     }
//     return shouldInclude
// }

function containsRange(range: Range, otherRange: Range): boolean {
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

//function getSpans(DocumentSymbol: DocumentSymbol[]): DocumentSymbol[] {
//
//
//}

export function createSymbolInformation(node: SyntaxNode, uri: DocumentUri, parentName?: string): SymbolInformation {
    const kind = toSymbolKind(node);
    const text = (kind === SymbolKind.Namespace) ? pathToRelativeFilename(uri) : node.text;
    return {
        ...SymbolInformation.create(text, kind, getRange(node), uri),
        containerName: parentName,
    };
}

export function shouldIncludeNode(node: SyntaxNode) {
    const kind = toSymbolKind(node);
    //const rootProgramNode = isProgram(node) && node.parent === null;
    //return rootProgramNode || isFunctionDefinitionName(node) || isVariableDefinition(node);
    return kind === SymbolKind.Function || kind === SymbolKind.Variable || kind === SymbolKind.Namespace
}

function includeFinal(kind: SymbolKind) {
    switch (kind) {
        case SymbolKind.Function:
        case SymbolKind.Variable:
        case SymbolKind.Namespace:
            return true
        default:
            return false
    }
    
}

