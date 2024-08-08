import os from 'os';
import Parser, { SyntaxNode, Range, TreeCursor, Point } from 'web-tree-sitter';
import { createFakeLspDocument, setLogger } from './helpers';
import {
  FishDocumentSymbol,
  flattenSymbols,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { Position, WorkspaceSymbol } from 'vscode-languageserver';
import { isCommandName, isFunctionDefinitionName, isVariableDefinitionName } from '../src/utils/node-types';
import { getRange } from '../src/utils/tree-sitter';
import { LspDocument } from '../src/document';
import { SyncFileHelper } from '../src/utils/file-operations';

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

let parser: Parser;

setLogger(async () => {
  parser = await initializeParser();
}, async () => {
  parser?.reset();
});

describe('[FishDocumentSymbol OPERATIONS]', () => {
  function testSymbolExtraction(filename: string, code: string) {
    const doc = createFakeLspDocument(filename, code);
    const { rootNode } = parser.parse(doc.getText());
    return getFishDocumentSymbolItems(doc.uri, rootNode);
  }

  it('`foo -a a b c; echo $a; echo $b; echo $c; end;`', () => {
    const symbols = testSymbolExtraction('functions/foo.fish', `
      function foo \\
          -a a b c
          echo $a
          echo $b
          echo $c
      end
      function bar
          set -l a 11
      end
      foo 1 2 3
    `);
    expect(symbols[0]?.children.length).toBe(3);
  });

  it('`function path; path resolve $argv; end;`', () => {
    const symbols = testSymbolExtraction('functions/path.fish', `
      function path
          path resolve $argv
      end
    `);
    expect(symbols.length).toBe(1);
  });

  it('scripts/run.sh', () => {
    const symbols = testSymbolExtraction('scripts/run.fish', `
      #!/usr/bin/env fish
      set cmd $argv
      eval $cmd
    `);
    expect(symbols.length).toBe(1);
  });

  it('flattenSymbols(foo, bar, baz)', () => {
    const symbols = testSymbolExtraction('functions/foo_bar.fish', `
      function foo --argument-names a b c d
          set depth 1
          echo "$a $b $c $d"
          set e "$a $b $c $d"
          echo "depth: $depth"
          function bar --argument-names f
             set depth 2
             echo $f
             echo "depth: $depth"
             function baz
                 set depth 3
                 echo "inside baz: $a"
                 echo "depth: $depth"
             end
          end
      end
    `);
    const flatSymbols = flattenSymbols(...symbols);
    expect(flatSymbols.length).toBe(12);
  });

  describe('[FILTER] FishDocumentSymbols', () => {
    function testSymbolFiltering(filename: string, code: string) {
      const doc = createFakeLspDocument(filename, code);
      const { rootNode } = parser.parse(doc.getText());
      const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(doc.uri, rootNode);
      const flatSymbols = flattenSymbols(...symbols);
      return {
        flatSymbols,
        rootNode,
        doc,
        tree: parser.parse(code),
      };
    }

    it('( `global` || `universal` ) WorkspaceSymbols from (foo, bar, baz)', () => {
      const { flatSymbols } = testSymbolFiltering('functions/foo_bar.fish', `
        function foo_bar --argument-names a b c d
            set depth 1
            echo "$a $b $c $d"
            set -gx e "$a $b $c $d"
            echo "depth: $depth"
            function bar --argument-names f
               set depth 2
               echo $f
               echo "depth: $depth"
            end
        end
      `);

      const result = flatSymbols.filter(symbol => ['global', 'universal'].includes(symbol.scope.scopeTag));
      const workspaceSymbols = result.map(symbol => ({
        name: symbol.name,
        kind: symbol.kind,
        location: { uri: symbol.uri, range: symbol.range },
      } as WorkspaceSymbol));

      expect(workspaceSymbols.length).toBe(2);
    });

    it('filter up-to-node `foo_bar` `a` `b` `c` `d` `depth` [`e`]', () => {
      const { flatSymbols, rootNode } = testSymbolFiltering('functions/foo_bar.fish', [
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
      const cursor: Position = getRange(
        TreeSitterUtils
          .getChildNodes(rootNode)
          .find(n => isVariableDefinitionName(n) && n.text === 'e')!,
      ).end;

      const result = flatSymbols
        .filter(s => s.name !== 'e')
        .filter(s => s.scope.containsPosition(cursor));

      // console.log(result.map(s => s.name));
      expect(result.map(s => s.name)).toEqual([
        'foo_bar',
        'a',
        'b',
        'c',
        'd',
        'depth',
      ]);
    });

    // it('[nested function] filter up-to-node (BAD SYNTAX: `foo_baz`, `_baz`)', () => {
    //
    //   const result = testSymbolFiltering('functions/foo_baz.fish', [
    //     `function foo_baz`,
    //     `     _baz`,
    //     `    `,
    //     `    function _baz`,
    //     `        echo 'cant read _baz'`,
    //     `    end`,
    //     `end`,
    //   ].join('\n'))
    //   const {tree, rootNode, flatSymbols} = result
    //   const cursor: Position = getRange(
    //       TreeSitterUtils.getChildNodes(tree.rootNode)
    //       .find((n: SyntaxNode) => n.text === '_baz' && isFunctionDefinitionName(n))!
    //   ).end
    //
    //   const cursorNode: SyntaxNode = tree.rootNode.namedDescendantForPosition(
    //     TreeSitterUtils.positionToPoint({ line: cursor.line, character: cursor.character - 1 })
    //   )!;
    //
    //   const symbols = flatSymbols.filter(s => s.scope.containsPosition(cursor))
    //   console.log(symbols.map(s => s.name));
    // });

    // it('[private function] filter up-to-node (GOOD SYNTAX: `foo_bar`, `_bar`)', () => {
    //
    //   const result = testSymbolFiltering('functions/foo_bar.fish', [
    //     `function foo_bar`,
    //     `     _bar`,
    //     `    `,
    //     `end`,
    //     `function _bar`,
    //     `    echo 'CAN READ _bar'`,
    //     `end`,
    //   ].join('\n'))
    //   const {tree, rootNode, flatSymbols} = result
    //   const cursor: Position = getRange(
    //       TreeSitterUtils.getChildNodes(tree.rootNode)
    //       .find((n: SyntaxNode) => n.text === '_baz' && isFunctionDefinitionName(n))!
    //   ).end
    //
    //   const cursorNode: SyntaxNode = tree.rootNode.namedDescendantForPosition(
    //     TreeSitterUtils.positionToPoint({ line: cursor.line, character: cursor.character - 1 })
    //   )!;
    //
    //   const symbols = flatSymbols.filter(s => s.scope.containsPosition(cursor))
    //   console.log(symbols.map(s => s.name));
    // })
  });

  /**
    * UNTESTED
    */
  describe('**UNTESTED** [SPECIAL VARIABLES] `argparse`, `$status`, `$pipestatus`, `$argv`', () => {
    function testSpecialVariables(filename: string, code: string, targetText: string) {
      const tree = parser.parse(code);
      const { rootNode } = tree;
      const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(filename, rootNode);
      const cursor: Position = getRange(
        TreeSitterUtils
          .getChildNodes(rootNode)
          .find(n => (isCommandName(n) || n.text === targetText) && n.text === targetText)!,
      ).end;

      const cursorNode: SyntaxNode = tree.rootNode.namedDescendantForPosition(
        TreeSitterUtils.positionToPoint({
          line: cursor.line,
          character: cursor.character - 1,
        }),
      )!;

      // console.log(targetText, { cursorNode: cursorNode.text });
      return cursorNode;
    }

    it('argparse h/help', () => {
      const cursorNode = testSpecialVariables('functions/foo.fish', `
        function foo
            argparse h/help n/name q/query -- $argv
            or return
            
            set -gx e "$a $b $c $d"
            set depth 1
        end
      `, 'argparse');
      expect(cursorNode.text).toBe('argparse');
    });

    it('`_flag_help` from `argparse h/help -- $argv; or return`', () => {
      const cursorNode = testSpecialVariables('functions/foo.fish', `
        function foo --argument-names a b c d
            argparse h/help n/name q/query -- $argv
            or return
            
            if set -q _flag_help
                echo "help message"
            end
            set depth 1
        end
      `, '_flag_help');
      expect(cursorNode.text).toBe('_flag_help');
    });

    it('`$argv` from `argparse h/help -- $argv; or return`', () => {
      const cursorNode = testSpecialVariables('functions/foo.fish', `
        function foo
            argparse h/help n/name q/query -- $argv
            or return
            
            set depth 1
        end
      `, '$argv');
      expect(cursorNode.text).toBe('argv');
    });

    it('`$status` from `argparse h/help -- $argv; or return`', () => {
      const cursorNode = testSpecialVariables('functions/foo.fish', `
        function foo
            argparse h/help n/name q/query -- $argv
            or return
            
            return $status
        end
      `, '$status');
      expect(cursorNode.text).toBe('status');
    });

    it('`$pipe_status` from `echo \'hello world\' | string split \' \'`', () => {
      const cursorNode = testSpecialVariables('functions/foo.fish', `
        function foo
            echo 'hello world' | string split ' '
            
            return $pipestatus
        end
      `, '$pipestatus');
      expect(cursorNode.text).toBe('pipestatus');
    });
  });

  /**
   * https://github.com/ndonfris/fish-lsp/blob/76e31bd6d585f4648dc7fedde942bfbfb679cc23/src/workspace-symbol.ts
   */
  describe('src/workspace-symbol.ts refactors', () => {
    it('source filenames (`test-source`)', () => {
      const doc = createFakeLspDocument('functions/test-source.fish', [
        'function test-source',
        '    source ~/.config/fish/config.fish',
        '    source $var',
        'end',
      ].join('\n'));
      const tree = parser.parse(doc.getText());
      const { rootNode } = tree;
      const focusedNodes: SyntaxNode[] = TreeSitterUtils
        .getChildNodes(rootNode)
        .filter(n => isCommandName(n) && n.text === 'source' && !!n.nextSibling)
        .map(n => n.nextSibling) as SyntaxNode[];

      // const sourceFilename: SyntaxNode = focusedNodes.shift()
      // const sourceVariable: SyntaxNode = focusedNodes.shift()
      const [sourceFilename, sourceVariable]: [ SyntaxNode, SyntaxNode ] =
        [focusedNodes.at(0), focusedNodes.at(1)] as [ SyntaxNode, SyntaxNode ];

      // console.log(sourceFilename.text);
      // console.log(sourceVariable.text);
      // console.log(SyncFileHelper.expandEnvVars(sourceFilename.text));

      const result = `${os.homedir()}/.config/fish/config.fish`;
      expect(SyncFileHelper.expandEnvVars(sourceFilename.text)).toBe(result);

      // do something with $var
    });
  });
});
