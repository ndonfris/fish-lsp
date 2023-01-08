import {Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity, TextDocumentItem} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isBlock, isFunctionDefinition, isFunctionDefinitionName} from '../utils/node-types';
import {findFirstParent, getChildNodes, getRange, nodesGen} from '../utils/tree-sitter';
import { pathToRelativeFilename, uriInUserFunctions, uriToPath} from '../utils/translation';
import * as errorCodes from './errorCodes';


/**
 * takes the root node of a tree and its corresponding TextDocumentItem. Will return a
 * list of all functions found in the tree that do not have a matching name.
 *
 * @param {SyntaxNode} root - the root node of the tree
 * @param {TextDocumentItem} doc - the document of for the same tree
 * @returns {Diagnostic[]} - a list of diagnostics for all functions that do not have a matching name
 */
export function getMissingFunctionName(root: SyntaxNode, doc: TextDocumentItem): Diagnostic[] {
    const uri = uriToPath(doc.uri)
    if (!uri || !uriInUserFunctions(uri)) return []
    const shouldHaveName = pathToRelativeFilename(uri);
    const childs = getChildNodes(root)
    if (childs.some(n => isFunctionDefinitionName(n) && n.text === shouldHaveName)) return [] // has a function with the matching name
    return childs
        .filter((n) => isFunctionDefinitionName(n))
        .map((node: SyntaxNode) =>
            Diagnostic.create(
                getRange(node),
                `Warning: function '${shouldHaveName}' not found in '${uri}'`,
                DiagnosticSeverity.Warning,
                errorCodes.incorrectFunctionName,
                "fish-lsp"
            ))
}


export function getDuplicateFunctionNames(root: SyntaxNode, doc: TextDocumentItem): Diagnostic[] {
    const names: {[name: string]: SyntaxNode[]} = {}
    const diagnostics: Diagnostic[] = []
    for (const node of nodesGen(root)) {
        if (isFunctionDefinitionName(node)) {
            if (names[node.text]) {
                names[node.text].push(node)
            } else {
                names[node.text] = [node]
            }
        }
    }
    for (const name in names) {
        if (names[name].length > 1) {
            diagnostics.push(
                ...names[name].map((node) => Diagnostic.create(
                    getRange(node),
                    `Warning: duplicate function name '${name}'`,
                    DiagnosticSeverity.Error,
                    errorCodes.duplicateFunctionName,
                    "fish-lsp"
                ))
            )
        }
    }
    return diagnostics
}

