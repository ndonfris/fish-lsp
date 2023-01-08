import {TextDocument} from 'coc.nvim';
import {Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, TextDocumentItem} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {findParentCommand, isBlock, isCommandName, isEnd, isError, isFunctionDefinition, isReturn} from '../utils/node-types';
import {getSiblingNodes, findFirstParent, getChildNodes, getRange, nodesGen, pointToPosition} from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';
 // https://github.com/typescript-language-server/typescript-language-server/blob/5a39c1f801ab0cad725a2b8711c0e0d46606a08b/src/diagnostic-queue.ts



export function getMissingEndSyntaxError(node: SyntaxNode, doc: TextDocumentItem): Diagnostic | null {
    if (isError(node)) {
        return {
            severity: DiagnosticSeverity.Error,
            code: errorCodes.missingEnd,
            message: "Error: Missing end",
            range: getRange(node),
            source: "fish-lsp",
            relatedInformation: getChildNodes(node)
                .filter(isBlock)
                .map((block) => {
                    return {
                        location: { uri: doc.uri, range: getRange(block) },
                        message: "Potentially missing end",
                    };
                }),
        };
    }
    return null
}

/**
 * checks if the parser saw a node that it assumes is a command, but is actually an end 
 * node.
 */
export function getExtraEndSyntaxError(node: SyntaxNode, doc: TextDocumentItem): Diagnostic | null {
    if (isCommandName(node) && node.text === "end") {
        return {
            severity: DiagnosticSeverity.Error,
            code: errorCodes.missingEnd,
            message: "Error: Extra end",
            range: getRange(node),
            source: "fish-lsp"
        };
    }
    return null
}

export function getUnreachableCodeSyntaxError(node: SyntaxNode, doc: TextDocumentItem): Diagnostic[] {
    if (isReturn(node)) {
        const siblings = getSiblingNodes(node)
        switch (siblings.length) {
            case 0:
                return []
            case 1:
                return [{
                    severity: DiagnosticSeverity.Error,
                    code: errorCodes.missingEnd,
                    message: "Error: unreachable code",
                    range: getRange(siblings[0]),
                    source: "fish-lsp"
                }]
            default: 
                return siblings.map((sibling) => {
                    return {
                        severity: DiagnosticSeverity.Error,
                        code: errorCodes.unreachableCode,
                        message: "Error: unreachable code",
                        range: getRange(sibling),
                        source: "fish-lsp"
                    }
                })
        }
    }
    return []
}


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


