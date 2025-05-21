import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { isMatchingOption, isString } from '../utils/node-types';
import { config } from '../config';
import { findSetChildren } from './set';
import { Option } from './options';
import { SyncFileHelper } from '../utils/file-operations';
import { SymbolKind } from 'vscode-languageserver';

/**
 * Current implementation is for evaluating `config` keys, in non autoloaded
 * paths, but shown in the current workspace/document, in client.
 *
 * This will retrieve the values seen in a `set` definition, without
 * needing to extranally evaluate the definition via fish's  source
 * command.
 *
 * Potential further implementation is ahead.
 */

export namespace LocalFishLspDocumentVariable {

  export function isConfigVariableDefinition(symbol: FishSymbol): boolean {
    if (symbol.kind !== SymbolKind.Variable || symbol.fishKind !== 'SET') {
      return false;
    }
    return Object.keys(config).includes(symbol.name);
  }

  export function isConfigVariableDefinitionWithErase(
    symbol: FishSymbol,
  ): boolean {
    if (!symbol.isConfigDefinition()) {
      return false;
    }
    return hasEraseFlag(symbol);
  }

  export function findValueNodes(symbol: FishSymbol) {
    const valueNodes: SyntaxNode[] = [];
    if (!symbol.isConfigDefinition()) return valueNodes;
    let node: null | SyntaxNode = symbol.focusedNode.nextNamedSibling;
    while (node) {
      if (!isEmptyString(node)) valueNodes.push(node);
      node = node.nextNamedSibling;
    }
    return valueNodes;
  }

  export function nodeToShellValue(node: SyntaxNode): string {
    let text = node.text;
    if (isString(node)) text = text.slice(1, -1);
    return SyncFileHelper.expandEnvVars(text);
  }

  export const eraseOption = Option.create('-e', '--erase');

  export function hasEraseFlag(symbol: FishSymbol): boolean {
    const definitionNode = symbol.focusedNode;
    // get only the flags. these are only allowed between the command `set` and the `variable_name`
    // i.e., set -gx foo value_1 || set --global --erase foo value_2
    //           ^^^                    ^^^^^^^^ ^^^^^^^       are the only matches
    const children = findSetChildren(symbol.node)
      .filter(s => s.startIndex < definitionNode.startIndex);

    return children.some(s => isMatchingOption(s, eraseOption));
  }
}

function isEmptyString(node: SyntaxNode) {
  return isString(node) && node.text.length === 2;
}

export function configDefinitionParser(
  symbol: FishSymbol,
) {
  const isDefinition = LocalFishLspDocumentVariable.isConfigVariableDefinition(symbol);
  const isDefinitionWithErase = LocalFishLspDocumentVariable.isConfigVariableDefinitionWithErase(symbol);
  const valueNodes = LocalFishLspDocumentVariable.findValueNodes(symbol);
  const values = valueNodes.map(node => LocalFishLspDocumentVariable.nodeToShellValue(node));
  return {
    isDefinition,
    isErase: isDefinitionWithErase,
    valueNodes,
    values,
  };
}
