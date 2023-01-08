

import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { getChildNodes } from '../utils/tree-sitter';
import { getMissingFunctionName } from './missingFunctionName';
import { getMissingEndSyntaxError } from './syntaxError';



export function getDiagnostics(uri: string, root: SyntaxNode) : Diagnostic[] {
    const children = getChildNodes(root);
    return [
        //...getMissingFunctionName( uri, root ),
        //...syntaxError( uri, root, children )
    ]
}



