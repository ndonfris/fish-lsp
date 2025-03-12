import { SyntaxNode } from 'web-tree-sitter';
import { findParent, isEndStdinCharacter, isEscapeSequence, isFunctionDefinition, isMatchingOption, isOption, isProgram, isString, NodeOptionQueryText, Option } from './node-types';
import { LspDocument } from '../document';
import { DefinitionScope } from './definition-scope';
import { FishDocumentSymbol } from '../document-symbol';
import { SymbolKind } from 'vscode-languageserver';
import { md } from './markdown-builder';
import { equalRanges, getRange } from './tree-sitter';

function isMatchingOptionOrOptionValue(node: SyntaxNode, option: NodeOptionQueryText): boolean {
  if (isMatchingOption(node, option)) {
    return true;
  }
  const prevNode = node.previousNamedSibling;
  if (prevNode?.text.includes('=')) {
    return false;
  }
  if (prevNode && isMatchingOption(prevNode, option) && !isOption(node)) {
    return true;
  }
  return false;
}

function getArgparseScope(node: SyntaxNode, doc: LspDocument): DefinitionScope {
  const docType = doc.getAutoloadType();

  function findParentFunction(n: SyntaxNode): DefinitionScope | null {
    let node: SyntaxNode | null = n;
    while (node) {
      if (node.type === 'function_definition') {
        return DefinitionScope.create(node, 'local');
      }
      node = node.parent;
    }
    return null;
  }
  const scopeRecord : Record<string, (n: SyntaxNode) => DefinitionScope | null> = {
    'conf.d': findParentFunction,
    functions: findParentFunction,
    completions: findParentFunction,
    config: findParentFunction,
    '': (n: SyntaxNode) => {
      const parent = findParent(n, (node) => isFunctionDefinition(node) || isProgram(node));
      if (!parent) return null;
      if (isFunctionDefinition(parent)) {
        return DefinitionScope.create(parent, 'function');
      }
      if (isProgram(parent)) {
        return DefinitionScope.create(parent, 'function');
      }
      return null;
    },

  };

  const callbackRecord = scopeRecord[docType];
  if (callbackRecord && callbackRecord(node)) {
    return callbackRecord(node)!;
  }
  return DefinitionScope.create(node, 'local');
}

export function buildArpgparseDetail(variableName: string, commandNode: SyntaxNode): string {
  return [
    `(${md.italic('variable')}) $${variableName}`,
    `defined in ${md.inlineCode('arpgarse')} command`,
    md.separator(),
    md.codeBlock('fish', commandNode.text),
  ].join('\n');
}

export function processArgparseCommand(node: SyntaxNode, document: LspDocument): FishDocumentSymbol[] {
  const modifier = getArgparseScope(node, document);

  // split the `h/help` into `h` and `help`
  function splitSlash(str: string): string[] {
    const results = str.split('/')
      .map(s => s.trim().replace(/-/g, '_'));

    const maxResults = results.length < 2 ? results.length : 2;
    return results.slice(0, maxResults);
  }

  // store the results
  const result: FishDocumentSymbol[] = [];
  // const result: string[] = [];

  // find the `--` end token
  const endChar = node.children.find(n => isEndStdinCharacter(n));
  if (!endChar) return [];

  // find the parent function or program
  // find all flags before the `--` end token
  const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;

  node.childrenForFieldName('argument')
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
    .forEach((n: SyntaxNode) => {
      let flagNames = n?.text;
      if (isString(n)) {
        flagNames = n?.text.slice(1, -1).split('=').shift() || '';
      } else if (n.text.includes('=')) {
        flagNames = n.text.slice(0, n.text.indexOf('='));
      }
      const seenFlags = splitSlash(flagNames);

      // add all seenFlags to the `result: Symb[]` array
      const flags = seenFlags.map(flagName => {
        return FishDocumentSymbol.create(
          `_flag_${flagName}`,
          document.uri,
          node.text,
          buildArpgparseDetail(`_flag_${flagName}`, node),
          SymbolKind.Variable,
          getRange(node),
          getRange(n),
          //'FUNCTION', // TODO: this should be 'LOCAL' or 'FUNCTION' based on the parent function
          modifier,
          [],
        );
      });
      result.push(...flags);
      // result.push(...seenFlags);
    });

  return result;
}

function isArparseFishDocumentSymbol(sym: FishDocumentSymbol) {
  return sym.name.startsWith('_flag_') && sym.kind === SymbolKind.Variable && sym.text.startsWith('argparse');
}

export function _correspondingFlagSymbols(a: FishDocumentSymbol, b: FishDocumentSymbol) {
  if (!isArparseFishDocumentSymbol(a) || !isArparseFishDocumentSymbol(b)) return false;
  return equalRanges(a.selectionRange, b.selectionRange);
}

export function _getNameLocation(sym: FishDocumentSymbol) {
  const shortName = sym.name.replace(/^_flag/, '').replace(/_/g, '-');
  if (shortName.includes('/')) {
    if (shortName.length === 1) {
      return {
        start: sym.selectionRange.start,
        end: {
          line: sym.selectionRange.end.line,
          character: sym.selectionRange.end.character + 1,
        },
      };
    } else {
      return {
        start: {
          line: sym.selectionRange.start.line,
          character: sym.selectionRange.start.character + 2,
        },
        end: {
          line: sym.selectionRange.end.line,
          character: sym.selectionRange.start.character + 2 + shortName.length,
        },
      };
    }
  } else {
    return sym.selectionRange;
  }
}
