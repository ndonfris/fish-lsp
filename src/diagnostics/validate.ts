import { Diagnostic, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { getChildNodes } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter } from './node-types';
import { ErrorCodes } from './errorCodes';
import { SyncFileHelper } from '../utils/file-operations';
import { config } from '../config';
import { DiagnosticCommentsHandler } from './comments-handler';
import { logger } from '../logger';

export interface FishDiagnostic extends Diagnostic {
  data: {
    node: SyntaxNode;
  };
}

export namespace FishDiagnostic {
  export function create(
    code: ErrorCodes.codeTypes,
    node: SyntaxNode,
  ): FishDiagnostic {
    return {
      ...ErrorCodes.codes[code],
      range: {
        start: { line: node.startPosition.row, character: node.startPosition.column },
        end: { line: node.endPosition.row, character: node.endPosition.column },
      },
      data: {
        node,
      },
    };
  }
}

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  let diagnostics: Diagnostic[] = [];

  const handler = new DiagnosticCommentsHandler();

  // compute in single pass
  for (const node of getChildNodes(root)) {
    handler.handleNode(node);

    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      if (found && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.missingEnd, found));
      }
    }

    if (isExtraEnd(node) && handler.isCodeEnabled(ErrorCodes.extraEnd)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.extraEnd, node));
    }

    if (isZeroIndex(node) && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.zeroIndexedArray, node));
    }

    if (isSingleQuoteVariableExpansion(node) && handler.isCodeEnabled(ErrorCodes.singleQuoteVariableExpansion)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.singleQuoteVariableExpansion, node));
    }

    if (isAlias(node) && handler.isCodeEnabled(ErrorCodes.usedAlias)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedAlias, node));
    }

    if (isUniversalDefinition(node) && !doc.uri.split('/').includes('conf.d') && handler.isCodeEnabled(ErrorCodes.usedUnviersalDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedUnviersalDefinition, node));
    }

    if (isSourceFilename(node) && node.type !== 'subshell' && node.text.includes('/') && !SyncFileHelper.exists(node.text) && handler.isCodeEnabled(ErrorCodes.sourceFileDoesNotExist)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.sourceFileDoesNotExist, node));
    }

    if (isTestCommandVariableExpansionWithoutString(node) && handler.isCodeEnabled(ErrorCodes.testCommandMissingStringCharacters)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.testCommandMissingStringCharacters, node));
    }

    if (isConditionalWithoutQuietCommand(node) && handler.isCodeEnabled(ErrorCodes.missingQuietOption)) {
      logger.log('isSingleQuoteDiagnostic', { type: node.type, text: node.text });
      const command = node.firstNamedChild || node;
      let subCommand = command;
      if (command.text.includes('string')) {
        subCommand = command.nextSibling || node.nextSibling!;
      }
      const range: Range = {
        start: { line: command.startPosition.row, character: command.startPosition.column },
        end: { line: subCommand.endPosition.row, character: subCommand.endPosition.column },
      };

      diagnostics.push({
        ...FishDiagnostic.create(ErrorCodes.missingQuietOption, node),
        range,
      });
    }

    if (isVariableDefinitionWithExpansionCharacter(node) && handler.isCodeEnabled(ErrorCodes.expansionInDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.expansionInDefinition, node));
    }
  }

  if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
    for (const errorCode of config.fish_lsp_diagnostic_disable_error_codes) {
      diagnostics = diagnostics.filter(diagnostic => diagnostic.code !== errorCode);
    }
  }

  return diagnostics;
}
