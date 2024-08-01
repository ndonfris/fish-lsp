import Parser, { SyntaxNode, Range, TreeCursor, Point } from 'web-tree-sitter';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  FishDocumentSymbol,
  flattenSymbols,
  getFishDocumentSymbolItems,

} from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
// import * as NodeTypes from '../src/utils/node-types';
import { initializeParser } from '../src/parser';
import { WorkspaceSymbol } from 'vscode-languageserver';

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
      'function foo \\',
      '    -a a b c',
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

    // const foo = getChildNodes(rootNode).find(n => NodeTypes.isFunctionDefinitionName(n))!.parent!;
    // const functionNodes = getChildNodes(rootNode).filter(n => NodeTypes.isFunctionDefinitionName(n));
    // functionNodes.forEach(functionNode => {
    //   // const parsedFunction = parseFishFunction(functionNode);
    //   // console.log(JSON.stringify(parsedFunction, null, 2));
    // });

    // console.log(parseFishFunction(foo));
    // console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
    const first = symbols[0];
    if (!first || !first.children) fail('No Symbol Children in \'Test 1\'');

    /** logging */
    // console.log('root', first.name);
    // for (const symbol of first.children) {
    //   console.log('\t' + symbol.name);
    // }

    expect(symbols[0]?.children.length).toBe(3);
  });

  it('test 2: `function path; path resolve $argv; end;`', async () => {
    const doc = createFakeLspDocument('functions/path.fish', [
      'function path',
      '    path resolve $argv',
      'end',
    ].join('\n'));
    const { rootNode } = parser.parse(doc.getText());
    const symbols = getFishDocumentSymbolItems(doc.uri, rootNode);
    expect(symbols.length).toBe(1);
    // console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
  });

  it('test 3: scripts/run.sh', () => {
    const doc = createFakeLspDocument('scripts/run.fish', [
      '#!/usr/bin/env fish',
      'set cmd $argv',
      'eval $cmd',
    ].join('\n'));
    const { rootNode } = parser.parse(doc.getText());
    const symbols = getFishDocumentSymbolItems(doc.uri, rootNode);
    expect(symbols.length).toBe(1);
    // console.log(symbols.map(s => s.name + '\n' + s.detail + '\n' + md.separator()));
  });

  it('test 4: flattenSymbols(foo, bar, baz)', () => {
    const doc = createFakeLspDocument('functions/foo_bar.fish', [
      'function foo --argument-names a b c d',
      '    set depth 1',
      '    echo "$a $b $c $d"',
      '    set e "$a $b $c $d"',
      '    echo "depth: $depth"',
      '    function bar --argument-names f',
      '       set depth 2',
      '       echo $f',
      '       echo "depth: $depth"',
      '       function baz',
      '           set depth 3',
      '           echo "inside baz: $a"',
      '           echo "depth: $depth"',
      '       end',
      '    end',
      'end',
    ].join('\n'));

    const { rootNode } = parser.parse(doc.getText());
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(doc.uri, rootNode);

    const flatSymbols = flattenSymbols(...symbols);

    /** logging */
    // for (const symbol of flatSymbols) {
    //   console.log(symbol.name);
    // }

    expect(flatSymbols.length).toBe(12);
  });

  it('test 5: Translate/Filter WorkspaceSymbols(foo, bar, baz)', () => {
    const doc = createFakeLspDocument('functions/foo_bar.fish', [
      'function foo_bar --argument-names a b c d',
      '    set depth 1',
      '    echo "$a $b $c $d"',
      '    set -gx e "$a $b $c $d"',
      '    echo "depth: $depth"',
      '    function bar --argument-names f',
      '       set depth 2',
      '       echo $f',
      '       echo "depth: $depth"',
      '    end',
      'end',
    ].join('\n'));

    const { rootNode } = parser.parse(doc.getText());
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(doc.uri, rootNode);

    /** WorkspaceSymbols found filtering a LspDocument's FishDocumentSymbol[] items for ScopeTag */
    const result: FishDocumentSymbol[] = [];
    for (const symbol of flattenSymbols(...symbols)) {
      if (['global', 'universal'].includes(symbol.scope.scopeTag)) {
        result.push(symbol);
      }
    }

    /** convert results to WorkspaceSymbols */
    const workspaceSymbols = result.map(symbol => {
      return {
        name: symbol.name,
        kind: symbol.kind,
        location: { uri: symbol.uri, range: symbol.range },
      } as WorkspaceSymbol;
    });

    // console.log(workspaceSymbols);
    expect(workspaceSymbols.length).toBe(2);

    /** logging */
    // for (const symbol of flatSymbols) {
    //   console.log(symbol.name);
    // }
  });
});
