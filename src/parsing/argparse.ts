import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isEndStdinCharacter, isString, isEscapeSequence, isVariableExpansion } from '../utils/node-types';
import { findOptions, Option } from './options';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope, ScopeTag } from '../utils/definition-scope';
import { getRange } from '../utils/tree-sitter';
import { Analyzer } from '../analyze';
import path, { dirname } from 'path';
import { SyncFileHelper } from '../utils/file-operations';
import { pathToUri, uriToPath } from '../utils/translation';
import { workspaces } from '../utils/workspace';

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

export function findArgparseDefinitionNames(node: SyntaxNode): SyntaxNode[] {
  // check if the node is a 'argparse' command
  if (!node || !isCommandWithName(node, 'argparse')) return [];
  // check if the node has a '--' token
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return [];
  // get the children of the node that are not options and before the endChar (currently skips variables)
  const nodes = node.childrenForFieldName('argument')
    .filter(n => !isEscapeSequence(n) && isBefore(n, endChar))
    .filter(n => !isVariableExpansion(n) || n.type !== 'variable_name');

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

export function isGlobalArgparseDefinition(analyzer: Analyzer, document: LspDocument, symbol: FishSymbol) {
  if (symbol.fishKind !== 'ARGPARSE') return false;
  const parent = symbol.scopeNode;
  if (parent.type === 'function_definition') {
    const functionName = parent.firstNamedChild?.text;
    if (document.getAutoLoadName() !== functionName) {
      return false;
    }
    const filepath = uriToPath(document.uri);
    const workspaceDirectory = workspaces.find(ws => ws.contains(filepath) || ws.path === filepath)?.path || dirname(dirname(filepath));
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

export function getGlobalArgparseLocations(analyzer: Analyzer, document: LspDocument, symbol: FishSymbol) {
  if (isGlobalArgparseDefinition(analyzer, document, symbol)) {
    const filepath = uriToPath(document.uri);
    const workspaceDirectory = workspaces.find(ws => ws.contains(filepath) || ws.path === filepath)?.path || dirname(dirname(filepath));
    const completionFile = document.getAutoloadType() === 'conf.d' || document.getAutoloadType() === 'config'
      ? document.getFilePath()
      : path.join(
        workspaceDirectory,
        'completions',
        document.getFilename(),
      );
    if (process.env.NODE_ENV !== 'test' && !SyncFileHelper.isFile(completionFile)) {
      return [];
    }
    return analyzer
      .getFlatCompletionSymbols(pathToUri(completionFile))
      .filter(s => s.equalsFishSymbol(symbol))
      .map(s => s.toLocation(symbol));
  }
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
        uri: document.uri,
        detail: n.text,
        range: getRange(n),
        selectionRange: selectedRange,
        scope: DefinitionScope.create(node.parent!, modifier),
        children,
      }).addAliasedNames(...names);
    });
    result.push(...flags);
  }
  return result;
}
