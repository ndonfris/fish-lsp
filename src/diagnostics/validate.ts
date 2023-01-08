

import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import {LspDocument} from '../document';
import { getChildNodes, nodesGen } from '../utils/tree-sitter';
import { createAllFunctionDiagnostics, getMissingFunctionName } from './missingFunctionName';
import { getExtraEndSyntaxError, getMissingEndSyntaxError, getUnreachableCodeSyntaxError } from './syntaxError';
import {getUniversalVariableDiagnostics} from './universalVariable';



export function getDiagnostics(root: SyntaxNode, doc: LspDocument) : Diagnostic[] {
    //const children = getChildNodes(root);
    const diagnostics: Diagnostic[] = createAllFunctionDiagnostics(root, doc)
    for (const child of nodesGen(root)) { 
        const diagnostic = getMissingEndSyntaxError(child) || getExtraEndSyntaxError(child) || getUnreachableCodeSyntaxError(child) || getUniversalVariableDiagnostics(child, doc)
        if (diagnostic) diagnostics.push(diagnostic)
    }
    return diagnostics
}



