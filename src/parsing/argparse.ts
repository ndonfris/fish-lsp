import { SyntaxNode } from 'web-tree-sitter';
import { isOption, isCommandWithName, isEndStdinCharacter, isString, isTopLevelDefinition } from '../utils/node-types';

import { Option } from './options';
import { FishSymbol } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope } from '../utils/definition-scope';

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
  const focuesedNodes = node.childrenForFieldName('argument').filter(n => isBefore(n, endChar) && !isOption(n));

  const result: FishSymbol[] = [];
  for (const n of focuesedNodes) {
    let flagNames = n?.text;
    if (!flagNames) continue;
    if (isString(n)) {
      flagNames = flagNames.slice(1, -1);
    }
    const seenFlags = splitSlash(flagNames);
    const names = getNames(seenFlags);
    // add all seenFlags to the `result: Symb[]` array
    const flags = names.map(flagName => {
      return FishSymbol.create(
        flagName,
        node,
        n,
        'ARGPARSE',
        document.uri,
        n.text,
        DefinitionScope.create(node, modifier),
        children,
      ).addAliasedNames(...names);
    });
    result.push(...flags);
  }
  return result;
}
