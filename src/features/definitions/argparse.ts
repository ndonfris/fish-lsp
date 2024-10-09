// import { DefinitionScope } from '../../utils/definition-scope';
import { NamedNode, isCommandName, isEndStdinCharacter, isFunctionDefinition, isOption, isProgram, isString } from '../../utils/node-types';
import { FishDocumentSymbol } from '../../utils/new-symbol';
import { findFirstParent, getRange } from '../../utils/tree-sitter';
import { SymbolKind } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';

export function isArgparseCommandName(node: SyntaxNode): node is NamedNode {
  return isCommandName(node) && node.text === 'argparse';
}

/**
 * Extracts all argparse definitions from a command node.
 *
 * @param uri The URI of the file.
 * @param node The command node.
 * @returns An array of argparse definitions.
 */
export function getArgparseDefinitions(uri: string, node: SyntaxNode): FishDocumentSymbol[] {
  // split the `h/help` into `h` and `help`
  function splitSlash(str: string): string[] {
    const results = str.replace(/-/g, '_').split('/').filter(s => !!s.trim());
    const maxResults = results.length < 2 ? results.length : 2;
    return results.slice(0, maxResults);
  }

  // do nothing if the node is not a command name
  if (!isArgparseCommandName(node)) return [];

  // store the results
  const result: FishDocumentSymbol[] = [];
  if (isCommandName(node) && node.text === 'argparse') {
    // commandName is `argparse`
    const cmd = node.parent;

    // find the `--` end token
    const endChar = cmd?.children.find(node => isEndStdinCharacter(node));
    if (!endChar) return [];

    // find the parent function or program
    // find all flags before the `--` end token
    const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;

    cmd.children
      .filter(node => !isOption(node) && !isCommandName(node) && isBefore(node, endChar))
      .forEach((node) => {
        let flagNames = node.text;
        if (isString(node)) {
          flagNames = node.text.slice(1, -1).split('=').shift() || '';
        }
        const seenFlags = splitSlash(flagNames);
        // add all seenFlags to the `result: FishDocumentSymbol[]` array
        seenFlags.forEach(flagName => {
          result.push(FishDocumentSymbol.create(
            `_flag_${flagName}`,
            SymbolKind.Variable,
            uri,
            getRange(cmd),
            getRange(node),
            node,
            cmd,
            [],
          ));
        });
      });
  }
  return result;
}
