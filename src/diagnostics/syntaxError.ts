import {Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isBlock, isError, isFunctionDefinition} from '../utils/node-types';
import {findFirstParent, getChildNodes, getRange} from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';
 // https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/diagnostic-queue.ts
export function syntaxError(uri: string, root: SyntaxNode, nodes: SyntaxNode[]): Diagnostic[] {
    const syntaxErrors = nodes.filter(isError).map(n => getChildNodes(n).filter(isBlock)).flat().map(n => n.firstChild || n)
    const result: Diagnostic[] = []
    return nodes.filter(isError).map(e => e.firstChild || e)
        .map((syntaxError) => {
            return Diagnostic.create(
                getRange(syntaxError),
                `SyntaxError: missing "end" command`,
                DiagnosticSeverity.Warning,
                errorCodes.missingEnd,
                "fish-lsp",
                syntaxErrors.map((n) => DiagnosticRelatedInformation.create({uri, range: getRange(n)}, "possibly missing end command"))
            )
        })
}

//return Diagnostic.create(
    //getRange(syntaxError),
    //`Syntax Error`,
    //DiagnosticSeverity.Error,
    //2,
    //"fish-lsp"
//);


