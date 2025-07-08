import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isFunctionDefinition } from '../utils/node-types';
import { FishSymbol } from './symbol';
import { DefinitionScope, ScopeTag } from '../utils/definition-scope';
import { LspDocument } from '../document';
import { getRange } from '../utils/tree-sitter';
import { md } from '../utils/markdown-builder';
import { unindentNestedSyntaxNode } from './symbol-detail';
import { findFunctionOptionNamedArguments } from './function';

/**
 * Check if a SyntaxNode is an emitted/fired event definition name
 * ```fish
 * emit my_event_name
 * #    ^^^^^^^^^^^^^^ This is the emitted event definition name
 * ```
 * @param node - The SyntaxNode to check
 * @return {boolean} - True if the node is an emitted event definition name, false otherwise
 */
export function isEmittedEventDefinitionName(node: SyntaxNode): boolean {
  if (!node.parent || !node.isNamed) return false;

  if (!isCommandWithName(node.parent, 'emit')) {
    return false;
  }

  return !!(node.parent.namedChild(1) && node.parent.namedChild(1)?.equals(node));
}

/**
 *  Finds the emitted event definition name from a command node.
 *  ```fish
 *    emit my_event_name
 *  # ^^^^----------------- searches here
 *  #      ^^^^^^^^^^^^^--- returns this node
 *  ```
 */
function findEmittedEventDefinitionName(node: SyntaxNode): SyntaxNode | undefined {
  if (!isCommandWithName(node, 'emit')) return undefined;
  if (node.namedChild(1)) return node.namedChild(1) || undefined;
  return undefined;
}

/**
 * Checks if a SyntaxNode is a generic event handler name, in a function definition
 *
 * ```fish
 * function my_function --on-event my_event_name
 * #                     ^^^^^^^^^^^^^^^^^^^^^^ This is the event handler definition name
 * end
 * ````
 *
 * @param node - The SyntaxNode to check
 * @return {boolean} - True if the node is a generic event handler definition name, false otherwise
 */
export function isGenericFunctionEventHandlerDefinitionName(node: SyntaxNode): boolean {
  if (!node.parent || !node.isNamed) return false;

  // Check if the parent is a function definition with an event handler option
  if (!isFunctionDefinition(node.parent)) return false;
  const { eventNodes } = findFunctionOptionNamedArguments(node.parent);
  return eventNodes.some(eventNode => eventNode.equals(node));
}

/**
 * Processes an emit event command node and returns a FishSymbol representing the emitted event.
 *
 * Note: The processFunctionDefinition() function also handles building Event Symbols, but
 *       specifically creates them for `function ... --on-event NAME` (`fishKind === 'FUNCTION_EVENT'`),
 *       where as, this function creates symbols for `emit NAME` commands (`fishKind === 'EVENT'`).
 *
 * @param document - The LspDocument containing the node
 * @param node - The SyntaxNode representing the emit command
 * @param children - Optional array of child FishSymbols
 *
 * @returns {FishSymbol[]} - An array containing a FishSymbol for the emitted event
 */
export function processEmitEventCommandName(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []): FishSymbol[] {
  const emittedEventNode = findEmittedEventDefinitionName(node);
  if (!emittedEventNode) return [];

  const eventName = emittedEventNode.text;

  const parentCommand = node;

  const scopeTag: ScopeTag = document.isAutoloaded()
    ? 'global'
    : 'local';

  return [
    new FishSymbol({
      name: eventName,
      fishKind: 'EVENT',
      node: parentCommand,
      children,
      document: document,
      scope: DefinitionScope.create(node, scopeTag),
      focusedNode: emittedEventNode,
      range: getRange(parentCommand),
      detail: [
        `(${md.bold('event')}) ${md.inlineCode(eventName)}`,
        md.separator(),
        md.codeBlock('fish', [
          '### emit/fire a generic event',
          unindentNestedSyntaxNode(parentCommand),
        ].join('\n')),
        md.separator(),
        md.boldItalic('SEE ALSO:'),
        '  • Emit Events: https://fishshell.com/docs/current/cmds/emit.html',
        '  • Event Handling: https://fishshell.com/docs/current/language.html#event',
      ].join(md.newline()),
    }),
  ];
}
