import { SyntaxNode } from 'web-tree-sitter';
import { isBlock, isConditional, isIfStatement, isReturn, isStatement } from '../utils/node-types';

export const buildStatementChildren = (n: SyntaxNode) => {
  if (!isBlock(n)) {
    return [];
  }
  const children = n.namedChildren;
  const childrenBeforeNextClause: SyntaxNode[] = [];
  for (const child of children) {
    if (isBlock(child)) {
      return childrenBeforeNextClause;
    } else {
      childrenBeforeNextClause.push(child);
    }
  }
  return childrenBeforeNextClause;
};

export function ifStatementHasReturn(n: SyntaxNode) {
  if (!isIfStatement(n)) {
    return false;
  }
  const children = n.namedChildren;
  for (const child of children) {
    if (isReturn(child)) {
      return true;
    }
    if (isStatement(child)) {
      return false;
    }
  }
  return false;
}

export function elseIfHasReturn(n: SyntaxNode) {
  if (n.type !== 'else_if_clause') {
    return false;
  }
  const children = n.namedChildren;
  for (const child of children) {
    if (isReturn(child)) {
      return true;
    }
    if (isStatement(child)) {
      return false;
    }
  }
}

export function elseHasReturn(n: SyntaxNode) {
  if (n.type !== 'else_clause') {
    return false;
  }
  const children = n.namedChildren;
  for (const child of children) {
    if (isReturn(child)) {
      return true;
    }
    if (isStatement(child)) {
      return false;
    }
  }
}

