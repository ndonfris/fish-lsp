import { SyntaxNode } from 'web-tree-sitter';
import { findOptionsSet, Option } from './options';
import { FishSymbol, FishSymbolKindMap } from './symbol';
import { LspDocument } from '../document';
import { isEscapeSequence, isNewline } from '../utils/node-types';
import { PrebuiltDocumentationMap } from '../utils/snippets';
import { DefinitionScope } from '../utils/definition-scope';
import { isAutoloadedUriLoadsFunctionName } from '../utils/translation';
import { getRange } from '../utils/tree-sitter';

export const FunctionOptions = [
  Option.create('-a', '--argument-names').withMultipleValues(),
  Option.create('-d', '--description').withValue(),
  Option.create('-w', '--wraps').withValue(),
  Option.create('-e', '--on-event').withValue(),
  Option.create('-v', '--on-variable').withValue(),
  Option.create('-j', '--on-job-exit').withValue(),
  Option.create('-p', '--on-process-exit').withValue(),
  Option.create('-s', '--on-signal').withValue(),
  Option.create('-S', '--no-scope-shadowing'),
  Option.create('-V', '--inherit-variable').withValue(),
];

function isFunctionDefinition(node: SyntaxNode) {
  return node.type === 'function_definition';
}

export function findFunctionDefinitionChildren(node: SyntaxNode) {
  return node.childrenForFieldName('option').filter(n => !isEscapeSequence(n) && !isNewline(n));
}

export function processArgvDefinition(document: LspDocument, node: SyntaxNode) {
  if (!document.isAutoloaded() && node.type === 'program') {
    return [
      FishSymbol.fromObject({
        name: 'argv',
        node: node,
        focusedNode: node.firstChild!,
        fishKind: FishSymbolKindMap.variable,
        uri: document.uri,
        detail: PrebuiltDocumentationMap.getByName('argv').pop()?.description || 'the list of arguments passed to the function',
        scope: DefinitionScope.create(node, 'local'),
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        range: getRange(node),
        children: [],
      }),
    ];
  }
  return [];
}

export function processFunctionDefinition(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  if (!isFunctionDefinition(node)) return [];

  const autoloadScope = isAutoloadedUriLoadsFunctionName(document);

  const focusedNode = node.firstNamedChild!;
  const isGlobal = autoloadScope(focusedNode) ? 'global' : 'local';

  if (!focusedNode) return [];

  const functionSymbol = FishSymbol.create(
    focusedNode.text,
    node,
    focusedNode,
    FishSymbolKindMap.function,
    document.uri,
    node.text,
    DefinitionScope.create(node.parent!, isGlobal),
  );

  const focused = node.childrenForFieldName('option').filter(n => !isEscapeSequence(n) && !isNewline(n));
  functionSymbol.addChildren(
    FishSymbol.create(
      'argv',
      node,
      node.firstNamedChild!,
      FishSymbolKindMap.variable,
      document.uri,
      PrebuiltDocumentationMap.getByName('argv').pop()?.description || 'the list of arguments passed to the function',
      DefinitionScope.create(node, 'local'),
    ),
  );

  if (!focused) return [functionSymbol];

  const flagsSet = findOptionsSet(focused, FunctionOptions);
  for (const flag of flagsSet) {
    const { option, value: focused } = flag;
    switch (true) {
      case option.isOption('-a', '--argument-names'):
      case option.isOption('-V', '--inherit-variable'):
      case option.isOption('-v', '--on-variable'):
        functionSymbol.addChildren(
          FishSymbol.create(
            focused.text,
            node,
            focused,
            FishSymbolKindMap.variable,
            document.uri,
            focused.text,
            DefinitionScope.create(node, 'local'),
          ),
        );
        break;
      default:
        break;
    }
  }
  return [functionSymbol.addChildren(...children)];
}
