import { Diagnostic } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { findParentCommand, isClause, isCommand, isCommandName, isConditionalCommand, isEnd, isError, isFunctionDefinition, isFunctionDefinitionName, isIfStatement, isNewline, isPossibleUnreachableStatement, isReturn, isScope, isStatement, isVariable, isVariableDefinition } from '../utils/node-types';
import { findFirstNamedSibling, getChildNodes, getRange, nodesGen } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter } from './node-types';
import { ErrorCodes } from './errorCodes';



export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  const diagnostics: Diagnostic[] = [];

  // compute in single pass
  for (const node of getChildNodes(root)) {

    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      const prebuilt = ErrorCodes.codes[ ErrorCodes.missingEnd ];
      if (found) {
        diagnostics.push({
          range: getRange(found),
          ...prebuilt
        });
      }
    }

    if (isExtraEnd(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.extraEnd ]
      });
    }

    if (isZeroIndex(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.zeroIndexedArray ]
      });
    }

    if (isSingleQuoteVariableExpansion(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.singleQuoteVariableExpansion ]
      });
    }

    if (isAlias(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.usedAlias ]
      });
    }

    if (isUniversalDefinition(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.usedUnviersalDefinition ]
      });
    }

    if (isSourceFilename(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.sourceFileDoesNotExist ]
      });
    }

    if (isTestCommandVariableExpansionWithoutString(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.testCommandMissingStringCharacters ]
      });
    }

    if (isConditionalWithoutQuietCommand(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.missingQuietOption ]
      });
    }

    if (isVariableDefinitionWithExpansionCharacter(node)) {
      diagnostics.push({
        range: getRange(node),
        ...ErrorCodes.codes[ ErrorCodes.expansionInDefinition ]
      });
    }

  }

  return diagnostics;
}
