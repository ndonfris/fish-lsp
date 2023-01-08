import {Diagnostic} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isCommandName, isError, isReturn} from '../utils/node-types';
import {getSiblingNodes} from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';
import {createDiagnostic} from './fishLspDiagnostic';

// https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/diagnostic-queue.ts
export function getMissingEndSyntaxError(node: SyntaxNode): Diagnostic | null {
    return isError(node)
        ? createDiagnostic(node, errorCodes.missingEnd)
        : null;
}

/**
 * checks if the parser saw a node that it assumes is a command, but is actually an end 
 * node. 
 */
export function getExtraEndSyntaxError(node: SyntaxNode): Diagnostic | null {
    return isCommandName(node) && node.text === "end"
        ? createDiagnostic(node, errorCodes.extraEnd)
        : null;
}

export function getUnreachableCodeSyntaxError(node: SyntaxNode): Diagnostic | null {
    if (!node.isNamed()) return null;
    return getSiblingNodes(node, false).find(n => isReturn(n))
        ?  createDiagnostic(node, errorCodes.unreachableCode)
        : null
}

// was -> getMissingEndSyntaxError(node: SyntaxNode): Diagnostic | null
//if (!isError(node)) return null;
//return {
//    severity: DiagnosticSeverity.Error,
//    code: errorCodes.missingEnd,
//    message: "Error: Missing end",
//    range: getRange(node),
//    source: "fish-lsp",
//    relatedInformation: getChildNodes(node)
//        .filter(isBlock)
//        .map((block) => {
//            return {
//                location: { uri: doc.uri, range: getRange(block) },
//                message: "Potentially missing end",
//            };
//        }),
//};




// const syntaxErrors = nodes.filter(isError).map(n => getChildNodes(n).filter(isBlock)).flat().map(n => n.firstChild || n)
// const result: Diagnostic[] = []
// return nodes.filter(isError).map(e => e.firstChild || e)
//     .map((syntaxError) => {
//         return Diagnostic.create(
//             getRange(syntaxError),
//             `SyntaxError: missing "end" command`,
//             DiagnosticSeverity.Warning,
//             errorCodes.missingEnd,
//             "fish-lsp",
//             syntaxErrors.map((n) => DiagnosticRelatedInformation.create({uri, range: getRange(n)}, "possibly missing end command"))
//         )
//     })

//return Diagnostic.create(
    //getRange(syntaxError),
    //`Syntax Error`,
    //DiagnosticSeverity.Error,
    //2,
    //"fish-lsp"
//);


