import {Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isFunctionDefinitionName} from '../utils/node-types';
import {getChildNodes, getRange, nodesGen} from '../utils/tree-sitter';
import { pathToRelativeFunctionName, uriInUserFunctions, uriToPath} from '../utils/translation';
import * as errorCodes from './errorCodes';
import {createDiagnostic} from './fishLspDiagnostic';
import {LspDocument} from '../document';


/**
 * takes the root node of a tree and its corresponding TextDocumentItem. Will return a
 * list of all functions found in the tree that do not have a matching name.
 *
 * @param {SyntaxNode} root - the root node of the tree
 * @param {TextDocumentItem} doc - the document of for the same tree
 * @returns {Diagnostic[]} - a list of diagnostics for all functions that do not have a matching name
 */
export function getMissingFunctionName(root: SyntaxNode, doc: LspDocument): Diagnostic[] {
    const uri = uriToPath(doc.uri)
    if (!uri || !uriInUserFunctions(uri)) return []
    const shouldHaveName = pathToRelativeFunctionName(uri);
    const childs = getChildNodes(root)
    if (childs.some(n => isFunctionDefinitionName(n) && n.text === shouldHaveName)) return [] // has a function with the matching name
    return childs
        .filter((n) => isFunctionDefinitionName(n))
        .map((node: SyntaxNode) =>
            Diagnostic.create(
                getRange(node),
                `Warning: function '${shouldHaveName}' not found in '${uri}'`,
                DiagnosticSeverity.Warning,
                errorCodes.missingAutoloadedFunctionName,
                "fish-lsp"
            ))
}


export function getDuplicateFunctionNames(root: SyntaxNode): Diagnostic[] {
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

function findDupes(nodes: SyntaxNode[]): Diagnostic[] {
    const dupes: SyntaxNode[] = [] 
    //const seenNames = new Set<string>()
    const results: Diagnostic[] = []
    for (const node of nodes) {
        if (!dupes.some(n => n.text === node.text)) continue
        results.push(Diagnostic.create(
            getRange(node),
            `Warning: duplicate function name '${node.text}'`,
            DiagnosticSeverity.Error,
            errorCodes.duplicateFunctionName,
            "fish-lsp"
        ))
    }
    return results
}

function isAutoLoadedFunction(doc: LspDocument): string | null {
    const uri = uriToPath(doc.uri)
    if (!uri || !uriInUserFunctions(uri)) return null
    return pathToRelativeFunctionName(uri)
}

const duplicateNodeNames = (nodes: SyntaxNode[]): SyntaxNode[] => {
    const [dupes, seen] = [[], []] as [SyntaxNode[], SyntaxNode[]];
    for (const node of nodes) {
        if (seen.some(s => s.text === node.text)) dupes.push(node)
        else seen.push(node)
    }
    return dupes
}

const hasOnlyOneDefinition = (nodes: SyntaxNode[], name: string): boolean => {
    return nodes.filter(n => n.text === name).length === 1
}

export function createAllFunctionDiagnostics(root: SyntaxNode, doc: LspDocument): Diagnostic[] {
    const funcs = getChildNodes(root).filter(isFunctionDefinitionName)
    const autoLoadedFuncName = isAutoLoadedFunction(doc)
    //let possibleFuncsToFilenames : SyntaxNode[] = !!funcs.some(n => n.text === autoLoadedFuncName) ? [] : funcs.filter(n => n.text !== autoLoadedFuncName)
    let possibleFuncsToFilenames : SyntaxNode[] =  []
    if (autoLoadedFuncName && !hasOnlyOneDefinition(funcs, autoLoadedFuncName)) {
        possibleFuncsToFilenames =  funcs.filter(n => n.text !== autoLoadedFuncName)
    }
    const duplicateFuncNames : SyntaxNode[] = duplicateNodeNames(funcs)
    return [
        ...possibleFuncsToFilenames.map(n => createDiagnostic(n, errorCodes.missingAutoloadedFunctionName, doc)),
        ...duplicateFuncNames.map(n => createDiagnostic(n, errorCodes.duplicateFunctionName, doc)),
    ]
}
//if (!lazyLoaded)
//const diagnostics: Diagnostic[] = [
//    ...getMissingFunctionName(root, doc),
//    ...findDupes(funcs)
//]
//return diagnostics;

