import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { LspDocument } from '../document';

/**
 * Checks if a SyntaxNode is a `for` loop definition name.
 *
 * ```fish
 * for i in (seq 1 10);
 * #   ^_________________ `i` is the for loop definition name
 * end
 * ```
 *
 * @param node - The SyntaxNode to check (a 'variable_name' with a parent `for_statement`).
 * @return {boolean} - True if the node is a `for` loop definition name, false otherwise.
 */
export function isForVariableDefinitionName(node: SyntaxNode): boolean {
  if (node.parent && node.parent.type === 'for_statement') {
    return !!node.parent.firstNamedChild &&
      node.parent.firstNamedChild.type === 'variable_name' &&
      node.parent.firstNamedChild.equals(node);
  }
  return false;
}

/**
 * Create a FishSymbol for a `for` loop definition name.
 *
 * NOTE: `for ...` is not guaranteed to be processed into a FishSymbol,
 *        instead we only consider `for variable_name in ...` as a definition.
 *
 * @param document - The LspDocument containing the node.
 * @param node - The SyntaxNode representing the `for` loop definition name.
 * @param children - Optional array of FishSymbol children.
 * @return An array containing a single FishSymbol for the `for` loop definition.
 */
export function processForDefinition(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  const modifier = 'local';
  const definitionNode = node.firstNamedChild!;
  const definitionScope = DefinitionScope.create(node, modifier);
  return [
    FishSymbol.create(
      definitionNode.text,
      node,
      definitionNode,
      'FOR',
      document,
      document.uri,
      node.text,
      definitionScope,
      [],
      children,
    ),
  ];
}
