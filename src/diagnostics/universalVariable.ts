


import { getRange, nodesGen } from '../utils/tree-sitter'
import { SyntaxNode, Tree } from "web-tree-sitter";
import { Diagnostic, Range, Position, TextDocument, DiagnosticSeverity, integer, CodeDescription, CodeAction, TextDocumentItem, CodeActionKind } from "vscode-languageserver";
import {findParentCommand, isVariableDefinition} from '../utils/node-types';


export interface UniversalVariable extends Diagnostic {
    range: Range;
    /**
     * The diagnostic's severity. Can be omitted. If omitted it is up to the
     * client to interpret diagnostics as error, warning, info or hint.
     */
    severity?: DiagnosticSeverity;
    /**
     * The diagnostic's code, which usually appear in the user interface.
     */
    code: integer;
    /**
     * An optional property to describe the error code.
     * Requires the code field (above) to be present/not null.
     *
     * @since 3.16.0
     */
    codeDescription: CodeDescription;
    /**
     * A human-readable string describing the source of this
     * diagnostic, e.g. 'typescript' or 'super lint'. It usually
     * appears in the user interface.
     */
    source: string;
    /**
     * The diagnostic's message. It usually appears in the user interface
     */
    message: string;
}

function getUniversalOption(node: SyntaxNode): SyntaxNode | null {
    const cmd = findParentCommand(node)
    if (!cmd) return null
    if (!['set', 'read'].includes(cmd.firstChild?.text || '')) return null
    for (const child of cmd.children) {
        const text = child.text;
        if (text === '--universal') return child
        if (text.startsWith('--')) continue;
        if (text.startsWith('-') && text.includes('U')) return child
    }
    return null
}

export function getUniversalVariableDiagnostics(root: SyntaxNode, document: TextDocumentItem): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    let severity: DiagnosticSeverity = DiagnosticSeverity.Warning;
    let message: string = 'Warning: Universal variables are discouraged outside of interactive sessions';
    if (document.uri.endsWith('config.fish')) {
        severity = DiagnosticSeverity.Error;
        message = "Error: Universal variables are not allowed in config.fish";
    }
    for (const node of nodesGen(root)) {
        if (isVariableDefinition(node)) {
            const universalFlag = getUniversalOption(node);
            if (!universalFlag) continue;
            diagnostics.push(
                Diagnostic.create(
                    getRange(universalFlag),
                    message,
                    severity,
                    101,
                    "fish-lsp",
                ),
            );
        }
    }
    return diagnostics;
}






