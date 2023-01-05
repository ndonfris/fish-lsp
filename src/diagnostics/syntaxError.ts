import {Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isBlock, isError, isFunctionDefinition} from '../utils/node-types';
import {findFirstParent, getChildNodes, getRange} from '../utils/tree-sitter';

export function syntaxError(uri: string, root: SyntaxNode, nodes: SyntaxNode[]): Diagnostic[] {
    const syntaxErrors = nodes.filter(isError).map(n => getChildNodes(n).filter(isBlock)).flat().map(n => n.firstChild || n)
    const result: Diagnostic[] = nodes.filter(isError).map(e => e.firstChild || e)
        .map((syntaxError) => {
        return Diagnostic.create(
            getRange(syntaxError),
            `SyntaxError: missing "end" command`,
            DiagnosticSeverity.Warning,
            2,
            "fish-lsp",
            syntaxErrors.map((n) => DiagnosticRelatedInformation.create({uri, range: getRange(n)}, "possibly missing end command"))
        )
    })
    return result;
}
//return Diagnostic.create(
    //getRange(syntaxError),
    //`Syntax Error`,
    //DiagnosticSeverity.Error,
    //2,
    //"fish-lsp"
//);


