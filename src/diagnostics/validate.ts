
import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'tree-sitter';
import { LspDocument } from '../document';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter } from './node-types';
import { ErrorCodes } from './errorCodes';
import { SyncFileHelper } from '../utils/file-operations';
import { config } from '../cli';

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  let diagnostics: Diagnostic[] = [];

  // compute in single pass
  for (const node of getChildNodes(root)) {
    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      const prebuilt = ErrorCodes.codes[ErrorCodes.missingEnd];
      if (found) {
        diagnostics.push({
          range: getRange(found),
          ...prebuilt,
        });
      }
    }

    if (isExtraEnd(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.extraEnd],
      });
    }

    if (isZeroIndex(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.zeroIndexedArray],
      });
    }

    if (isSingleQuoteVariableExpansion(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.singleQuoteVariableExpansion],
      });
    }

    if (isAlias(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.usedAlias],
      });
    }

    if (isUniversalDefinition(node) && !doc.uri.split('/').includes('conf.d')) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.usedUnviersalDefinition],
      });
    }

    if (isSourceFilename(node) && node.type !== 'subshell' && node.text.includes('/') && !SyncFileHelper.exists(node.text)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.sourceFileDoesNotExist],
      });
    }

    if (isTestCommandVariableExpansionWithoutString(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.testCommandMissingStringCharacters],
      });
    }

    if (isConditionalWithoutQuietCommand(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ErrorCodes.missingQuietOption],
      });
    }

    if (isVariableDefinitionWithExpansionCharacter(node)) {
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
