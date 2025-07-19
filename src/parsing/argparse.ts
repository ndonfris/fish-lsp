import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isEndStdinCharacter, isString, isEscapeSequence, isVariableExpansion, isCommand, isInvalidVariableName, findParentWithFallback, isFunctionDefinition } from '../utils/node-types';
import { findOptions, isMatchingOption, Option } from './options';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope, ScopeTag } from '../utils/definition-scope';
import { getRange } from '../utils/tree-sitter';
import { analyzer } from '../analyze';
import path, { dirname } from 'path';
import { SyncFileHelper } from '../utils/file-operations';
import { pathToUri, uriToPath } from '../utils/translation';
import { workspaceManager } from '../utils/workspace-manager';
import { logger } from '../logger';

export const ArparseOptions = [
  Option.create('-n', '--name').withValue(),
  Option.create('-x', '--exclusive').withValue(),
  Option.create('-N', '--min-args').withValue(),
  Option.create('-X', '--max-args').withValue(),
  Option.create('-i', '--ignore-unknown'),
  Option.create('-s', '--stop-nonopt'),
  Option.create('-h', '--help'),
];

const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;

export function findArgparseOptions(node: SyntaxNode) {
  if (isCommandWithName(node, 'argparse')) return undefined;
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return undefined;
  const nodes = node.childrenForFieldName('argument')
    .filter(n => !isEscapeSequence(n) && isBefore(n, endChar))
    .filter(n => !isVariableExpansion(n) || n.type !== 'variable_name');
  return findOptions(nodes, ArparseOptions);
}

function isInvalidArgparseName(node: SyntaxNode) {
  if (isEscapeSequence(node) || isCommand(node) || isInvalidVariableName(node)) return true;
  if (isVariableExpansion(node) && node.type === 'variable_name') return true;
  let text = node.text.trim();
  if (isString(node)) {
    text = text.slice(1, -1);
    text = text.slice(0, text.indexOf('=') || -1);
  }
  if (text.includes('(')) return true; // skip function calls
  return false;
}

/**
 * Find the names of the `argparse` definitions in a given node.
 * Example:
 * argparse -n foo -x g,U --ignore-unknown --stop-nonopt h/help 'n/name=?' 'x/exclusive' -- $argv
 *                                                       ^^^^^^  ^^^^^^^^^ ^^^^^^^^^^^^^
 *                                                       Notice that the nodes that are matches can be strings
 *
 *
 */
export function findArgparseDefinitionNames(node: SyntaxNode): SyntaxNode[] {
  // check if the node is a 'argparse' command
  if (!node || !isCommandWithName(node, 'argparse')) return [];
  // check if the node has a '--' token
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return [];
  // get the children of the node that are not options and before the endChar (currently skips variables)
  const nodes = node.childrenForFieldName('argument')
    .filter(n => !isEscapeSequence(n) && isBefore(n, endChar))
    .filter(n => !isInvalidArgparseName(n));

  const { remaining } = findOptions(nodes, ArparseOptions);
  return remaining;
}

/**
 * Checks if a node is an `argparse` definition variable
 * NOTE: if the node in question is a variable expansion, it will be skipped.
 * ```fish
 * argparse --max-args=2 --ignore-unknown --stop-nonopt h/help 'n/name=?' 'x/exclusive' -- $argv
 * ```
 * Would return true for the following SyntaxNodes passed in:
 * - `h/help`
 * - `n/name=?`
 * - `x/exclusive`
 * @param node The node to check, where it's parent isCommandWithName(parent, 'argparse'), and it's not a switch
 * @returns true if the node is an argparse definition variable (flags for the `argparse` command with be skipped)
 */
export function isArgparseVariableDefinitionName(node: SyntaxNode) {
  if (!node.parent || !isCommandWithName(node.parent, 'argparse')) return false;
  const children = findArgparseDefinitionNames(node.parent);
  return !!children.some(n => n.equals(node));
}

export function convertNodeRangeWithPrecedingFlag(node: SyntaxNode) {
  const range = getRange(node);
  if (node.text.startsWith('_flag_')) {
    range.start = {
      line: range.start.line,
      character: range.start.character + 6,
    };
  }
  return range;
}

export function isGlobalArgparseDefinition(document: LspDocument, symbol: FishSymbol) {
  if (!symbol.isArgparse() || !symbol.isFunction()) return false;
  let parent = symbol.parent;
  if (symbol.isFunction() && symbol.isGlobal()) {
    parent = symbol;
  }
  if (parent && parent?.isFunction()) {
    const functionName = parent.name;
    if (document.getAutoLoadName() !== functionName) {
      return false;
    }
    const filepath = document.getFilePath();
    // const workspaceDirectory = workspaces.find(ws => ws.contains(filepath) || ws.path === filepath)?.path || dirname(dirname(filepath));
    const workspaceDirectory = workspaceManager.findContainingWorkspace(document.uri)?.path || dirname(dirname(filepath));
    const completionFile = document.getAutoloadType() === 'conf.d' || document.getAutoloadType() === 'config'
      ? document.getFilePath()
      : path.join(
        workspaceDirectory,
        'completions',
        document.getFilename(),
      );
    if (process.env.NODE_ENV !== 'test' && !SyncFileHelper.isFile(completionFile)) {
      return false;
    }
    return analyzer.getFlatCompletionSymbols(pathToUri(completionFile)).length > 0;
  }
  return false;
}

/**
 * This is really more of a utility to ensure that any document that would contain
 * any references to completions for an autoloaded file, is parsed by the analyzer.
 */
export function getGlobalArgparseLocations(document: LspDocument, symbol: FishSymbol) {
  if (isGlobalArgparseDefinition(document, symbol)) {
    const filepath = uriToPath(document.uri);
    const workspaceDirectory = workspaceManager.findContainingWorkspace(document.uri)?.path || dirname(dirname(filepath));
    logger.log(
      `Getting global argparse locations for symbol: ${symbol.name} in file: ${filepath}`,
      {
        filepath,
        workspaceDirectory,
      });
    const completionFile = document.getAutoloadType() === 'conf.d' || document.getAutoloadType() === 'config'
      ? document.getFilePath()
      : path.join(
        workspaceDirectory,
        'completions',
        document.getFilename(),
      );
    if (process.env.NODE_ENV !== 'test' && !SyncFileHelper.isFile(completionFile)) {
      logger.debug({
        env: 'test',
        message: `Completion file does not exist: ${completionFile}`,
      });
      return [];
    }
    logger.debug({
      message: `Getting global argparse locations for symbol: ${symbol.name} in file: ${completionFile}`,
    });
    const completionLocations = analyzer
      .getFlatCompletionSymbols(pathToUri(completionFile))
      .filter(s => s.isNonEmpty())
      .filter(s => s.equalsArgparse(symbol) || s.equalsCommand(symbol))
      .map(s => s.toLocation());

    logger.log(`Found ${completionLocations.length} global argparse locations for symbol: ${symbol.name}`, 'HERE');

    // const containsOpt = analyzer.getNodes(pathToUri(completionFile)).filter(n => isCommandWithName(n, '__fish_contains_opt'));
    return completionLocations;
  }
  logger.warning(`no global argparse locations found for symbol: ${symbol.name}`, 'HERE');
  return [];
}

function getArgparseScopeModifier(document: LspDocument, _node: SyntaxNode): ScopeTag {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
    case 'functions':
      return 'local';
    default:
      // return isTopLevelDefinition(node) ? 'global' : 'local';
      return 'local';
  }
}

export function getArgparseDefinitionName(node: SyntaxNode): string {
  if (!node.parent || !isCommandWithName(node.parent, 'complete')) return '';
  if (node.text) {
    const text = `_flag_${node.text}`;
    return text.replace(/-/, '_');
  }
  return '';
}

/**
 * Checks if a syntax node is a completion argparse flag with a specific command name.
 *
 * On the input: `complete -c test -s h -l help -d 'show help info for the test command'`
 *                                          ^---- node is here
 * A truthy result would be returned from the following function call:
 *
 * `isCompletionArgparseFlagWithCommandName(node, 'test', 'help')`
 * ___
 * @param node - The syntax node to check
 * @param commandName - The command name to match against
 * @param flagName - The flag name to match against
 * @param opts - Optional configuration options
 * @param opts.noCommandNameAllowed - When true, a completion without a `-c`/`--command` Option is allowed
 * @param opts.discardIfContainsOptions - A list of options that, if present, will cause the match to be discarded
 * @returns True if the node is a completion argparse flag with the specified command name
 */
export function isCompletionArgparseFlagWithCommandName(node: SyntaxNode, commandName: string, flagName: string, opts?: {
  noCommandNameAllowed?: boolean;
  discardIfContainsOptions?: Option[];
}) {
  // make sure that the node we are checking is inside a completion definition
  if (!node?.parent || !isCommandWithName(node.parent, 'complete')) return false;

  // parent is the entire completion command
  const parent = node.parent;

  // check if any of the options to discard are seen
  if (opts?.discardIfContainsOptions) {
    for (const option of opts.discardIfContainsOptions) {
      if (parent.children.some(c => option.matches(c))) {
        return false;
      }
    }
  }

  // check if the command name is present in the completion
  let completeCmdName: boolean = !!parent.children.find(c =>
    c.previousSibling &&
    isMatchingOption(c.previousSibling, Option.create('-c', '--command')) &&
    c.text === commandName,
  );

  // if noCommandNameAllowed is true, and we don't have a command name yet
  // update the completeCmdName to be true if the `-c`/`--command` option is not present
  if (opts?.noCommandNameAllowed && !completeCmdName) {
    completeCmdName = !parent.children.some(c =>
      c.previousSibling &&
      isMatchingOption(c.previousSibling, Option.create('-c', '--command')),
    );
  }

  // Here we determine if which type of option we are looking for
  const option = flagName.length === 1
    ? Option.create('-s', '--short')
    : Option.create('-l', '--long');

  // check if the option name is present in the completion
  const completeFlagName: boolean = !!(
    node.previousSibling &&
    option.equals(node.previousSibling) &&
    node.text === flagName
  );

  // return true if both the command name and option name
  return completeCmdName && completeFlagName;
}

function createSelectionRange(node: SyntaxNode, flags: string[], flag: string, idx: number) {
  const range = getRange(node);
  const text = node.text;
  const shortenedFlag = flag.replace(/^_flag_/, '');
  if (flags.length === 2 && idx === 0) {
    if (isString(node)) {
      range.start = {
        line: range.start.line,
        character: range.start.character + 1,
      };
      range.end = {
        line: range.start.line,
        character: range.start.character - 1,
      };
    }
    return {
      start: range.start,
      end: {
        line: range.start.line,
        character: range.start.character + shortenedFlag.length,
      },
    };
  } else if (flags.length === 2 && idx === 1) {
    return {
      start: {
        line: range.start.line,
        character: range.start.character + text.indexOf('/') + 1,
      },
      end: {
        line: range.end.line,
        character: range.start.character + text.indexOf('/') + 1 + shortenedFlag.length,
      },
    };
  } else if (flags.length === 1) {
    if (isString(node)) {
      return {
        start: {
          line: range.start.line,
          character: range.start.character + 1,
        },
        end: {
          line: range.start.line,
          character: range.start.character + 1 + shortenedFlag.length,
        },
      };
    } else {
      return getRange(node);
    }
  }
  return range;
}

// split the `h/help` into `h` and `help`
function splitSlash(str: string): string[] {
  const results = str.split('/')
    .map(s => s.trim().replace(/-/g, '_'));

  const maxResults = results.length < 2 ? results.length : 2;
  return results.slice(0, maxResults);
}

// get the flag variable names from the argparse commands
function getNames(flags: string[]) {
  return flags.map(flag => {
    return `_flag_${flag}`;
  });
}

/**
 * Process an argparse command and return all of the flag definitions as a `FishSymbol[]`
 * @param document The LspDocument we are processing
 * @param node The node we are processing, should be isCommandWithName(node, 'argparse')
 * @param children The children symbols of the current FishSymbol's we are processing (likely empty)
 * @returns An array of FishSymbol's that represent the flags defined in the argparse command
 */
export function processArgparseCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const result: FishSymbol[] = [];
  // get the scope modifier
  const modifier = getArgparseScopeModifier(document, node);
  const scopeNode = findParentWithFallback(node, (n) => isFunctionDefinition(n));
  // array of nodes that are `argparse` flags
  const focuesedNodes = findArgparseDefinitionNames(node);
  // build the flags, and store them in the result array
  for (const n of focuesedNodes) {
    let flagNames = n.text;
    if (!flagNames) continue;
    // fixup the flag names for strings and concatenated flags
    if (isString(n)) flagNames = flagNames.slice(1, -1);
    if (flagNames.includes('=')) flagNames = flagNames.slice(0, flagNames.indexOf('='));
    // split the text into corresponding flags and convert them to `_flag_` format
    const seenFlags = splitSlash(flagNames);
    const names = getNames(seenFlags);
    // add all seenFlags to the `result: FishSymbol[]` array
    const flags = names.map((flagName, idx) => {
      const selectedRange = createSelectionRange(n, seenFlags, flagName, idx);
      return FishSymbol.fromObject({
        name: flagName,
        node: node,
        focusedNode: n,
        fishKind: 'ARGPARSE',
        document: document,
        uri: document.uri,
        detail: n.text,
        range: getRange(n),
        selectionRange: selectedRange,
        scope: DefinitionScope.create(scopeNode, modifier),
        children,
      }).addAliasedNames(...names);
    });
    result.push(...flags);
  }
  return result;
}
