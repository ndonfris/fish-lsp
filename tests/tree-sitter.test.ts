import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import {
  getChildNodes,
  getNamedChildNodes,
  findChildNodes,
  getParentNodes,
  findFirstParent,
  getSiblingNodes,
  findFirstNamedSibling,
  findFirstSibling,
  findEnclosingScope,
  getNodeText, firstAncestorMatch,
  ancestorMatch,
  descendantMatch,
  hasNode,
  getNamedNeighbors,
  getRange,
  findNodeAt,
  equalRanges,
  getNodeAt,
  getNodeAtRange,
  positionToPoint,
  pointToPosition,
  rangeToPoint, isFishExtension,
  isPositionWithinRange,
  isPositionAfter,
  isNodeWithinRange,
  getLeafNodes,
  getLastLeafNode,
  getParentNodesGen,
} from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import * as NodeTypes from '../src/utils/node-types';

function parseString(str: string): Parser.Tree {
  const tree = parser.parse(str);
  return tree;
}

function parseStringForNode(str: string, predicate: (n: SyntaxNode) => boolean) {
  const tree = parseString(str);
  const { rootNode } = tree;
  return getChildNodes(rootNode).filter(predicate);
}

let parser: Parser;
const jestConsole = console;

beforeEach(async () => {
  parser = await initializeParser();
  global.console = require('console');
});

afterEach(() => {
  global.console = jestConsole;
  if (parser) parser.delete();
});

describe('tree-sitter.ts functions testing', () => {
  let mockRootNode: SyntaxNode;

  it('getChildNodes returns all child nodes', () => {
    mockRootNode = parseString('set -gx a "1" "2" "3"').rootNode;
    const result = getChildNodes(mockRootNode);
    expect(result.length).toBe(15);
  });

  it('getNamedChildNodes returns all named child nodes', () => {
    mockRootNode = parseString('set -gx a "1" "2" "3"').rootNode;
    const result = getNamedChildNodes(mockRootNode);
    expect(result.length).toBe(8);
    expect(result.map(n => n.type)).toEqual([
      'program',
      'command',
      'word',
      'word',
      'word',
      'double_quote_string',
      'double_quote_string',
      'double_quote_string',
    ]);
  });
  it('findChildNodes returns nodes matching predicate', () => {
    // const predicate = (node: SyntaxNode) => node.type === 'targetType';
    mockRootNode = parseString('set -gx a "1" "2" "3"').rootNode;
    const result = findChildNodes(mockRootNode, NodeTypes.isCommand);
    expect(result.map(f => f.text)).toEqual(['set -gx a "1" "2" "3"']);
    const resultName = findChildNodes(mockRootNode, NodeTypes.isCommandName);
    expect(resultName.map(f => f.text)).toEqual(['set']);
  });

  it('getParentNodes returns all parent nodes', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const results = getParentNodes(node);
    expect(results.map(n => n.text)).toEqual(['"3"', 'set -gx a "1" "2" "3"', 'set -gx a "1" "2" "3"']);
    expect(results.map(n => n.type)).toEqual(['double_quote_string', 'command', 'program']);
  });

  it('findFirstParent returns first parent node matching predicate', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = findFirstParent(node, NodeTypes.isCommand);
    expect(result?.text).toEqual('set -gx a "1" "2" "3"');
  });

  it('getSiblingNodes returns sibling nodes', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = getSiblingNodes(node, NodeTypes.isString, 'before');
    expect(result.map(t => t.text)).toEqual(['"2"', '"1"']);
  });

  it('findFirstNamedSibling returns first named sibling node', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = findFirstNamedSibling(node, NodeTypes.isVariableDefinitionName)!;
    expect(result.text).toEqual('a');
  });

  it('findFirstSibling returns first sibling node', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = findFirstSibling(node, NodeTypes.isOption, 'before')!;
    expect(result.text).toEqual('-gx');
  });

  it('findEnclosingScope returns enclosing scope node', () => {
    const node = parseStringForNode([
      'function __func_1',
      '    if test -z $argv',
      '        return 0',
      '    end',
      '    set -gx a "1" "2" "3"',
      'end',
    ].join('\n'), (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = findEnclosingScope(node);
    expect(result.type).toEqual('function_definition');
  });

  it('getNodeText returns text of the node', () => {
    const input = [
      'function __func_1',
      '    if test -z $argv',
      '        return 0',
      '    end',
      '    set -gx a "1" "2" "3"',
      'end',
    ].join('\n');
    let node = parseStringForNode(input, (n: SyntaxNode) => n.text === '"3"').pop()!;
    let result = getNodeText(node);
    expect(result).toEqual('"3"');
    node = parseStringForNode(input, (n: SyntaxNode) => n.text === '__func_1').pop()!;
    result = getNodeText(node);
    expect(result).toEqual('__func_1');

    node = parseStringForNode(input, NodeTypes.isFunctionDefinition).pop()!;
    result = getNodeText(node);
    // console.log(result);
    expect(result).toEqual('__func_1');
  });

  // test('getNodesTextAsSingleLine returns concatenated text of nodes', () => {
  //   const result = getNodesTextAsSingleLine([mockRootNode]);
  //   // Add assertions here
  // });
  //
  it('firstAncestorMatch returns first ancestor matching predicate', () => {
    const input = [
      'function __func_1',
      '    if test -z $argv',
      '        return 0',
      '    end',
      '    set -gx a "1" "2" "3"',
      'end',
    ].join('\n');
    const node = parseStringForNode(input, (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = firstAncestorMatch(node, NodeTypes.isCommand)!;
    expect(result.text).toEqual('set -gx a "1" "2" "3"');
  });

  it('ancestorMatch returns all matching ancestor nodes', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', (n: SyntaxNode) => n.text === '"3"').pop()!;
    const result = ancestorMatch(node, NodeTypes.isOption, false);
    expect(result.map(n => n.text)).toEqual([
      '-gx',
      '-gx',
    ]);
  });

  it('descendantMatch returns all matching descendant nodes', () => {
    const node = parseStringForNode('set -gx a "1" "2" "3"', NodeTypes.isCommand).pop()!;
    const result = descendantMatch(node, NodeTypes.isVariableDefinitionName);
    expect(result.map(n => n.text)).toEqual(['a']);
  });

  it('hasNode checks if array has the node', () => {
    const root = parseString('set -gx a "1" "2" "3"').rootNode;
    const node = getChildNodes(root).find(n => NodeTypes.isOption(n))!;
    // const node = parseStringForNode('set -gx a "1" "2" "3"', NodeTypes.isCommand).pop()!
    const result = hasNode(getChildNodes(root), node);
    expect(result).toBeTruthy();
  });

  it('getNamedNeighbors returns named neighbors', () => {
    const root = parseString('set -gx a "1" "2" "3"').rootNode;
    const node = getChildNodes(root).find(n => NodeTypes.isOption(n))!;
    const result = getNamedNeighbors(node);
    expect(result.map(n => n.text)).toEqual(['set', '-gx', 'a', '"1"', '"2"', '"3"']);
  });

  it('getRange returns range of the node', () => {
    const root = parseString('set -gx a "1" "2" "3"').rootNode;
    const node = getChildNodes(root).find(n => NodeTypes.isOption(n))!;
    expect(getRange(root)).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 21 } });
    expect(getRange(node)).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 7 } });
  });

  it('findNodeAt finds node at position', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const result = findNodeAt(tree, 0, 5)!;
    expect(result.text).toEqual('-gx');
  });
  //
  it('equalRanges checks if ranges are equal', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;

    const rangeA = { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } };
    const rangeB = getRange(rootNode);
    const result = equalRanges(rangeA, rangeB);
    expect(result).toBeTruthy();
  });

  it('getNodeAt finds node at position', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const result = getNodeAt(tree, 0, 0)!;
    expect(result.text).toBe('set');
  });

  it('getNodeAtRange finds node at range', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const result = getNodeAtRange(rootNode, range)!;
    expect(result.text).toBe('set');
    // console.log(result.text);
  });

  it('positionToPoint converts position to point', () => {
    const position = { line: 0, character: 5 };
    const start = positionToPoint(position);
    const end = positionToPoint(position);
    expect(positionToPoint(position)).toEqual({
      row: 0,
      column: 5,
    });
  });

  it('pointToPosition converts point to position', () => {
    const point = { row: 0, column: 1 };
    const result = pointToPosition(point);
    expect(result).toEqual({
      line: 0,
      character: 1,
    });
  });

  it('rangeToPoint converts range to point', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } };
    const result = rangeToPoint(range);
    expect(result).toEqual({
      row: 0,
      column: 0,
    });
  });

  // it('getRangeWithPrecedingComments returns range with preceding comments', () => {
  //   const result = getRangeWithPrecedingComments(mockRootNode);
  //   // Add assertions here
  // });
  //
  // it('getPrecedingComments returns preceding comments', () => {
  //   const result = getPrecedingComments(mockRootNode);
  //   // Add assertions here
  // });
  //
  it('isFishExtension checks if path has fish extension', () => {
    const result = isFishExtension('file:///home/user/.config/fish/functions/test.fish');
    expect(result).toBeTruthy();
  });

  it('isPositionWithinRange checks if position is within range', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;
    const position = { line: 0, character: 0 };
    const range = getRange(rootNode);
    const result = isPositionWithinRange(position, range);
    expect(result).toBeTruthy();
  });

  it('isPositionAfter checks if position is after another position', () => {
    const positionA = { line: 0, character: 0 };
    const positionB = { line: 0, character: 5 };
    const result = isPositionAfter(positionA, positionB);
    expect(result).toBeTruthy();
  });

  it('isNodeWithinRange checks if node is within range', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } };
    const result = isNodeWithinRange(rootNode.firstNamedChild!, range);
    expect(result).toBeTruthy();
  });

  it('getLeafNodes returns leaf nodes', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;
    const result = getLeafNodes(rootNode);

    expect(result.map(m => m.text)).toEqual([
      'set', '-gx', 'a',
      '"', '"', '"',
      '"', '"', '"',
    ]);
  });

  it('getLastLeaf returns last leaf node', () => {
    const tree = parseString('set -gx a "1" "2" "3"');
    const rootNode = tree!.rootNode;
    const result = getLastLeafNode(rootNode);
    expect(result.text).toEqual('"');
  });

  it('getParentsNodesGen*', () => {
    const { rootNode } = parseString('set -gx a "1" "2" "3"');
    const node = getChildNodes(rootNode).find(n => n.text === 'a')!;
    const withoutSelf: SyntaxNode[] = [];
    for (const parent of getParentNodesGen(node)) {
      withoutSelf.push(parent);
    }
    expect(withoutSelf.length).toBe(2);
    expect(withoutSelf.map(n => n.type)).toEqual(['command', 'program']);
    const withSelf: SyntaxNode[] = [];
    for (const parent of getParentNodesGen(node, true)) {
      withSelf.push(parent);
    }
    expect(withSelf.length).toBe(3);
    expect(withSelf.map(n => n.type)).toEqual(['word', 'command', 'program']);
  });

  // it('matchesTypes', () => {
  //   const tree = parseString('set -gx a  "1" "2" "3"');
  //   const rootNode = tree!.rootNode;
  //   getChildNodes(rootNode).forEach((child) => {
  //     console.log(child.grammarType, child.grammarType);
  //   })
  //
  // });
  // it('matchesArgument checks if node matches argument', () => {
  //   const result = matchesArgument(mockRootNode, 'arg');
  //   // Add assertions here
  // });
  //
  // it('getCommandArgumentValue returns command argument value', () => {
  //   const result = getCommandArgumentValue(mockRootNode, 'arg');
  //   // Add assertions here
  // });
});
