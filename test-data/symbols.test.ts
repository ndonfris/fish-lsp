import { SyntaxNode, Range, TreeCursor, Point } from 'web-tree-sitter';
import { createMockedSyntaxNode } from './mock-syntax-node';
import { setLogger } from './helpers';
import {
  findAllSymbolItems,
  SymbolItem,
  SymbolItemType,
  symbolItemToDocumentSymbol,
  symbolItemToWorkspaceSymbol,
  findDocumentSymbols,
  findWorkspaceSymbols,
} from '../src/utils/symbol';
import { DocumentSymbol, WorkspaceSymbol } from 'vscode-languageserver';
import { isFunctionDefinition } from '../src/utils/node-types';
import { getChildNodes } from '../src/utils/tree-sitter';

// export type MockSyntaxNodeProps = {
//   type: string;
//   text: string;
//   startPosition: Point;
//   endPosition: Point;
//   startIndex: number;
//   endIndex: number;
//   children?: MockSyntaxNode[];
// };
//
// export class MockSyntaxNode implements Partial<SyntaxNode> {
//   type: string;
//   text: string;
//   startPosition: Point;
//   endPosition: Point;
//   startIndex: number;
//   endIndex: number;
//   children: MockSyntaxNode[];
//   parent: MockSyntaxNode | null;
//
//   constructor(props: MockSyntaxNodeProps) {
//     this.type = props.type;
//     this.text = props.text;
//     this.startPosition = props.startPosition;
//     this.endPosition = props.endPosition;
//     this.startIndex = props.startIndex;
//     this.endIndex = props.endIndex;
//     this.children = props.children || [];
//     this.parent = null;
//
//     this.children.forEach(child => {
//       child.parent = this;
//     });
//   }
//
//   get childCount(): number {
//     return this.children.length;
//   }
//
//   get namedChildCount(): number {
//     return this.children.filter(child => child.isNamed()).length;
//   }
//
//   isNamed(): boolean {
//     return !this.type.startsWith('_');
//   }
//
//   child(index: number): MockSyntaxNode | null {
//     return this.children[index] || null;
//   }
//
//   namedChild(index: number): MockSyntaxNode | null {
//     return this.children.filter(child => child.isNamed())[index] || null;
//   }
//
//   firstChild(): MockSyntaxNode | null {
//     return this.children[0] || null;
//   }
//
//   lastChild(): MockSyntaxNode | null {
//     return this.children[this.children.length - 1] || null;
//   }
//
//   firstNamedChild(): MockSyntaxNode | null {
//     return this.children.find(child => child.isNamed()) || null;
//   }
//
//   lastNamedChild(): MockSyntaxNode | null {
//     return [...this.children].reverse().find(child => child.isNamed()) || null;
//   }
//
//   hasChildren(): boolean {
//     return this.children.length > 0;
//   }
//
//   toString(): string {
//     return this.text;
//   }
//
//   descendantsOfType(types: string | string[], startPosition?: Point, endPosition?: Point): MockSyntaxNode[] {
//     const typeArray = Array.isArray(types) ? types : [types];
//     let descendants: MockSyntaxNode[] = [];
//
//     const isInRange = (node: MockSyntaxNode): boolean => {
//       if (!startPosition && !endPosition) return true;
//       if (startPosition && comparePoints(node.startPosition, startPosition) < 0) return false;
//       if (endPosition && comparePoints(node.endPosition, endPosition) > 0) return false;
//       return true;
//     };
//
//     const traverse = (node: MockSyntaxNode) => {
//       if (typeArray.includes(node.type) && isInRange(node)) {
//         descendants.push(node);
//       }
//       node.children.forEach(traverse);
//     };
//
//     traverse(this);
//     return descendants;
//   }
// }
//
// function comparePoints(a: Point, b: Point): number {
//   if (a.row !== b.row) {
//     return a.row - b.row;
//   }
//   return a.column - b.column;
// }
//
// export function createMockSyntaxNode(props: MockSyntaxNodeProps): MockSyntaxNode {
//   return new MockSyntaxNode(props);
// }
//
setLogger();
describe('Symbol conversion and finding', () => {
  const mockUri = 'file:///mock/path/script.fish';

  const mockRoot = createMockedSyntaxNode(
    'program', '#!/usr/bin/fish\necho hello world',
    [
      createMockedSyntaxNode('comment', '#!/usr/bin/fish'),

      createMockedSyntaxNode('command', 'echo hello world', [
        createMockedSyntaxNode('word', 'echo'),
        createMockedSyntaxNode('word', 'hello'),
        createMockedSyntaxNode('word', 'world'),
      ]),
    ]);

  it('should convert SymbolItem to DocumentSymbol', () => {
    for (const node of getChildNodes(mockRoot)) {
      console.log(node.text);
    }
    const input1 = createMockedSyntaxNode('echo a b c;\necho d e f', 'program', [
      createMockedSyntaxNode('echo a b c', 'command', [
        createMockedSyntaxNode('echo a b c', 'text', [
          createMockedSyntaxNode('echo', 'text'),
          createMockedSyntaxNode('a', 'text'),
          createMockedSyntaxNode('b', 'text'),
          createMockedSyntaxNode('c', 'text'),
        ]),
      ]),
      createMockedSyntaxNode(';', ';'),
      createMockedSyntaxNode('\n', '\n'),
      createMockedSyntaxNode('echo d e f', 'command', [
        createMockedSyntaxNode('echo', 'text'),
        createMockedSyntaxNode('d', 'text'),
        createMockedSyntaxNode('e', 'text'),
        createMockedSyntaxNode('f', 'text'),
      ]),
    ]);
    for (const node of getChildNodes(input1)) {
      console.log(node.endPosition.row);
    }
    console.log(input1.children.length - 1);

    // const symbolItems = findAllSymbolItems(mockRoot as unknown as SyntaxNode, mockUri);
    // console.log(symbolItems);
    // const documentSymbols = symbolItems.map(symbolItemToDocumentSymbol);
    //
    // expect(documentSymbols).toHaveLength(1);
    // expect(documentSymbols[ 0 ]?.name).toBe('func1');
    // expect(documentSymbols[ 0 ]?.children).toHaveLength(2);
    // expect(documentSymbols[ 0 ]?.children?.map(c => c.name)).toEqual([ 'var1', 'cmd1' ]);
  });

  //   it('should convert SymbolItem to WorkspaceSymbol', () => {
  //     const symbolItems = findAllSymbolItems(mockRoot as unknown as SyntaxNode, mockUri);
  //     const workspaceSymbols = symbolItems.flatMap(item =>
  //       flattenSymbolItemToWorkspaceSymbols(item, mockUri)
  //     );
  //
  //     expect(workspaceSymbols).toHaveLength(3);
  //     expect(workspaceSymbols.map(s => s.name)).toEqual([ 'func1', 'var1', 'cmd1' ]);
  //     expect(workspaceSymbols[ 0 ]?.location.uri).toBe(mockUri);
  //   });
  //
  //   it('should find DocumentSymbols', () => {
  //     const documentSymbols = findDocumentSymbols(mockRoot as unknown as SyntaxNode, mockUri);
  //
  //     expect(documentSymbols).toHaveLength(1);
  //     expect(documentSymbols[ 0 ]?.name).toBe('func1');
  //     expect(documentSymbols[ 0 ]?.children).toHaveLength(2);
  //     expect(documentSymbols[ 0 ]?.children?.map(c => c.name)).toEqual([ 'var1', 'cmd1' ]);
  //   });
  //
  //   it('should find WorkspaceSymbols', () => {
  //     const workspaceSymbols = findWorkspaceSymbols(mockRoot as unknown as SyntaxNode, mockUri);
  //
  //     expect(workspaceSymbols).toHaveLength(3);
  //     expect(workspaceSymbols.map(s => s.name)).toEqual([ 'func1', 'var1', 'cmd1' ]);
  //     expect(workspaceSymbols[ 0 ]?.location.uri).toBe(mockUri);
  //   });
  // });
  //
  // function flattenSymbolItemToWorkspaceSymbols(item: SymbolItem, uri: string): WorkspaceSymbol[] {
  //   const result: WorkspaceSymbol[] = [ symbolItemToWorkspaceSymbol(item) ];
  //   if (item.children) {
  //     for (const child of item.children) {
  //       result.push(...flattenSymbolItemToWorkspaceSymbols(child, uri));
  //     }
  //   }
  //   return result;
  // }
});
