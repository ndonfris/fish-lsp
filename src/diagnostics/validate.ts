

import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes } from '../utils/tree-sitter';
import { incorrectFunctionName } from './incorrectFunctionName';
import { syntaxError } from './syntaxError';



export function getDiagnostics(uri: string, root: SyntaxNode) : Diagnostic[] {
    const children = getChildNodes(root);
    return [
        ...incorrectFunctionName( uri, root, children ),
        //...syntaxError( uri, root, children )
    ]
}



