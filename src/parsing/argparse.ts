import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isEndStdinCharacter, isString, isTopLevelDefinition, isEscapeSequence } from '../utils/node-types';

import { isMatchingOption, isMatchingOptionOrOptionValue, Option } from './options';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope } from '../utils/definition-scope';
import { getRange } from '../utils/tree-sitter';

export const ArparseOptions = [
  Option.create('-n', '--name').withValue(),
  Option.create('-x', '--exclusive').withValue(),
  Option.create('-N', '--min-args').withValue(),
  Option.create('-X', '--max-args').withValue(),
  Option.create('-i', '--ignore-unknown'),
  Option.create('-s', '--stop-nonopt'),
  Option.create('-h', '--help'),
];

export function isArgparseDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'argparse');
}

function getArgparseScopeModifier(document: LspDocument, node: SyntaxNode) {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
    case 'functions':
      return 'local';
    default:
      return isTopLevelDefinition(node) ? 'global' : 'local';
  }
}

function createSelectionRange(node: SyntaxNode, flags: string[], flag: string, idx: number) {
  const range = getRange(node);
  const text = node.text;
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
        character: range.start.character + flag.length,
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
        character: range.start.character + text.indexOf('/') + 1 + flag.length,
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
          line: range.end.line,
          character: range.start.character + 1 + flag.length,
        },
      };
    } else {
      return getRange(node);
    }
  }
  return range;
}

export function findArgparseChildren(node: SyntaxNode): SyntaxNode[] {
  const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;
  const children = node.childrenForFieldName('argument');
  const endToken = children.find(n => isEndStdinCharacter(n));
  if (!endToken) return children;
  return children.filter(n => isBefore(n, endToken));
}

export function processArgparseCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = getArgparseScopeModifier(document, node);

  // find the `--` end token
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return [];

  // split the `h/help` into `h` and `help`
  function splitSlash(str: string): string[] {
    const results = str.split('/')
      .map(s => s.trim().replace(/-/g, '_'));

    const maxResults = results.length < 2 ? results.length : 2;
    return results.slice(0, maxResults);
  }

  function getNames(flags: string[]) {
    return flags.map(flag => {
      return `_flag_${flag}`;
    });
  }

  // find the parent function or program
  // find all flags before the `--` end token
  const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;
  const focuesedNodes = node.childrenForFieldName('argument')
    .filter(n => {
      switch (true) {
        case isMatchingOptionOrOptionValue(n, Option.create('-X', '--max-args')):
        case isMatchingOptionOrOptionValue(n, Option.create('-N', '--min-args')):
        case isMatchingOptionOrOptionValue(n, Option.create('-x', '--exclusive')):
        case isMatchingOptionOrOptionValue(n, Option.create('-n', '--name')):
        case isMatchingOption(n, Option.create('-h', '--help')):
        case isMatchingOption(n, Option.create('-s', '--stop-nonopt')):
        case isMatchingOption(n, Option.create('-i', '--ignore-unknown')):
          return false;
        default:
          return true;
      }
    })
    .filter(n => !isEscapeSequence(n) && isBefore(n, endChar))
    ;

  const result: FishSymbol[] = [];
  for (const n of focuesedNodes) {
    let flagNames = n?.text;
    if (!flagNames) continue;
    if (isString(n)) {
      flagNames = flagNames.slice(1, -1);
    }
    if (flagNames.includes('=')) {
      flagNames = flagNames.slice(0, flagNames.indexOf('='));
    }

    const seenFlags = splitSlash(flagNames);
    const names = getNames(seenFlags);
    // add all seenFlags to the `result: Symb[]` array
    const flags = names.map((flagName, idx) => {
      const selectedRange = createSelectionRange(node, seenFlags, flagName, idx);
      return FishSymbol.fromObject({
        name: flagName,
        node: node,
        focusedNode: n,
        fishKind: 'ARGPARSE',
        uri: document.uri,
        detail: n.text,
        selectionRange: selectedRange,
        scope: DefinitionScope.create(node.parent!, modifier),
        children,
      }).addAliasedNames(...names);
    });
    result.push(...flags);
  }
  return result;
}
