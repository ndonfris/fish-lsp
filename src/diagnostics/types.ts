import { SyntaxNode } from 'web-tree-sitter';
import { Diagnostic } from 'vscode-languageserver-protocol';
import { ErrorCodes } from './error-codes';
import { FishSymbol } from '../parsing/symbol';

// Utilities related to building a documents Diagnostics.

/**
 * Allow the node to be reachable from any Diagnostic
 */
export interface FishDiagnostic extends Diagnostic {
  message: string;
  range: any;
  data: {
    node: SyntaxNode;
    fromSymbol: boolean;
  };
}

export namespace FishDiagnostic {
  export function create(
    code: ErrorCodes.CodeTypes,
    node: SyntaxNode,
    message: string = '',
  ): FishDiagnostic {
    const errorMessage = message && message.length > 0
      ? ErrorCodes.codes[code].message + ' | ' + message
      : ErrorCodes.codes[code].message;
    return {
      ...ErrorCodes.codes[code],
      range: {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
      },
      message: errorMessage,
      data: {
        node,
        fromSymbol: false,
      },
    };
  }

  export function fromDiagnostic(diagnostic: Diagnostic): FishDiagnostic {
    return {
      ...diagnostic,
      data: {
        node: undefined as any,
        fromSymbol: false,
      },
    };
  }

  export function fromSymbol(code: ErrorCodes.CodeTypes, symbol: FishSymbol): FishDiagnostic {
    const diagnostic = create(code, symbol.focusedNode);
    if (code === ErrorCodes.unusedLocalDefinition) {
      const localSymbolType = symbol.isVariable() ? 'variable' : 'function';
      diagnostic.message += ` ${localSymbolType} '${symbol.name}' is defined but never used.`;
    }
    diagnostic.range = symbol.selectionRange;
    diagnostic.data.fromSymbol = true;
    return diagnostic;
  }
}
