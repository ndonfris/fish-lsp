import { SyntaxNode } from 'web-tree-sitter';
import { VariableDefinitionFlag } from './definition-scope';
import './array';
import * as NodeTypes from './node-types';

function filterWordNodes(nodes: SyntaxNode[]): SyntaxNode[] {
  return nodes.filter(n => n.type === 'word');
}

export function setHasQuery(parentCommand?: SyntaxNode | null): boolean {
  if (!parentCommand) return false;
  for (const node of parentCommand.childrenForFieldName('argument')) {
    if (NodeTypes.isMatchingOption(node, { shortOption: '-q', longOption: '--query' })) {
      return true;
    }
  }
  return false;
}

const shouldStop = (node: SyntaxNode): boolean => {
  return (
    NodeTypes.isCommand(node) ||
    NodeTypes.isComment(node) ||
    NodeTypes.isShebang(node) ||
    NodeTypes.isSemicolon(node) ||
    NodeTypes.isNewline(node)
  );
};
export function isPossible(node: SyntaxNode): boolean {
  return (
    node.type === 'variable_name' ||
    node.type === 'word'
  );
}

export function gatherVariableSiblings(node: SyntaxNode): SyntaxNode[] {
  const siblings = [];
  let next = node.nextSibling;
  while (next && !shouldStop(next)) {
    siblings.push(next);
    next = next.nextSibling;
  }
  return siblings;
}

export function isSetDefinitionNode(nodes: SyntaxNode[], match: SyntaxNode): boolean {
  //if (setHasQuery(nodes)) return false;
  for (const node of nodes) {
    if (NodeTypes.isOption(node)) {
      continue;
    }
    if (node.equals(match)) {
      return true;
    } else {
      return false;
    }
  }
  return false;
}

export function isReadDefinitionNode(siblings: SyntaxNode[], match: SyntaxNode): boolean {
  const readVariables: SyntaxNode[] = [];
  while (siblings.length > 0) {
    const current = siblings.pop();
    if (!current) {
      break;
    }
    if (NodeTypes.isOption(current) || NodeTypes.isString(current)) {
      break;
    }
    readVariables.push(current);
  }
  return readVariables.some(n => n.equals(match));
}

export function isFunctionArgumentDefinitionNode(parent: SyntaxNode, match: SyntaxNode): boolean {
  let lastFlag: SyntaxNode | null = null;
  for (const node of parent.childrenForFieldName('option')) {
    if (NodeTypes.isOption(node)) {
      lastFlag = node;
      continue;
    }
    if (match.equals(node)) break;
  }

  const afterLastFlag = parent.children
    .slice(parent.children.findLastIndex((l) => lastFlag?.equals(l)) + 1)
    .collectWhile((n) => !NodeTypes.isOption(n));

  const args: SyntaxNode[] = [];

  for (const node of afterLastFlag) {
    if (NodeTypes.isMatchingOption(lastFlag!, { shortOption: '-a', longOption: '--argument-names' })) {
      args.push(node);
    }
    if (NodeTypes.isMatchingOption(lastFlag!, { shortOption: '-V', longOption: '--inherit-variable' })) {
      args.push(node);
    }
    if (NodeTypes.isMatchingOption(lastFlag!, { shortOption: '-v', longOption: '--on-variable' })) {
      args.push(node);
    }
  }
  return args.some(n => n.equals(match));
}

// const argFlag = new VariableDefinitionFlag('a', 'argument-names');
// const args : SyntaxNode[] = [];
// for (let i = 0; i < siblings.length; i++) {
//   const child = siblings[i];
//   if (child && argFlag.isMatch(child)) {
//     let varName = child.nextSibling;
//     while (varName !== null && varName.type === 'word' && !varName.text.startsWith('-')) {
//       args.push(varName);
//       varName = varName.nextSibling;
//     }
//   }
// }
// return args.some(n => n.equals(match));
// }

export function isForLoopDefinitionNode(siblings: SyntaxNode[], match: SyntaxNode): boolean {
  const first = siblings[0];
  if (!first) {
    return false;
  }
  return first.type === 'variable_name' && first.equals(match) || false;
}