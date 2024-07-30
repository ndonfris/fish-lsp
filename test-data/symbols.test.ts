import Parser, { SyntaxNode, Range, TreeCursor, Point } from 'web-tree-sitter';
// import { createMockedSyntaxNode } from './mock-syntax-node';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  // findAllSymbolItems,
  // SymbolItem,
  // SymbolItemType,
  // symbolItemToDocumentSymbol,
  // symbolItemToWorkspaceSymbol,
  // findDocumentSymbols,
  // findWorkspaceSymbols,
  // FishDocumentSymbol,
  getFishDocumentSymbolItems,
  // getFishDocumentSymbolItems

} from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import * as NodeTypes from '../src/utils/node-types';
import { initializeParser } from '../src/parser';
import { md } from '../src/utils/markdown-builder';
// import { DocumentSymbol, WorkspaceSymbol } from 'vscode-languageserver';
// import { isFunctionDefinition } from '../src/utils/node-types';

describe('BFS (Breadth First Search) vs DFS (Depth First Search) Iterators', () => {
  // Helper function to create mock SyntaxNodes
  function createMockNode(type: string, children: SyntaxNode[] = []): SyntaxNode {
    return {
      type,
      children,
      childCount: children.length,
      parent: null,
    } as any;
  }

  const mockTree = createMockNode('root', [
    createMockNode('child1', [
      createMockNode('grandchild1'),
      createMockNode('grandchild2'),
    ]),
    createMockNode('child2', [
      createMockNode('grandchild3'),
    ]),
  ]);

  const BFS_ExpectedOrder = ['root', 'child1', 'child2', 'grandchild1', 'grandchild2', 'grandchild3'];
  const DFS_ExpectedOrder = ['root', 'child1', 'grandchild1', 'grandchild2', 'child2', 'grandchild3'];

  it('nodesGen function === DFS', () => {
    const result = Array.from(TreeSitterUtils.nodesGen(mockTree)).map(node => node.type);
    expect(result).toEqual(DFS_ExpectedOrder);
  });

  it('BFS Iterator function should traverse in correct BFS order', () => {
    const result = Array.from(TreeSitterUtils.BFSNodesIter(mockTree)).map(node => node.type);
    expect(result).toEqual(BFS_ExpectedOrder);
  });

  it('DFS Iterator function should traverse in correct DFS order', () => {
    const result = Array.from(TreeSitterUtils.DFSNodesIter(mockTree)).map(node => node.type);
    expect(result).toEqual(DFS_ExpectedOrder);
  });
});

describe('BFS build getDocumentSymbol', () => {
  let parser: Parser;

  setLogger(async () => {
    parser = await initializeParser();
  }, async () => {
    parser?.reset();
  });

  it('test 1: `foo -a a b c; echo $a; echo $b; echo $c; end;`', async () => {
    const doc = createFakeLspDocument('functions/foo.fish', [
      'function foo -a a b c',
      '    echo $a',
      '    echo $b',
      '    echo $c',
      'end',
      'function bar',
      '    set -l a 11',
      'end',
      'foo 1 2 3',
    ].join('\n'));
    const { rootNode } = parser.parse(doc.getText());
    const symbols = getFishDocumentSymbolItems(doc.uri, rootNode);
    console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
  });

  it('test 2: `function path; path resolve $argv; end;`', async () => {
    const doc = createFakeLspDocument('functions/path.fish', [
      'function path',
      '    path resolve $argv',
      'end',
    ].join('\n'));
    const { rootNode } = parser.parse(doc.getText());
    const symbols = getFishDocumentSymbolItems(doc.uri, rootNode);
    console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
  });

  it('test 3: scripts/run.sh', () => {
    const doc = createFakeLspDocument('scripts/run.fish', [
      '#!/usr/bin/env fish',
      'set cmd $argv',
      'eval $cmd',
    ].join('\n'));
    const { rootNode } = parser.parse(doc.getText());
    const symbols = getFishDocumentSymbolItems(doc.uri, rootNode);
    console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
  });
});

// describe('reverseBFSInScope', () => {
//   jest.setMock('../src/utils/node-types', () => ({
//     isVariableDefinitionName: jest.fn(),
//     isFunctionDefinitionName: jest.fn()
//   }))
//
//   // Mock the utility functions
//   beforeEach(() => {
//     // Set up the mock implementations
//     (NodeTypes.isVariableDefinitionName as jest.Mock).mockImplementation((node: SyntaxNode) => {
//       return node.type === 'mock_variable_definition';
//     });
//
//     (NodeTypes.isFunctionDefinitionName as jest.Mock).mockImplementation((node: SyntaxNode) => {
//       return node.type === 'mock_function_definition';
//     });
//   });
//
//   // Mock function to create SyntaxNode
//   function createMockNode(type: string, startIndex: number, children: SyntaxNode[] = []): SyntaxNode {
//     return {
//       type,
//       children,
//       childCount: children.length,
//       startIndex,
//       parent: null,
//       lastChild: children[ children.length - 1 ] || null,
//     } as any;
//   }
//
//   // Link parent nodes
//   function linkParent(nodes: SyntaxNode[]): void {
//     nodes.forEach(node => {
//       node.children.forEach(child => {
//         (child as any).parent = node;
//       });
//     });
//   }
//
//   // it('should yield the variable definition before startNode', () => {
//   //
//   //   // Create mock nodes
//   //   const varDefNode = createMockNode('variable_assignment', 1);
//   //   const childNode = createMockNode('expression', 5, [ varDefNode ]);
//   //   const startNode = createMockNode('variable_reference', 10, [ childNode ]);
//   //
//   //   // Link parents
//   //   linkParent([ startNode, childNode, varDefNode ]);
//   //
//   //   // Perform the reverse BFS
//   //   const iterator = TreeSitterUtils.reverseBFSInScope(startNode);
//   //   const result = Array.from(iterator);
//   //
//   //   // Expect the variable definition node to be yielded
//   //   expect(result).toContain(varDefNode);
//   // });
//
//   it('should yield the function definition in the same scope', () => {
//
//     // Create mock nodes
//     const funcDefNode = createMockNode('mock_function_definition', 2);
//     const childNode = createMockNode('expression', 5, [ funcDefNode ]);
//     const startNode = createMockNode('variable_reference', 10, [ childNode ]);
//
//     // Link parents
//     linkParent([ startNode, childNode, funcDefNode ]);
//
//     // Perform the reverse BFS
//     const iterator = TreeSitterUtils.reverseBFSInScope(startNode);
//     const result = Array.from(iterator);
//
//     // Expect the function definition node to be yielded
//     expect(result).toBe(funcDefNode);
//   });
//
//   it('should return an empty array if no definition is found', () => {
//
//     // Create mock nodes
//     const childNode = createMockNode('expression', 5);
//     const startNode = createMockNode('variable_reference', 10, [ childNode ]);
//
//     // Link parents
//     linkParent([ startNode, childNode ]);
//
//     // Perform the reverse BFS
//     const iterator = TreeSitterUtils.reverseBFSInScope(startNode);
//     const result = Array.from(iterator);
//
//     // Expect no definition node to be yielded
//     expect(result).toEqual([]);
//   });
//
//   // it('should handle cyclic references gracefully', () => {
//   //   // Mock implementations for isVariableDefinitionName and isFunctionDefinitionName
//   //   isVariableDefinitionName.mockImplementation((node: SyntaxNode) => node.type === 'variable_assignment');
//   //   isFunctionDefinitionName.mockImplementation((node: SyntaxNode) => node.type === 'function_definition');
//   //
//   //   // Create mock nodes
//   //   const funcDefNode = createMockNode('function_definition', 2);
//   //   const childNode = createMockNode('expression', 5, [ funcDefNode ]);
//   //   const startNode = createMockNode('variable_reference', 10, [ childNode ]);
//   //
//   //   // Introduce cyclic reference
//   //   (funcDefNode as any).parent = startNode;
//   //
//   //   // Link parents
//   //   linkParent([ startNode, childNode, funcDefNode ]);
//   //
//   //   // Perform the reverse BFS
//   //   const iterator = TreeSitterUtils.reverseBFSInScope(startNode);
//   //   const result = Array.from(iterator);
//   //
//   //   // Expect the function definition node to be yielded
//   //   expect(result).toContain(funcDefNode);
//   // });
//   //
//   // it('should stop on base case where program.lastChild === currentNode', () => {
//   //
//   //   // Create mock nodes
//   //   const programNode = createMockNode('program', 0);
//   //   const lastChildNode = createMockNode('variable_reference', 10);
//   //   programNode.children.push(lastChildNode);
//   //   (lastChildNode as any).parent = programNode;
//   //   (programNode as any).lastChild = lastChildNode;
//   //
//   //   // Perform the reverse BFS
//   //   const iterator = TreeSitterUtils.reverseBFSInScope(lastChildNode);
//   //   const result = Array.from(iterator);
//   //
//   //   // Expect no nodes to be yielded since it should stop immediately
//   //   expect(result).toEqual([]);
//   // });
// });
