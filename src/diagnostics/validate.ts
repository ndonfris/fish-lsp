import { Diagnostic, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { containsRange, findEnclosingScope, getChildNodes, getRange } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter, isMatchingCompleteOptionIsCommand, LocalFunctionCallType, isArgparseWithoutEndStdin, isFishLspDeprecatedVariableName, getDeprecatedFishLspMessage } from './node-types';
import { ErrorCodes } from './errorCodes';
import { SyncFileHelper } from '../utils/file-operations';
import { config } from '../config';
import { DiagnosticCommentsHandler } from './comments-handler';
import { logger } from '../logger';
import { isAutoloadedUriLoadsFunctionName } from '../utils/translation';
import { isCommandName, isCommandWithName, isComment, isFunctionDefinitionName, isOption, isString, isTopLevelFunctionDefinition } from '../utils/node-types';
import { isReservedKeyword } from '../utils/builtins';
import { getFishNoExecDiagnostics } from './no-execute-diagnostic';

export interface FishDiagnostic extends Diagnostic {
  data: {
    node: SyntaxNode;
  };
}

export namespace FishDiagnostic {
  export function create(
    code: ErrorCodes.codeTypes,
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
      },
    };
  }

  export function fromDiagnostic(diagnostic: Diagnostic): FishDiagnostic {
    return {
      ...diagnostic,
      data: {
        node: undefined as any,
      },
    };
  }
}

export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  let diagnostics: Diagnostic[] = [];

  const handler = new DiagnosticCommentsHandler();
  const isAutoloadedFunctionName = isAutoloadedUriLoadsFunctionName(doc);

  const docType = doc.getAutoloadType();

  const autoloadedFunctions: SyntaxNode[] = [];
  const topLevelFunctions: SyntaxNode[] = [];
  const functionsWithReservedKeyword: SyntaxNode[] = [];

  const localFunctions: SyntaxNode[] = [];
  const localFunctionCalls: LocalFunctionCallType[] = [];
  const commandNames: SyntaxNode[] = [];

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
      logger.log('isConditionalWithoutQuietCommand', { type: node.type, text: node.text });
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

    if (isArgparseWithoutEndStdin(node) && handler.isCodeEnabled(ErrorCodes.argparseMissingEndStdin)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.argparseMissingEndStdin, node));
    }

    if (isVariableDefinitionWithExpansionCharacter(node) && handler.isCodeEnabled(ErrorCodes.expansionInDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.expansionInDefinition, node));
    }

    if (isFishLspDeprecatedVariableName(node) && handler.isCodeEnabled(ErrorCodes.fishLspDeprecatedEnvName)) {
      logger.log('isFishLspDeprecatedVariableName', doc.getText(getRange(node)));
      diagnostics.push(FishDiagnostic.create(ErrorCodes.fishLspDeprecatedEnvName, node, getDeprecatedFishLspMessage(node)));
    }

    /** store any functions we see, to reuse later */
    if (isFunctionDefinitionName(node)) {
      if (isAutoloadedFunctionName(node)) autoloadedFunctions.push(node);
      if (isTopLevelFunctionDefinition(node)) topLevelFunctions.push(node);
      if (isReservedKeyword(node.text)) functionsWithReservedKeyword.push(node);
      if (!isAutoloadedFunctionName(node)) localFunctions.push(node);
    }

    /** keep this section at end of loop iteration, because it uses continue */
    if (isCommandName(node)) commandNames.push(node);
    if (docType === 'completions') {
      // skip comments and options
      if (isComment(node) || isOption(node)) continue;
      // get the parent and previous sibling, for the next checks
      const { parent, previousSibling } = node;
      if (!parent || !previousSibling) continue;
      // skip if no parent command (note we already added commands above)
      if (!isCommandWithName(parent, 'complete')) continue;
      // skip if no previous sibling (since we're looking for `complete -n/-a/-c <HERE>`)
      if (isMatchingCompleteOptionIsCommand(previousSibling)) {
        // if we find a string, remove unnecessary tokens from arguments
        if (isString(node)) {
          // like this example:        `(cmd; and cmd2)`
          // we remove the characters: `(   ; and     )`
          localFunctionCalls.push({
            node,
            text: node.text.slice(1, -1)
              .replace(/[\(\)]/g, '')  // Remove parentheses
              .replace(/[^\u0020-\u007F]/g, ''), // Keep only ASCII printable chars
          });
          continue;
        }
        // otherwise, just add the node as is (should just be an unquoted command)
        localFunctionCalls.push({ node, text: node.text });
      }
    }
  }

  const isMissingAutoloadedFunction = docType === 'functions'
    ? autoloadedFunctions.length === 0
    : false;

  const isMissingAutoloadedFunctionButContainsOtherFunctions =
    isMissingAutoloadedFunction && topLevelFunctions.length > 0;

  // no function definition for autoloaded function file
  if (isMissingAutoloadedFunction && topLevelFunctions.length === 0) {
    diagnostics.push(FishDiagnostic.create(ErrorCodes.autoloadedFunctionMissingDefinition, root));
  }
  // has functions/file.fish has top level functions, but none match the filename
  if (isMissingAutoloadedFunctionButContainsOtherFunctions) {
    topLevelFunctions.forEach(node => {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.autoloadedFunctionFilenameMismatch, node));
    });
  }
  // has functions with invalid names -- (reserved keywords)
  functionsWithReservedKeyword.forEach(node => {
    diagnostics.push(FishDiagnostic.create(ErrorCodes.functionNameUsingReservedKeyword, node));
  });

  localFunctions.forEach(node => {
    const matches = commandNames.filter(call => call.text === node.text);
    if (matches.length === 0) return;
    if (!localFunctionCalls.some(call => call.node.equals(node))) {
      localFunctionCalls.push({ node, text: node.text });
    }
  });

  const unusedLocalFunction = localFunctions.filter(localFunction => {
    const callableRange = getRange(findEnclosingScope(localFunction)!);
    return !localFunctionCalls.find(call => {
      const callRange = getRange(findEnclosingScope(call.node)!);
      return containsRange(callRange, callableRange) &&
        call.text.split(/[&<>;|! ]/)
          .filter(cmd => !['or', 'and', 'not'].includes(cmd))
          .some(t => t === localFunction.text);
    });
  });

  if (unusedLocalFunction.length > 1) {
    unusedLocalFunction.forEach(node => {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.unusedLocalFunction, node));
    });
  }

  if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
    for (const errorCode of config.fish_lsp_diagnostic_disable_error_codes) {
      diagnostics = diagnostics.filter(diagnostic => diagnostic.code !== errorCode);
    }
  }

  getFishNoExecDiagnostics(doc, diagnostics);

  return diagnostics;
}
