import { Diagnostic, DiagnosticRelatedInformation, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { findEnclosingScope, getChildNodes, getRange } from '../utils/tree-sitter';
import { containsRange } from '../utils/tree-sitter';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isAlias, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isVariableDefinitionWithExpansionCharacter, isMatchingCompleteOptionIsCommand, LocalFunctionCallType, isArgparseWithoutEndStdin, isFishLspDeprecatedVariableName, getDeprecatedFishLspMessage, isDotSourceCommand, isMatchingAbbrFunction, isFunctionWithEventHookCallback } from './node-types';
import { ErrorCodes } from './error-codes';
import { config } from '../config';
import { DiagnosticCommentsHandler } from './comments-handler';
import { logger } from '../logger';
import { isAutoloadedUriLoadsFunctionName, uriToReadablePath } from '../utils/translation';
import { isCommandName, isCommandWithName, isComment, isCompleteCommandName, isFunctionDefinitionName, isOption, isString, isTopLevelFunctionDefinition } from '../utils/node-types';
import { isReservedKeyword } from '../utils/builtins';
import { getNoExecuteDiagnostics } from './no-execute-diagnostic';
import { checkForInvalidDiagnosticCodes } from './invalid-error-code';
import { analyzer } from '../analyze';
import { FishSymbol } from '../parsing/symbol';

// Utilities related to building a documents Diagnostics.

/**
 * Allow the node to be reachable from any Diagnostic
 */
export interface FishDiagnostic extends Diagnostic {
  data: {
    node: SyntaxNode;
    symbol?: FishSymbol;
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

/**
 * Handle building the diagnostics for the document passed in.
 * This will also handle any comment that might disable/enable certain diagnostics per range
 */
export function getDiagnostics(root: SyntaxNode, doc: LspDocument) {
  const diagnostics: Diagnostic[] = [];

  const handler = new DiagnosticCommentsHandler();
  const isAutoloadedFunctionName = isAutoloadedUriLoadsFunctionName(doc);

  const docType = doc.getAutoloadType();

  // ensure the document is analyzed
  analyzer.ensureCachedDocument(doc);

  // arrays to keep track of different groups of functions
  const allFunctions: FishSymbol[] = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.isFunction());
  const autoloadedFunctions: SyntaxNode[] = [];
  const topLevelFunctions: SyntaxNode[] = [];
  const functionsWithReservedKeyword: SyntaxNode[] = [];

  const localFunctions: SyntaxNode[] = [];
  const localFunctionCalls: LocalFunctionCallType[] = [];
  const commandNames: SyntaxNode[] = [];
  const completeCommandNames: SyntaxNode[] = [];

  // callback to check if the function has an `--event` handler && the handler is enabled at the node
  const isFunctionWithEventHook = isFunctionWithEventHookCallback(doc, handler, allFunctions);

  // compute in single pass
  for (const node of getChildNodes(root)) {
    handler.handleNode(node);

    // Check for invalid diagnostic codes first
    const invalidDiagnosticCodes = checkForInvalidDiagnosticCodes(node);
    if (invalidDiagnosticCodes.length > 0) {
      // notice, this is the only case where we don't check if the user has disabled the error code
      // because `# @fish-lsp-disable` will always be recognized as a disabled error code
      diagnostics.push(...invalidDiagnosticCodes);
    }

    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      if (found && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.missingEnd, node));
        if (docType === 'conf.d') {
          return diagnostics;
        }
      }
    }

    if (isExtraEnd(node) && handler.isCodeEnabled(ErrorCodes.extraEnd)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.extraEnd, node));
    }

    if (isZeroIndex(node) && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.zeroIndexedArray, node));
    }

    if (isSingleQuoteVariableExpansion(node) && handler.isCodeEnabled(ErrorCodes.singleQuoteVariableExpansion)) {
      // don't add this diagnostic if the autoload type is completions
      if (doc.getAutoloadType() !== 'completions') {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.singleQuoteVariableExpansion, node));
      }
    }

    if (isAlias(node) && handler.isCodeEnabled(ErrorCodes.usedAlias)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedAlias, node));
    }

    if (isUniversalDefinition(node) && !doc.uri.split('/').includes('conf.d') && handler.isCodeEnabled(ErrorCodes.usedUnviersalDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedUnviersalDefinition, node));
    }

    if (isSourceFilename(node) && handler.isCodeEnabled(ErrorCodes.sourceFileDoesNotExist)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.sourceFileDoesNotExist, node));
    }

    if (isDotSourceCommand(node) && handler.isCodeEnabled(ErrorCodes.dotSourceCommand)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.dotSourceCommand, node));
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

    if (isVariableDefinitionWithExpansionCharacter(node) && handler.isCodeEnabled(ErrorCodes.dereferencedDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.dereferencedDefinition, node));
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
      if (isFunctionWithEventHook(node)) {
        // TODO: add support for `emit` to reference the event hook
        diagnostics.push(
          FishDiagnostic.create(
            ErrorCodes.autoloadedFunctionWithEventHookUnused,
            node,
            `Function '${node.text}' has an event hook but is not called anywhere in the workspace.`,
          ),
        );
      }
    }

    // skip comments and options
    if (isComment(node) || isOption(node)) continue;

    /** keep this section at end of loop iteration, because it uses continue */
    if (isCommandName(node)) commandNames.push(node);

    // get the parent and previous sibling, for the next checks
    const { parent, previousSibling } = node;
    if (!parent || !previousSibling) continue;

    // skip if this is an abbr function, since we don't want to complete abbr functions
    if (isCommandWithName(parent, 'abbr') && isMatchingAbbrFunction(previousSibling)) {
      localFunctionCalls.push({ node, text: node.text });
      continue;
    }

    // if the current node is a bind subcommand `bind ctrl-k <CMD>` where `<CMD>` gets added to the localFunctionCalls
    if (isCommandWithName(parent, 'bind')) {
      const subcommands = parent.children.slice(2).filter(c => !isOption(c));
      subcommands.forEach(subcommand => {
        if (isString(subcommand)) {
          // like this example:        `(cmd; and cmd2)`
          // we remove the characters: `(   ; and     )`
          localFunctionCalls.push({
            node,
            text: subcommand.text.slice(1, -1)
              .replace(/[\(\)]/g, '')  // Remove parentheses
              .replace(/[^\u0020-\u007F]/g, ''), // Keep only ASCII printable chars
          });
          return;
        }
        localFunctionCalls.push({ node, text: subcommand.text });
      });
      continue;
    }

    // for autoloaded files that could have completions, we only want to check for `complete`  commands
    if (doc.isAutoloadedWithPotentialCompletions()) {
      if (isCompleteCommandName(node)) completeCommandNames.push(node);
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
  // allow nodes outside of the loop, to retrieve the old state
  handler.finalizeStateMap(root.text.split('\n').length + 1);

  const isMissingAutoloadedFunction = docType === 'functions'
    ? autoloadedFunctions.length === 0
    : false;

  const isMissingAutoloadedFunctionButContainsOtherFunctions =
    isMissingAutoloadedFunction && topLevelFunctions.length > 0;

  // no function definition for autoloaded function file
  if (isMissingAutoloadedFunction && topLevelFunctions.length === 0 && handler.isCodeEnabledAtNode(ErrorCodes.autoloadedFunctionMissingDefinition, root)) {
    diagnostics.push(FishDiagnostic.create(ErrorCodes.autoloadedFunctionMissingDefinition, root));
  }
  // has functions/file.fish has top level functions, but none match the filename
  if (isMissingAutoloadedFunctionButContainsOtherFunctions) {
    topLevelFunctions.forEach(node => {
      if (handler.isCodeEnabledAtNode(ErrorCodes.autoloadedFunctionFilenameMismatch, node)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.autoloadedFunctionFilenameMismatch, node));
      }
    });
  }
  // has functions with invalid names -- (reserved keywords)
  functionsWithReservedKeyword.forEach(node => {
    if (handler.isCodeEnabledAtNode(ErrorCodes.functionNameUsingReservedKeyword, node)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.functionNameUsingReservedKeyword, node));
    }
  });

  // get all function definitions in the document
  const duplicateFunctions: { [name: string]: FishSymbol[]; } = {};
  allFunctions.forEach(node => {
    const currentDupes = duplicateFunctions[node.name] ?? [];
    currentDupes.push(node);
    duplicateFunctions[node.name] = currentDupes;
  });

  // Add diagnostics for duplicate function definitions in the same scope
  Object.entries(duplicateFunctions).forEach(([_, functionSymbols]) => {
    // skip single function definitions
    if (functionSymbols.length <= 1) return;
    functionSymbols.forEach(n => {
      if (handler.isCodeEnabledAtNode(ErrorCodes.duplicateFunctionDefinitionInSameScope, n.focusedNode)) {
        // dupes are the array of all function symbols that have the same name and scope as the current symbol `n`
        const dupes = functionSymbols.filter(s => s.scopeNode.equals(n.scopeNode) && !s.equals(n)) ?? [] as FishSymbol[];
        // skip if the function is defined in a different scope
        if (dupes.length < 1) return;
        // create a diagnostic for the duplicate function definition
        const diagnostic = FishDiagnostic.create(ErrorCodes.duplicateFunctionDefinitionInSameScope, n.focusedNode);
        diagnostic.range = n.selectionRange;
        // plus one because the dupes array does not include the current symbol `n`
        diagnostic.message += ` '${n.name}' is defined ${dupes.length + 1} time(s) in ${n.scopeTag.toUpperCase()} scope.`;
        diagnostic.message += `\n\nFILE: ${uriToReadablePath(n.uri)}`;
        // diagnostic.data.symbol = n;
        diagnostic.relatedInformation = dupes.filter(s => !s.equals(n)).map(s => DiagnosticRelatedInformation.create(
          s.toLocation(),
          `${s.scopeTag.toUpperCase()} duplicate '${s.name}' defined on line ${s.focusedNode.startPosition.row}`,
        ));
        diagnostics.push(diagnostic);
      }
    });
  });

  localFunctions.forEach(node => {
    const matches = commandNames.filter(call => call.text === node.text);
    if (matches.length === 0) return;
    if (!localFunctionCalls.some(call => call.text === node.text)) {
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

  logger.info({
    isMissingAutoloadedFunction,
    fish_lsp_diagnostic_disable_error_codes: config.fish_lsp_diagnostic_disable_error_codes,
    unusedLocalFunction: unusedLocalFunction.map(node => node.text).join(', '),
    localFunctionCalls: localFunctionCalls.map(call => call.text).join(', '),
    toplevelFunctions: topLevelFunctions.map(node => node.text).join(', '),
    commandNames: commandNames.map(node => node.text).join(', '),
  });

  if (unusedLocalFunction.length >= 1 || !isMissingAutoloadedFunction) {
    unusedLocalFunction.forEach(node => {
      if (handler.isCodeEnabledAtNode(ErrorCodes.unusedLocalFunction, node)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.unusedLocalFunction, node));
      }
    });
  }

  doc.isFunction();
  const docNameMatchesCompleteCommandNames = completeCommandNames.some(node =>
    node.text === doc.getAutoLoadName());
  // if no `complete -c func_name` matches the autoload name
  if (completeCommandNames.length > 0 && !docNameMatchesCompleteCommandNames && doc.isAutoloadedCompletion()) {
    const completeNames: Set<string> = new Set();
    for (const completeCommandName of completeCommandNames) {
      if (!completeNames.has(completeCommandName.text) && handler.isCodeEnabledAtNode(ErrorCodes.autoloadedCompletionMissingCommandName, completeCommandName)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.autoloadedCompletionMissingCommandName, completeCommandName, completeCommandName.text));
        completeNames.add(completeCommandName.text);
      }
    }
  }

  // add 9999 diagnostics from `fish --no-execute` if the user enabled it
  if (config.fish_lsp_enable_experimental_diagnostics) {
    const noExecuteDiagnostics = getNoExecuteDiagnostics(doc);
    for (const diagnostic of noExecuteDiagnostics) {
      if (handler.isCodeEnabledAtNode(ErrorCodes.syntaxError, diagnostic.data.node)) {
        diagnostics.push(diagnostic);
      }
    }
  }

  return diagnostics;
}
