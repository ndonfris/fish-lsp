import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import {findParentCommand, isCommandName, isEnd, isError, isFunctionDefinitionName, isReturn, isScope, isVariable, isVariableDefinition} from '../utils/node-types';
import { findFirstSibling, nodesGen } from '../utils/tree-sitter';
import {createDiagnostic} from './create';
import { createAllFunctionDiagnostics } from './missingFunctionName';
import { getExtraEndSyntaxError, getMissingEndSyntaxError, getUnreachableCodeSyntaxError } from './syntaxError';
import { getUniversalVariableDiagnostics } from './universalVariable';
import * as errorCodes from './errorCodes'
import {pathVariable} from './errorCodes';

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) : Diagnostic[] {
    const diagnostics: Diagnostic[] = createAllFunctionDiagnostics(root, doc)
    for (const child of nodesGen(root)) { 
        const diagnostic =
            getMissingEndSyntaxError(child) ||
            getExtraEndSyntaxError(child) ||
            getUnreachableCodeSyntaxError(child) ||
            getUniversalVariableDiagnostics(child, doc);
        if (diagnostic) diagnostics.push(diagnostic)
    }
    return diagnostics
}




export function collectDiagnosticsRecursive(root: SyntaxNode, doc: LspDocument) : Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const functionNames: Set<string> = new Set();
    const variableNames: Set<string> = new Set();
    collectAllDiagnostics(root, doc, diagnostics, functionNames, variableNames);
    return diagnostics;
}


function isMissingEnd(node: SyntaxNode) : Diagnostic | null {
    const last = node.lastChild || node.lastNamedChild || node;
    return isError(node) && !isEnd(last)
        ? createDiagnostic(node, errorCodes.missingEnd)
        : null;
}

function isExtraEnd(node: SyntaxNode) : Diagnostic | null {
    return isCommandName(node) && node.text === "end" 
        ?  createDiagnostic(node, errorCodes.extraEnd)
        : null
}

function isSyntaxError(node: SyntaxNode, diagnostic: Diagnostic | null) : Diagnostic | null {
    if (!isError(node) || !!diagnostic) return diagnostic;
    return isError(node)
        ?  createDiagnostic(node, errorCodes.unreachableCode)
        : null
}

function collectEndError(node: SyntaxNode, diagnostics: Diagnostic[]): boolean {
    let didAdd = false;
    let endError = isMissingEnd(node) || isExtraEnd(node)
    endError = isSyntaxError(node, endError)
    if (endError) {
        didAdd = true;
        diagnostics.push(endError)
    }
    return didAdd;
}

function collectFunctionNames(node: SyntaxNode, doc: LspDocument, diagnostics: Diagnostic[], functionNames: Set<string>) : boolean {
    let didAdd = false;

    if (!isFunctionDefinitionName(node)) return didAdd;

    let name : string =  node.text
    let diagnostic: Diagnostic | null = null;
    if (functionNames.has(name)) {
        diagnostic = createDiagnostic(node, errorCodes.duplicateFunctionName); 
        didAdd = true;
    } else if (doc.isAutoLoaded() && name ===  doc.getAutoLoadName()) {
        diagnostic = createDiagnostic(node, errorCodes.missingAutoloadedFunctionName);
        didAdd = true;
    }
    functionNames.add(name);
    if (diagnostic) diagnostics.push(diagnostic);
    return didAdd;
}

function findVariableFlagsIfSeen(node: SyntaxNode, shortOpts: string[], longOpts: string[]) : SyntaxNode | null {
    if (!isVariableDefinition(node)) return null;
    const isUniveralOption = (n: SyntaxNode) => {
        if (n.text.startsWith('--')) return  longOpts.some(opt => n.text == `--${opt}`)
        if (!n.text.startsWith('--') && n.text.startsWith('-')) return shortOpts.some(short => n.text.includes(short));
        return false
    }
    const universalFlag = findFirstSibling(node, isUniveralOption);
    return universalFlag;
}

function getPathVariable(node: SyntaxNode, document: LspDocument, seen: Set<string>): Diagnostic | null {
    let pathVariable: Diagnostic | null = null;
    if (!isVariableDefinition(node)) null;
    const pathFlag = findVariableFlagsIfSeen(node, [], ['path', 'unpath']);
    if (!pathFlag && node.text.endsWith('PATH')) {
        pathVariable = createDiagnostic(node, errorCodes.pathVariable, document)
        seen.add(node.text)
    } 
    if (pathFlag && !node.text.endsWith('PATH')) {
        pathVariable = createDiagnostic(node, errorCodes.pathFlag, document)
        seen.add(node.text)
    }
    return pathVariable
}

function getUniversalVariable(node: SyntaxNode, document: LspDocument, seen: Set<string>): Diagnostic | null {
    if (!isVariableDefinition(node)) return null ;
    let univeralFlag = findVariableFlagsIfSeen(node, ['u'], ['universal']);
    if (!univeralFlag) return null ;
    seen.add(node.text)
    return createDiagnostic(univeralFlag , errorCodes.universalVariable, document)
}

function collectVariableNames(node: SyntaxNode, document: LspDocument, diagnostics: Diagnostic[], varsSeen: Set<string>) {
    if (!isVariableDefinition(node)) return false;
    const diagnostic = getUniversalVariable(node, document, varsSeen) || getPathVariable(node, document, varsSeen)
    if (!diagnostic) return false;
    diagnostics.push(diagnostic)
    return true;
}

function collectReturnError(node: SyntaxNode, diagnostic: Diagnostic[]) {
    if (isReturn(node)) return false;

}

export function collectAllDiagnostics(root: SyntaxNode, doc: LspDocument, diagnostics: Diagnostic[], functionNames: Set<string>, variableNames: Set<string>) : boolean {
    let shouldAdd = collectEndError(root, diagnostics) || collectFunctionNames(root, doc, diagnostics, functionNames) || collectVariableNames(root, doc, diagnostics, variableNames) //|| 
        //collectReturnError(root, diagnostics);
    for (const node of root.children) {
        shouldAdd = collectAllDiagnostics(node, doc, diagnostics, functionNames, variableNames);
    }
    return shouldAdd || false;
}











