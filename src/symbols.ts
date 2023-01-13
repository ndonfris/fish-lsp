import {
    SymbolInformation,
    SymbolKind,
    WorkspaceSymbol,
    DocumentSymbol,
    LocationLink,
    Location,
    DocumentUri,
    
} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isBuiltin} from './utils/builtins';
import {findFunctionScope, isCommand, isFunctionDefinitionName, isFunctionDefinition, isStatement, isString, isVariableDefinition, isProgram, isCommandName, findEnclosingVariableScope} from './utils/node-types';
import {getChildNodes, getPrecedingComments, getRange} from './utils/tree-sitter';


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

/**
 *  Pretty much just for logging a symbol kind 
 */
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




