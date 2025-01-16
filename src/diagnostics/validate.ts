
import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter } from './node-types';
import { ErrorCodes } from './errorCodes';
import { SyncFileHelper } from '../utils/file-operations';
import { config } from '../cli';
import { DiagnosticCommentsHandler } from './comments-handler';

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  let diagnostics: Diagnostic[] = [];

  const handler = new DiagnosticCommentsHandler();

  // compute in single pass
  for (const node of getChildNodes(root)) {
    handler.handleNode(node);

    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      const prebuilt = ErrorCodes.codes[ErrorCodes.missingEnd];
      if (found && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
        diagnostics.push({
          range: getRange(found),
          ...prebuilt,
        });
      }
    }

    if (isExtraEnd(node) && handler.isCodeEnabled(ErrorCodes.extraEnd)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.extraEnd],
      });
    }

    if (isZeroIndex(node) && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.zeroIndexedArray],
      });
    }

    if (isSingleQuoteVariableExpansion(node) && handler.isCodeEnabled(ErrorCodes.singleQuoteVariableExpansion)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.singleQuoteVariableExpansion],
      });
    }

    if (isAlias(node) && handler.isCodeEnabled(ErrorCodes.usedAlias)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.usedAlias],
      });
    }

    if (isUniversalDefinition(node) && !doc.uri.split('/').includes('conf.d') && handler.isCodeEnabled(ErrorCodes.usedUnviersalDefinition)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.usedUnviersalDefinition],
      });
    }

    if (isSourceFilename(node) && node.type !== 'subshell' && node.text.includes('/') && !SyncFileHelper.exists(node.text) && handler.isCodeEnabled(ErrorCodes.sourceFileDoesNotExist)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.sourceFileDoesNotExist],
      });
    }

    if (isTestCommandVariableExpansionWithoutString(node) && handler.isCodeEnabled(ErrorCodes.testCommandMissingStringCharacters)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.testCommandMissingStringCharacters],
      });
    }

    if (isConditionalWithoutQuietCommand(node) && handler.isCodeEnabled(ErrorCodes.missingQuietOption)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.missingQuietOption],
      });
    }

    if (isVariableDefinitionWithExpansionCharacter(node) && handler.isCodeEnabled(ErrorCodes.expansionInDefinition)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.expansionInDefinition],
      });
    }
  }

  if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
    for (const errorCode of config.fish_lsp_diagnostic_disable_error_codes) {
      diagnostics = diagnostics.filter(diagnostic => diagnostic.code !== errorCode);
    }
  }

  return diagnostics;
}
