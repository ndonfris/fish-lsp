//import { AbstractTree } from '../src/utils/abstractTree'; // Replace with the actual path to your AbstractTree class
import { SyntaxNode } from 'web-tree-sitter'; // Replace with the actual package import
import { FishDocumentSymbol } from '../src/document-symbol'; // Replace with the actual package import

type GenericTestNode = Partial<SyntaxNode> | {
    text: string;
    type: string;
    children: GenericTestNode[];
};

type GenericTestSymbol = Partial<FishDocumentSymbol> & {
    name: string;
    kind: number;
    children: GenericTestSymbol[];
}

describe('AbstractTree', () => {

    // Helper function to create a simple SyntaxNode for testing
    function createTestNode(
        text: string,
        type: string,
        startLine: number,
        startCharacter: number,
        endLine: number,
        endCharacter: number,
        children: GenericTestNode[] = []
    ): GenericTestNode {
      return {
        text,
        type,
        startPosition: {
          row: startLine,
          column: startCharacter,
        },
        endPosition: {
          row: endLine,
          column: endCharacter,
        },
        children,
      };
    }

    // Helper function to create a simple DocumentSymbol for testing
    function createDocumentSymbol(
      name: string,
      kind: number,
      startLine: number,
      startCharacter: number,
      endLine: number,
      endCharacter: number,
      children: GenericTestSymbol[] = []
    ): GenericTestSymbol {
      return {
        name,
        kind,
        range: {
          start: {
            line: startLine,
            character: startCharacter,
          },
          end: {
            line: endLine,
            character: endCharacter,
          },
        },
        selectionRange: {
          start: {
            line: startLine,
            character: startCharacter,
          },
          end: {
            line: endLine,
            character: endCharacter,
          },
        },
        children,
      };
    }

  it('should flatten all children correctly', () => {
    // Test with SyntaxNode
    const rootNode: SyntaxNode = createSyntaxNode('Root');
    rootNode.children.push(createSyntaxNode('Child1'));
    rootNode.children.push(createSyntaxNode('Child2'));
    rootNode.children[0].children.push(createSyntaxNode('Child1_1'));
    rootNode.children[0].children.push(createSyntaxNode('Child1_2'));

    const abstractSyntaxTree = new AbstractTree<SyntaxNode>([rootNode]);
    const flattenedSyntaxNodes = abstractSyntaxTree.flattenAllChildren();

    expect(flattenedSyntaxNodes).toHaveLength(5);
    expect(flattenedSyntaxNodes.map((node) => node.type)).toEqual([
      'Root',
      'Child1',
      'Child1_1',
      'Child1_2',
      'Child2',
    ]);

    // Test with DocumentSymbol
    const rootSymbol: FishDocumentSymbol = createDocumentSymbol('Root');
    rootSymbol.children.push(createDocumentSymbol('Child1'));
    rootSymbol.children.push(createDocumentSymbol('Child2'));
    rootSymbol.children[0].children.push(createDocumentSymbol('Child1_1'));
    rootSymbol.children[0].children.push(createDocumentSymbol('Child1_2'));

    const abstractSymbolTree = new AbstractTree<FishDocumentSymbol>([rootSymbol]);
    const flattenedSymbols = abstractSymbolTree.flattenAllChildren();

    expect(flattenedSymbols).toHaveLength(5);
    expect(flattenedSymbols.map((symbol) => symbol.kind)).toEqual([
      'Root',
      'Child1',
      'Child1_1',
      'Child1_2',
      'Child2',
    ]);
  });

  it('should remove a child correctly', () => {
    // Test with SyntaxNode
    const rootNode: SyntaxNode = createSyntaxNode('Root');
    const child1 = createSyntaxNode('Child1');
    const child2 = createSyntaxNode('Child2');
    rootNode.children.push(child1, child2);

    const abstractSyntaxTree = new AbstractTree<SyntaxNode>([rootNode]);
    abstractSyntaxTree.removeChild(child1);

    expect(abstractSyntaxTree.children).toHaveLength(1);
    expect(abstractSyntaxTree.children[0]).toBe(child2);

    // Test with DocumentSymbol
    const rootSymbol: DocumentSymbol = createDocumentSymbol('Root');
    const symbol1 = createDocumentSymbol('Child1');
    const symbol2 = createDocumentSymbol('Child2');
    rootSymbol.children.push(symbol1, symbol2);

    const abstractSymbolTree = new AbstractTree<DocumentSymbol>([rootSymbol]);
    abstractSymbolTree.removeChild(symbol2);

    expect(abstractSymbolTree.children).toHaveLength(1);
    expect(abstractSymbolTree.children[0]).toBe(symbol1);
  });

  it('should filter children correctly', () => {
    // Test with SyntaxNode
    const rootNode: SyntaxNode = createSyntaxNode('Root');
    rootNode.children.push(createSyntaxNode('Identifier'));
    rootNode.children.push(createSyntaxNode('Literal'));
    rootNode.children.push(createSyntaxNode('Identifier'));
    rootNode.children.push(createSyntaxNode('NumericLiteral'));

    const abstractSyntaxTree = new AbstractTree<SyntaxNode>([rootNode]);
    const filteredNodes = abstractSyntaxTree.filter((node) => node.type === 'Identifier');

    expect(filteredNodes).toHaveLength(2);
    expect(filteredNodes.map((node) => node.type)).toEqual(['Identifier', 'Identifier']);

    // Test with DocumentSymbol
    const rootSymbol: DocumentSymbol = createDocumentSymbol('Root');
    rootSymbol.children.push(createDocumentSymbol('Class'));
    rootSymbol.children.push(createDocumentSymbol('Function'));
    rootSymbol.children.push(createDocumentSymbol('Variable'));
    rootSymbol.children.push(createDocumentSymbol('Class'));

    const abstractSymbolTree = new AbstractTree<DocumentSymbol>([rootSymbol]);
    const filteredSymbols = abstractSymbolTree.filter((symbol) => symbol.kind === 'Class');

    expect(filteredSymbols).toHaveLength(2);
    expect(filteredSymbols.map((symbol) => symbol.kind)).toEqual(['Class', 'Class']);
  });
});