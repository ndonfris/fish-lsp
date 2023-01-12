
import {CodeAction, Diagnostic} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {LspDocument} from '../document';
import {getNodeAtRange} from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';

export function handleConversionToCodeAction(diagnostic: Diagnostic, rootNode: SyntaxNode, document: LspDocument): CodeAction | null { 
    const node = getNodeAtRange(rootNode, diagnostic.range);
    switch (diagnostic.code) {
        case errorCodes.privateHelperFunction:
            return {
                title: `Convert '${node!.text}' to private function`,
                edit: {
                    changes: {
                        [document.uri]: [
                            {
                                range: diagnostic.range,
                                newText: '__' + getNodeAtRange(rootNode, diagnostic.range)!.text,
                            }
                        ]
                    }
                }
            }
        case errorCodes.missingAutoloadedFunctionName:
            return  {
                title: `change function '${node!.text}' to '${document.getAutoLoadName()}'`,
                edit: {
                    changes: {
                        [document.uri]: [
                            {
                                range: diagnostic.range,
                                newText: document.getAutoLoadName(),
                            }
                        ]
                    }
                }
            }
        default:
            return null;
    }


}



