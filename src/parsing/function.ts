import { SyntaxNode } from 'web-tree-sitter';
import { findOptionsSet, Option, OptionValueMatch } from './options';
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

export const FunctionEventOptions = [
  Option.create('-e', '--on-event').withValue(),
  Option.create('-v', '--on-variable').withValue(),
  Option.create('-j', '--on-job-exit').withValue(),
  Option.create('-p', '--on-process-exit').withValue(),
  Option.create('-s', '--on-signal').withValue(),
];

function isFunctionDefinition(node: SyntaxNode) {
  return node.type === 'function_definition';
}

/**
 * Util to find all the arguments of a function_definition node
 *
 * function foo -a bar baz -V foobar -d '...' -w '...' --on-event '...'
 *               ^  ^   ^   ^  ^      ^  ^    ^   ^     ^         ^
 *               all of these nodes would be returned in the SyntaxNode[] array
 * @param node the function_definition node
 * @returns SyntaxNode[] of all the arguments to the function_definition
 */
export function findFunctionDefinitionChildren(node: SyntaxNode) {
  return node.childrenForFieldName('option').filter(n => !isEscapeSequence(n) && !isNewline(n));
}

/**
 * Get argv definition for fish shell script files (non auto-loaded files)
 */
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

/**
 * checks if a node is the function name of a function definition
 * function foo
 *          ^--- here
 */
export function isFunctionDefinitionName(node: SyntaxNode) {
  if (!node.parent || !isFunctionDefinition(node.parent)) return false;
  return !!node.parent.firstNamedChild && node.parent.firstNamedChild.equals(node);
}

/**
 * checks if a node is the variable name of a function definition
 * function foo --argument-names bar baz --inherit-variable foobar
 *                               ^   ^                       ^
 *                               |   |                       |
 *                               Could be any of these nodes above
 * Currently doesn't check for `--on-variable`, because it should be inherited
 */
export function isFunctionVariableDefinitionName(node: SyntaxNode) {
  if (!node.parent || !isFunctionDefinition(node.parent)) return false;
  const { variableNodes } = findFunctionVariableArguments(node.parent);
  const definitionNode = variableNodes.find(n => n.equals(node));
  return !!definitionNode && definitionNode.equals(node);
}

/**
 * Find all the function_definition variables that are defined in the function header
 *
 * The `flagsSet` property contains all the nodes that were found to be variable names,
 * with the flag that was used to define them.
 *
 * @param node the function_definition node
 * @returns Object containing the defined SyntaxNode[] and OptionValueMatch[] flags set
 */
function findFunctionVariableArguments(node: SyntaxNode): { variableNodes: SyntaxNode[]; flagsSet: OptionValueMatch[]; } {
  const variableNodes: SyntaxNode[] = [];
  const focused = node.childrenForFieldName('option').filter(n => !isEscapeSequence(n) && !isNewline(n));
  const flagsSet = findOptionsSet(focused, FunctionOptions);
  for (const flag of flagsSet) {
    const { option, value: focused } = flag;
    switch (true) {
      case option.isOption('-a', '--argument-names'):
      case option.isOption('-V', '--inherit-variable'):
        // case option.isOption('-v', '--on-variable'):
        variableNodes.push(focused);
        break;
      default:
        break;
    }
  }
  return {
    variableNodes,
    flagsSet,
  };
}

/**
 * Process a function definition node and return the corresponding FishSymbol[]
 * for the function and its arguments. Includes argv as a child, along with any
 * flags that create function scoped variables + any children nodes are stored as well.
 */
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
      FishSymbolKindMap.function_variable,
      document.uri,
      PrebuiltDocumentationMap.getByName('argv').pop()?.description || 'the list of arguments passed to the function',
      DefinitionScope.create(node, 'local'),
    ),
  );

  if (!focused) return [functionSymbol];

  const { flagsSet } = findFunctionVariableArguments(node);
  for (const flag of flagsSet) {
    const { option, value: focused } = flag;
    switch (true) {
      case option.isOption('-a', '--argument-names'):
      case option.isOption('-V', '--inherit-variable'):
        // case option.isOption('-v', '--on-variable'):
        functionSymbol.addChildren(
          FishSymbol.create(
            focused.text,
            node,
            focused,
            FishSymbolKindMap.function_variable,
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
