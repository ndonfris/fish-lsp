import {Range, CodeDescription, Diagnostic, DiagnosticSeverity} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {LspDocument} from '../document';
import {toLspDiagnostic} from '../utils/translation';
import {getRange} from '../utils/tree-sitter';
import * as errorCodes from './errorCodes';

export interface FishLspDiagnostic {
    range: Range,
    severity: DiagnosticSeverity,
    code: Set<number>,
    message: string,
    source: string,
    codeDescription?: CodeDescription,
}

export function createDiagnostic(node: SyntaxNode, code: number, document?: LspDocument): Diagnostic {
    let severity: DiagnosticSeverity = DiagnosticSeverity.Error;
    let message: string;
    let source: string = "fish-lsp";
    let range: Range = getRange(node);
    switch (code) {
        case errorCodes.missingAutoloadedFunctionName:
            severity = DiagnosticSeverity.Warning;
            message = `Warning: function '${node.text}' not found in autoloaded '$FISH_PATH/function' file`
            break;
        case errorCodes.duplicateFunctionName:
            message = `Error: function '${node.text}' already defined`;
            break;
        case errorCodes.missingEnd:
            message = "Error: missing end";
            break;
        case errorCodes.extraEnd:
            message = "Error: extra end";
            break;
        case errorCodes.unreachableCode:
            message = "Error: unreachable code";
            break;
        case errorCodes.universalVariable:
            if (document?.uri.endsWith('config.fish')) {
                message = "Error: Universal variables are not allowed in config.fish";
                break;
            } 
            message = 'Warning: Universal variables are discouraged outside of interactive sessions';
            severity = DiagnosticSeverity.Warning;
            break;
        default:
            message = "Error: unknown error";
            severity = DiagnosticSeverity.Error;
            break;
    }
    return Diagnostic.create(
        range,
        message,
        severity,
        code,
        source,
    );
}


export class DiagnosticQueue {
    private diagnostics: Map<string, FishLspDiagnostic[]> = new Map();

    public getUris(): string[] {
        return Array.from(this.diagnostics.keys());
    }

    public addDiagnostics(uri: string, diagnostics: FishLspDiagnostic[]): void {
        if (!this.diagnostics.has(uri)) {
            this.diagnostics.set(uri, []);
        }
        this.diagnostics.get(uri)?.push(...diagnostics);
    }

    public getDiagnostics(uri: string): Diagnostic[] {
        const fishDiagnostic = this.getFishLspDiagnostics(uri);
        return fishDiagnostic.map((diagnostic) => toLspDiagnostic(diagnostic)).flat()
    }

    public getFishLspDiagnostics(uri: string): FishLspDiagnostic[] {
        return this.diagnostics.get(uri) || [];
    }

    public clearDiagnostics(uri: string): void {
        this.diagnostics.delete(uri);
    }

    public clearAllDiagnostics(): void {
        this.diagnostics.clear();
    }

}

















