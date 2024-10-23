import { SyntaxNode, Point } from 'web-tree-sitter';
import { findParentFunction, nodesGen } from '../utils/tree-sitter';
import { Position, Range } from '../utils/locations';
import * as LSP from 'vscode-languageserver';

export type Mods = 'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL';

export const globalSymbols = new Map<string, SyntaxNode>();

/**
 *  Returns a callback function that return the scope node of the given node
 */
export function scopeCallback(modifier: Mods, node: SyntaxNode | null = null) {
  const scopeCallbackMap: Record<Mods, () => SyntaxNode | null> = {
    ['GLOBAL']: () => {
      if (!node) return null;
      // return globalSymbols.get(node.text) as SyntaxNode | null;
      return findParentFunction(node);
    },
    ['UNIVERSAL']: () => null,
    ['LOCAL']: () => node,
    ['FUNCTION']: () => {
      if (!node) return null;
      return findParentFunction(node);
    },
  };

  return function getModifier() {
    if (!node) return null;
    return scopeCallbackMap[modifier]();
  };
}

export function setGlobalSymbol(node: SyntaxNode) {
  globalSymbols.set(node.text, node);
}

export function removeLocalInnerSymbols(modifier: Mods, node: SyntaxNode) {
  const parent = scopeCallback(modifier, node)();

  // if (node?.parent?.type === 'function_definition' && !node.parent?.firstNamedChild?.equals(node)) {
  // }

  const result: SyntaxNode[] = [];
  const skipNodes: SyntaxNode[] = [];

  if (parent !== null) {
    let skipStart: Point | undefined;
    let skipEnd: Point | undefined;
    console.log({
      pType: parent.type,
      parentStart: parent.startPosition,
      parentEnd: parent.endPosition,
      nodeStart: node.startPosition,
      nodeEnd: node.endPosition,
      nextSiblingStart: node.nextNamedSibling?.startPosition,
      nextSiblingEnd: node.nextNamedSibling?.endPosition,

    });
    // console.log('parent', parent.type, parent.startPosition, parent.endPosition, node.startPosition, node.endPosition);
    if (node?.parent?.type === 'function_definition' && node.parent?.firstNamedChild?.equals(node)) {
      skipStart = parent.startPosition;
      skipEnd = node.parent.endPosition;
    } else if (node.parent?.type === 'function_definition') {
      skipStart = node.nextNamedSibling?.endPosition;
      // skipEnd = parent.endPosition;
      // skipStart = node.nextNamedSibling.endPosition;
      // skipEnd = parent.endPosition;
    }
    let functionDefinitions = parent.descendantsOfType('function_definition', skipStart, skipEnd);
    if (modifier === 'LOCAL' || modifier === 'FUNCTION') {
      functionDefinitions = functionDefinitions.filter(p => !p.equals(parent));
    }
    skipNodes.push(...functionDefinitions);
  }

  if (node?.parent?.type === 'command') {
    const command = node.parent;
    const commandName = command.firstNamedChild;
    if (commandName?.text === 'function') {
      skipNodes.push(commandName);
    }
  }

  if (parent) {
    for (const child of nodesGen(parent)) {
      // if (child.type !== 'word') continue;
      if (!skipNodes.some(skip => Range.containsRange(Range.fromNode(skip), Range.fromNode(child)))) {
        result.push(child);
        continue;
      }
      // globalSymbols.delete(child.text);
    }
  }

  return result;
}
