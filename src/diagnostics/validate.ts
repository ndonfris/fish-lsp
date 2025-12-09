import { Diagnostic, DiagnosticRelatedInformation, Range } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { getRange, nodesGen } from '../utils/tree-sitter';
import { isMatchingOption, Option } from '../parsing/options';
import { findErrorCause, isExtraEnd, isZeroIndex, isSingleQuoteVariableExpansion, isUniversalDefinition, isSourceFilename, isTestCommandVariableExpansionWithoutString, isConditionalWithoutQuietCommand, isMatchingCompleteOptionIsCommand, LocalFunctionCallType, isArgparseWithoutEndStdin, isFishLspDeprecatedVariableName, getDeprecatedFishLspMessage, isDotSourceCommand, isMatchingAbbrFunction, isFunctionWithEventHookCallback, isVariableDefinitionWithExpansionCharacter, isPosixCommandInsteadOfFishCommand, getFishBuiltinEquivalentCommandName, getAutoloadedFunctionsWithoutDescription, isWrapperFunction /*isKnownCommand*/ } from './node-types';
import { ErrorCodes } from './error-codes';
import { config } from '../config';
import { DiagnosticCommentsHandler } from './comments-handler';
import { logger } from '../logger';
import { isAutoloadedUriLoadsFunctionName, uriToReadablePath } from '../utils/translation';
import { findParent, findParentCommand, isCommandName, isCommandWithName, isComment, isCompleteCommandName, isFunctionDefinitionName, isOption, isScope, isString, isTopLevelFunctionDefinition } from '../utils/node-types';
import { isBuiltin, isReservedKeyword } from '../utils/builtins';
import { getNoExecuteDiagnostics } from './no-execute-diagnostic';
import { checkForInvalidDiagnosticCodes } from './invalid-error-code';
import { analyzer } from '../analyze';
import { FishSymbol } from '../parsing/symbol';
import { findUnreachableCode } from '../parsing/unreachable';
import { allUnusedLocalReferences } from '../references';
import { FishDiagnostic } from './types';
import { server } from '../server';
import { FishCompletionItemKind } from '../utils/completion/types';

// Number of nodes to process before yielding to event loop
const CHUNK_SIZE = 100;

/**
 * Async version of getDiagnostics that yields to the event loop periodically
 * to avoid blocking the main thread during diagnostic calculation.
 *
 * This function has identical behavior to getDiagnostics(), but processes
 * nodes in chunks and yields between chunks using setImmediate().
 *
 * @param root - The root syntax node of the document
 * @param doc - The LspDocument being analyzed
 * @param signal - Optional AbortSignal to cancel the computation
 * @param maxDiagnostics - Optional limit on number of diagnostics to return (0 = unlimited)
 * @returns Promise resolving to array of diagnostics
 */
export async function getDiagnosticsAsync(
  root: SyntaxNode,
  doc: LspDocument,
  signal?: AbortSignal,
  maxDiagnostics: number = config.fish_lsp_max_diagnostics,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  // Helper to check if we've hit the diagnostic limit
  const hasReachedLimit = () => maxDiagnostics > 0 && diagnostics.length >= maxDiagnostics;

  const handler = new DiagnosticCommentsHandler();
  const isAutoloadedFunctionName = isAutoloadedUriLoadsFunctionName(doc);

  const docType = doc.getAutoloadType();

  // arrays to keep track of different groups of functions
  const allFunctions: FishSymbol[] = analyzer.getFlatDocumentSymbols(doc.uri).filter(s => s.isFunction());
  const autoloadedFunctions: SyntaxNode[] = [];
  const topLevelFunctions: SyntaxNode[] = [];
  const functionsWithReservedKeyword: SyntaxNode[] = [];

  const localFunctions: SyntaxNode[] = [];
  const localFunctionCalls: LocalFunctionCallType[] = [];
  const commandNames: SyntaxNode[] = [];
  const completeCommandNames: SyntaxNode[] = [];

  // handles and returns true/false if the node is a variable definition with an expansion character
  const definedVariables: { [name: string]: SyntaxNode[]; } = {};

  // callback to check if the function has an `--event` handler && the handler is enabled at the node
  const isFunctionWithEventHook = isFunctionWithEventHookCallback(doc, handler, allFunctions);

  // Process nodes in chunks to avoid blocking the main thread
  // Using generator for better memory efficiency
  let i = 0;
  for (const node of nodesGen(root)) {
    // Check if computation was cancelled
    if (signal?.aborted) {
      throw new Error('Diagnostic computation cancelled');
    }

    // Early exit if we've hit the diagnostic limit
    if (hasReachedLimit()) {
      break;
    }

    handler.handleNode(node);

    // Check for invalid diagnostic codes first
    const invalidDiagnosticCodes = checkForInvalidDiagnosticCodes(node);
    if (invalidDiagnosticCodes.length > 0) {
      // notice, this is the only case where we don't check if the user has disabled the error code
      // because `# @fish-lsp-disable` will always be recognized as a disabled error code
      diagnostics.push(...invalidDiagnosticCodes);
    }

    if (node.type === 'variable_name' || node.text.startsWith('$') || isString(node)) {
      const parent = findParentCommand(node);
      if (parent && isCommandWithName(parent, 'set', 'test')) {
        const opt = isCommandWithName(parent, 'test') ? Option.short('-n') : Option.create('-q', '--query');
        let text = isString(node) ? node.text.slice(1, -1) : node.text;
        if (text.startsWith('$')) text = text.slice(1);
        if (text && text.length !== 0) {
          const scope = findParent(node, n => isScope(n));
          if (scope && parent.children.some(c => isMatchingOption(c, opt))) {
            definedVariables[text] = definedVariables[text] || [];
            definedVariables[text]?.push(scope);
          }
        }
      }
    }

    if (node.isError) {
      const found: SyntaxNode | null = findErrorCause(node.children);
      if (found && handler.isCodeEnabled(ErrorCodes.missingEnd)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.missingEnd, node));
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

    if (isWrapperFunction(node, handler)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedWrapperFunction, node));
    }

    if (isUniversalDefinition(node) && docType !== 'conf.d' && handler.isCodeEnabled(ErrorCodes.usedUnviersalDefinition)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedUnviersalDefinition, node));
    }

    if (isPosixCommandInsteadOfFishCommand(node) && handler.isCodeEnabled(ErrorCodes.usedExternalShellCommandWhenBuiltinExists)) {
      diagnostics.push(FishDiagnostic.create(ErrorCodes.usedExternalShellCommandWhenBuiltinExists, node, `Use the Fish builtin command '${getFishBuiltinEquivalentCommandName(node)!}' instead of the external shell command.`));
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

    // store the defined variable expansions and then use them in the next check
    if (isVariableDefinitionWithExpansionCharacter(node, definedVariables) && handler.isCodeEnabled(ErrorCodes.dereferencedDefinition)) {
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
    if (isComment(node) || isOption(node)) {
      // Yield to event loop every CHUNK_SIZE iterations
      if (++i % CHUNK_SIZE === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      continue;
    }

    /** keep this section at end of loop iteration, because it uses continue */
    if (isCommandName(node)) commandNames.push(node);

    // get the parent and previous sibling, for the next checks
    const { parent, previousSibling } = node;
    if (!parent || !previousSibling) {
      // Yield to event loop every CHUNK_SIZE iterations
      if (++i % CHUNK_SIZE === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      continue;
    }

    // skip if this is an abbr function, since we don't want to complete abbr functions
    if (isCommandWithName(parent, 'abbr') && isMatchingAbbrFunction(previousSibling)) {
      localFunctionCalls.push({ node, text: node.text });
      // Yield to event loop every CHUNK_SIZE iterations
      if (++i % CHUNK_SIZE === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
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
      // Yield to event loop every CHUNK_SIZE iterations
      if (++i % CHUNK_SIZE === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      continue;
    }

    // for autoloaded files that could have completions, we only want to check for `complete`  commands
    if (doc.isAutoloadedWithPotentialCompletions()) {
      if (isCompleteCommandName(node)) completeCommandNames.push(node);
      // skip if no parent command (note we already added commands above)
      if (!isCommandWithName(parent, 'complete')) {
        // Yield to event loop every CHUNK_SIZE iterations
        if (++i % CHUNK_SIZE === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
        continue;
      }
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
          // Yield to event loop every CHUNK_SIZE iterations
          if (++i % CHUNK_SIZE === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
          continue;
        }
        // otherwise, just add the node as is (should just be an unquoted command)
        localFunctionCalls.push({ node, text: node.text });
      }
    }

    // Yield to event loop every CHUNK_SIZE iterations
    if (++i % CHUNK_SIZE === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // Check if computation was cancelled before post-processing
  if (signal?.aborted) {
    throw new Error('Diagnostic computation cancelled');
  }

  // Skip post-processing if we've already hit the diagnostic limit
  if (hasReachedLimit()) {
    return diagnostics;
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

  // `4008` -> auto-loaded functions without description
  getAutoloadedFunctionsWithoutDescription(doc, handler, allFunctions).forEach((symbol) => {
    diagnostics.push(FishDiagnostic.fromSymbol(ErrorCodes.requireAutloadedFunctionHasDescription, symbol));
  });

  localFunctions.forEach(node => {
    const matches = commandNames.filter(call => call.text === node.text);
    if (matches.length === 0) return;
    if (!localFunctionCalls.some(call => call.text === node.text)) {
      localFunctionCalls.push({ node, text: node.text });
    }
  });

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

  // 4004 -> unused local function/variable definitions
  if (handler.isRootEnabled(ErrorCodes.unusedLocalDefinition)) {
    const unusedLocalDefinitions = allUnusedLocalReferences(doc);
    for (const unusedLocalDefinition of unusedLocalDefinitions) {
      // skip definitions that do not need local references
      if (!unusedLocalDefinition.needsLocalReferences()) {
        logger.debug('Skipping unused local definition', {
          name: unusedLocalDefinition.name,
          uri: unusedLocalDefinition.uri,
          type: unusedLocalDefinition.kind,
        });
        continue;
      }
      if (handler.isCodeEnabledAtNode(ErrorCodes.unusedLocalDefinition, unusedLocalDefinition.focusedNode)) {
        diagnostics.push(
          FishDiagnostic.fromSymbol(ErrorCodes.unusedLocalDefinition, unusedLocalDefinition),
        );
      }
    }
  }

  // 5555 -> code is not reachable
  if (handler.isRootEnabled(ErrorCodes.unreachableCode)) {
    const unreachableNodes = findUnreachableCode(root);
    for (const unreachableNode of unreachableNodes) {
      if (handler.isCodeEnabledAtNode(ErrorCodes.unreachableCode, unreachableNode)) {
        diagnostics.push(FishDiagnostic.create(ErrorCodes.unreachableCode, unreachableNode));
      }
    }
  }

  // 7001 -> unknown command
  if (handler.isRootEnabled(ErrorCodes.unknownCommand)) {
    // Cache expensive lookups that are reused for every command
    const knownCommandsCache = new Set<string>();
    const unknownCommandsCache = new Set<string>();

    // Pre-compute expensive lookups once
    const localSymbols = analyzer.getFlatDocumentSymbols(doc.uri);
    const localFunctionNames = new Set(localSymbols.filter(s => s.isFunction()).map(s => s.name));
    const allAccessibleSymbols = analyzer.allReachableSymbols(doc.uri);

    // Pre-load completion cache if available
    let commandCompletions: Set<string> | null = null;
    if (server) {
      const completions = server.completions;
      const commandCompletionList = completions.allOfKinds(
        FishCompletionItemKind.ALIAS,
        FishCompletionItemKind.BUILTIN,
        FishCompletionItemKind.FUNCTION,
        FishCompletionItemKind.COMMAND,
      );
      commandCompletions = new Set(commandCompletionList.map(c => c.label));
    }

    for (const commandNode of commandNames) {
      const commandName = commandNode.text.trim();

      // Skip empty commands or commands that are already errors
      if (!commandName || commandNode.isError) {
        continue;
      }

      if (!handler.isCodeEnabledAtNode(ErrorCodes.unknownCommand, commandNode)) {
        continue;
      }

      // Skip commands that are actually relative paths (start with '.')
      if (commandName.startsWith('.') || commandName.includes('/')) {
        continue;
      }

      // Check cache first
      if (knownCommandsCache.has(commandName)) {
        continue;
      }
      if (unknownCommandsCache.has(commandName)) {
        if (handler.isCodeEnabledAtNode(ErrorCodes.unknownCommand, commandNode)) {
          diagnostics.push(
            FishDiagnostic.create(
              ErrorCodes.unknownCommand,
              commandNode,
              `'${commandName}' is not a known builtin, function, or command`,
            ),
          );
        }
        continue;
      }

      // Check if command is known (using cached data)
      let isKnown = false;

      // Check builtins (fast)
      if (isBuiltin(commandName)) {
        isKnown = true;
      } else if (localFunctionNames.has(commandName)) {
        // Check local functions (cached)
        isKnown = true;
      } else if (allAccessibleSymbols.some(s => s.name === commandName)) {
        // Check accessible functions (cached)
        isKnown = true;
      } else if (analyzer.globalSymbols.find(commandName).length > 0) {
        // Check global symbols
        isKnown = true;
      } else if (commandCompletions && commandCompletions.has(commandName)) {
        // Check completion cache (cached)
        isKnown = true;
      }

      // Update cache
      if (isKnown) {
        knownCommandsCache.add(commandName);
      } else {
        unknownCommandsCache.add(commandName);
        if (handler.isCodeEnabledAtNode(ErrorCodes.unknownCommand, commandNode)) {
          diagnostics.push(
            FishDiagnostic.create(
              ErrorCodes.unknownCommand,
              commandNode,
              `'${commandName}' is not a known builtin, function, or command`,
            ),
          );
        }
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
