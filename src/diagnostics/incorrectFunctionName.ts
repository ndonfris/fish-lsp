import os from 'os'
import {Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isBlock, isFunctionDefinition, isFunctionDefinitionName} from '../utils/node-types';
import {findFirstParent, getChildNodes, getRange} from '../utils/tree-sitter';
import { pathToRelativeFilename, uriInUserFunctions, uriToPath} from '../utils/translation';
import * as errorCodes from './errorCodes';


export function incorrectFunctionName(uri: string, root: SyntaxNode, nodes: SyntaxNode[]): Diagnostic[] {
    if (!uriInUserFunctions(uri)) {
        return []
    }
    const shouldHave = pathToRelativeFilename(uri);
    const functions = nodes
        .filter(isFunctionDefinitionName)
        .filter((node) => node.text === shouldHave)

    let result: Diagnostic[] = []
    if (functions.length !== 0) {
        return result
    }
    return nodes
        .filter((n) => isFunctionDefinitionName(n))
        .map((node: SyntaxNode) =>
            Diagnostic.create(
                getRange(node),
                `Warning: fish function '${shouldHave}' not found in '${uriToPath(uri)}'`,
                DiagnosticSeverity.Warning,
                errorCodes.incorrectFunctionName,
                "fish-lsp"
            ))
}



