import { SyntaxNode } from 'web-tree-sitter';
import { SemanticToken } from '../utils/semantics';
import { TokenTypes, ModifierTypes } from '../mini-semantic-handler';
import { TokenTransformContext } from './handlers';

export function bracketTransormer(node: SyntaxNode, context: TokenTransformContext) {
  const result: SemanticToken[] = [];
  const firstChild = node.firstNamedChild;
  if (firstChild && firstChild.type === 'word') {
    const openBracket = firstChild.firstChild;
    if (openBracket && openBracket.type === '[') {
      context.tokens.push(SemanticToken.fromNode(openBracket, TokenTypes.function, ModifierTypes.function))
    }
  }

  const lastChild = node.lastNamedChild;
  if (lastChild && lastChild.type === 'word') {
    const closeBracket = lastChild.firstChild;
    if (closeBracket && closeBracket.type === ']') {
      context.tokens.push(
        SemanticToken.fromNode(closeBracket, TokenTypes.function, ModifierTypes.function),
      );
    }
  }
  return result;
}





