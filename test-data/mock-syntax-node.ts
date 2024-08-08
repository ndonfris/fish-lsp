import { mock } from 'ts-jest-mocker';
import { SyntaxNode, Point } from 'web-tree-sitter';

interface MockedSyntaxNodeParams {
  text: string;
  type: string;
  children?: MockedSyntaxNodeParams[];
}

export function createMockedTreeSitter(params: MockedSyntaxNodeParams, parent: SyntaxNode | null = null): SyntaxNode {
  function computePosition(index: number): Point {
    const lines = params.text.slice(0, index).split('\n');
    return { row: lines.length - 1, column: lines[lines.length - 1].length ?? 0 };
  }

  const startPosition = computePosition(0);
  const endPosition = computePosition(params.text.length);

  const mockedNode = mock<SyntaxNode>();

  // Assign properties directly to the mock instance
  Object.assign(mockedNode, {
    startPosition,
    endPosition,
    startIndex: 0,
    endIndex: params.text.length,
    text: params.text,
    type: params.type,
    children: [],
    parent,
  });

  // Set up children nodes
  mockedNode.children = (params.children || []).map(child => createMockedTreeSitter(child, mockedNode));
  mockedNode.childCount = mockedNode.children.length;
  mockedNode.namedChildCount = mockedNode.children.filter(child => child.isNamed).length;

  // Mock methods
  mockedNode.child.mockImplementation((index: number) => mockedNode.children[index] || null);
  mockedNode.namedChild.mockImplementation((index: number) => mockedNode.children[index] || null);

  return mockedNode;
}

// Jest helper function to simplify creating mock nodes
export const createMockedSyntaxNode = (text: string, type: string, children: MockedSyntaxNodeParams[] = []) => createMockedTreeSitter({ text, type, children });

// Example Jest test
// describe('createMockedTreeSitter', () => {
//   it('should create a mocked tree-sitter node structure', () => {
//     const input1 = createMockedSyntaxNode("echo a b c;\necho d e f", "program", [
//       create;
