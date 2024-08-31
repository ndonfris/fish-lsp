import os from 'os';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { createFakeLspDocument, setLogger, logFishDocumentSymbolTree, createFakeCursorLspDocument, getCursorText } from './helpers';
import { FishDocumentSymbol, filterDocumentSymbolInScope, filterLastPerScopeSymbol, filterSymbolsInScope, filterSymbolsOutsideOfCursor, filterWorkspaceSymbol, flattenNested, getFishDocumentSymbolItems } from '../src/utils/symbol';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import * as LSP from 'vscode-languageserver';
import { Position, SymbolKind } from 'vscode-languageserver';
import { isCommandName, isFunctionDefinition, isFunctionDefinitionName, isNewline, isSourceFilename } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { SyncFileHelper } from '../src/utils/file-operations';
import { Range } from '../src/utils/locations';
// import * as Locations from '../src/utils/locations';
import { containsRange, getChildNodes, getNodeAtPosition, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';

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

  const BFS_ExpectedOrder = [ 'root', 'child1', 'child2', 'grandchild1', 'grandchild2', 'grandchild3' ];
  const DFS_ExpectedOrder = [ 'root', 'child1', 'grandchild1', 'grandchild2', 'child2', 'grandchild3' ];

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

describe('FishDocumentSymbol OPERATIONS', () => {
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
    expect(symbols[ 0 ]?.children.length).toBe(3);
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

    const flatSymbols = flattenNested(...symbols);
    // console.log('flattenSymbols', flatSymbols.map(s => s.name));
    expect(flatSymbols.length).toBe(12);
  });

  describe('FILTER FishDocumentSymbols', () => {
    let parser: Parser;
    let analyzer: Analyzer;
    beforeEach(async () => {
      parser = await initializeParser();
      analyzer = new Analyzer(parser);
    });


    function testSymbolFiltering(filename: string, _input: string) {
      const { document, cursorPosition, input } = createFakeCursorLspDocument(filename, _input);
      const tree = parser.parse(document.getText());
      const { rootNode } = tree;
      const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(document.uri, rootNode);
      const flatSymbols = flattenNested(...symbols);
      const cursorNode = getNodeAtPosition(tree, cursorPosition)!;
      // console.log({ flatSymbolsNames: flatSymbols.map(s => s.name) });
      analyzer.analyze(document);
      return {
        symbols,
        flatSymbols,
        tree: tree,
        rootNode,
        doc: document,
        cursorPosition,
        cursorNode,
        input,
      };
    }

    it('FishDocumentSymbols log symbols tree', () => {
      const { symbols } = testSymbolFiltering('function/test-source.fish', [
        'function test-source',
        '    source ~/.config/fish/config.fish',
        '    source $var',
        '    echo ', // cursor is here @ EOL
        'end',
        'function __helper --argument-names a',
        '    echo inside helper $a',
        'end',
      ].join('\n'));

      expect(logFishDocumentSymbolTree(symbols)).toBe([
        'local     :::: ƒ test-source',
        'local     :::: ƒ __helper',
        'function  ::::      a',
      ].join('\n'));
    });


    it('FishDocumentSymbols upto cursor', () => {
      const { symbols } = testSymbolFiltering('function/test-source.fish', [
        'function test-source',
        '    source ~/.config/fish/config.fish',
        '    source $var',
        '    echo ', // cursor is here @ EOL
        'end',
        'function __helper --argument-names a',
        '    echo inside helper $a',
        'end',
      ].join('\n'));

      const pos = Position.create(3, 9);
      const scoped = filterDocumentSymbolInScope(symbols, pos);
      console.log('upto cursor', scoped.map(s => s.name));
      // expect(scoped.map(s => s.name)).toEqual([
      //   'test-source',
      //   '__helper',
      // ]);
    });

    it('WorkspaceSymbols for FishDocumentSymbols', () => {
      const { symbols } = testSymbolFiltering('functions/foo_bar.fish', [
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
        '    baz',
        'end',
        'function baz',
        '    echo "inside baz $argv"',
        'end',
      ].join('\n'));

      const ws = filterWorkspaceSymbol(symbols);
      expect(ws.map(s => s.name)).toEqual([
        'foo_bar',
        'e',
      ]);
    });
    it('get last FishDocumentSymbol before point', () => {
      const { doc, symbols } = testSymbolFiltering('functions/foo_bar.fish', [
        'function foo_bar',
        '    set -l arg_1 $argv[1]',
        '    set -l arg_2 $argv[1]',
        '    set arg_1 "hi"',
        '    ',
        'end'
      ].join('\n'));
      let flat = flattenNested(...symbols);
      const map = new Map<string, FishDocumentSymbol[]>();
      for (const symbol of flat) {
        const curr: FishDocumentSymbol[] = map.get(symbol.name)! ?? [];
        curr.push(symbol);
        map.set(symbol.name, curr);
      }
      const cursor = Position.create(4, 3);
      const value = filterDocumentSymbolInScope(symbols, cursor).filter(s => s.name === 'arg_1');
      expect(value.pop()?.detail).toEqual([
        '**(variable)** - *arg_1*',
        '___',
        '```fish',
        'set arg_1 "hi"',
        '```',
        ''
      ].join('\n'));
    });

    it('filter symbols before cursor', () => {
      const { doc, symbols } = testSymbolFiltering('functions/foo_bar.fish', [
        'function foo_bar',
        '    set -l arg_1 $argv[1]',
        '    set -l arg_2 $argv[1]',
        '    set arg_1 "hi"',
        '    ',
        'end',
        'function baz',
        '    echo "inside baz $argv"',
        'end',
        'set var 1',
      ].join('\n'));
      const flat = flattenNested(...symbols).filter(s => s.name === 'arg_1');
      let a = flat.at(0)!;
      // console.log(a.scope.scopeTag, b.scope.scopeTag);
      // console.log({ a: a.scope.scopeNode.text, b: b.scope.scopeNode.text });
      // console.log(a.scope.scopeNode.equals(b.scope.scopeNode), a.equalScopes(b));
      // console.log(a.equalScopes(b));
      // // flat.filter(s => s.name === 'arg_1').forEach(s => {
      // //   console.log(s.debugString({skipProperties: ['uri', 'node', 'children', 'detail']}));
      // // })
      // console.log('new');

      /*
      filterSymbolsOutsideOfCursor(symbols, a.range.end).forEach(s => {
        console.log(s.debugString({ skipProperties: [ 'uri', 'node', 'children', 'detail' ] }));
      });
      */
    });

      describe('filter last unique symbols', () => {
        // @TODO: refactor symbols to be chained
        it('functions/foo_bar.fish', () => {
          const { flatSymbols, tree, symbols, cursorPosition } = testSymbolFiltering('functions/foo_bar.fish', [
            'function foo_bar',
            '    set -l arg_1 $argv[1]',
            '    set -l arg_2 $argv[1]',
            '    set arg_1 "hi"█',
            '    ',
            'end',
            'function baz',
            '    echo "inside baz $argv"',
            'end',
          ].join('\n'));


          const cursorNode = getNodeAtPosition(tree, {line: cursorPosition.line, character: cursorPosition.character})!;
          // let a = flat.at(0)!;
          // let cursorNode = flat.filter(s => s.name === 'arg_1').at(1)!.node;

          let cursorParentFunction: SyntaxNode | null = null;

          const getParentFunction = (): SyntaxNode | null => {
            let parent: SyntaxNode | null = cursorNode;
            while (parent && !isFunctionDefinition(parent)) {
              parent = parent.parent;
            }
            return parent;
          };
          cursorParentFunction = getParentFunction()!;


          /**
         * here we filter out any symbols that are non-unique in the current scope
         */
          let results: FishDocumentSymbol[] = [];

          /**
         * here we filter out any symbols that would be a recursive definition of the
         * current function we are in. Which is not valid syntax fish.
         *
         * Then we filter out any symbols that are not in the current scope of the cursor
         */
          results = flatSymbols.filter(s => !(
            s.kind === SymbolKind.Function 
              && Range.containsPosition(s.range, cursorPosition)
          )).filter(s => s.scope.containsPosition(cursorPosition));

          /**
         * now we need to get the symbols only in the current scope of the cursor
         */
          // results = results.filter(s => s.scope.containsPosition(cursorPosition));

          console.log('cursor', cursorPosition, getCursorText(cursorNode, cursorPosition));


          results = results.filter(current => !results.some(other => (
            current.name === other.name &&
              !other.scopeSmallerThan(current) &&
              current.scope.scopeNode.equals(other.scope.scopeNode)
          )))

          // console.log('filtered');
          // results.forEach(s => {
          //   console.log(s.debugString({ skipProperties: [ 'uri', 'children', 'detail' ] }));
          // })
          // results.forEach(s => {
          //   console.log(s.debugString());
          // })

        });

        it('check: conf.d/foo.fish', () => {
          const {  tree, symbols, cursorPosition } = testSymbolFiltering('conf.d/foo.fish', [
            'function foo_bar',
            '    set -l arg_1 $argv[1]',
            '    set -l arg_2 $argv[1]',
            '    set arg_1 "hi"',
            '    ',
            'end',
            'function foo_baz',
            '    echo "inside baz $argv"',
            'end',
            'set var 1',
            '█'
          ].join('\n'));


          const flatSymbols = filterSymbolsInScope(symbols, cursorPosition)
          const cursorNode = getNodeAtPosition(tree, {line: cursorPosition.line, character: cursorPosition.character})!;
          // console.log('cursor', cursorNode.text);
          // flatSymbols.forEach(s => 
          //   console.log(s.debugString())
          // )
        })

      // TODO: test further  & implement `analyzer.getReferences()`
      it('functions/dupes.fish', () => {
        testSymbolFiltering('conf.d/foo.fish', [
          'function foo_bar',
          '    set -l arg_1 $argv[1]',
          '    set -l arg_2 $argv[1]',
          '    set arg_1 "hi"',
          '    ',
          'end',
          'function foo_baz',
          '    echo "inside baz $argv"',
          'end',
          'set var 1',
        ].join('\n'))

        testSymbolFiltering('completions/dupes.fish', [
          'function foo_bar',
          `    echo -e 'a\tdescription a'`,
          `    echo -e 'b\tdescription b'`,
          `    echo -e 'c\tdescription c'`,
          `end`,
          `foo_bar`,
          `complete -f -c dupes -a 'foo_bar'`,
        ].join('\n'))

        testSymbolFiltering('functions/dupes2.fish', [
          'function dupes2',
          '    dupes',
          'end',
          'dupes'
        ].join('\n'));
        const { doc, cursorPosition, symbols } = testSymbolFiltering('functions/dupes3.fish', [
          'function dupes3',
          '    function dupes',
          '         echo "inside dupes"',
          '    end',
          '    dupes█',
          'end',
          'dupes3'
        ].join('\n'));

        const defS  = filterSymbolsInScope(symbols, cursorPosition).pop()!
        console.log('def: ',defS.debugString());
        //
        // const refS = analyzer.getReferences(doc, cursorPosition)
        // refS.forEach(s => {
        //   console.log('ref:', s);
        // })
        const locations: LSP.Location[] = [];
        const uniqueLocations = new UniqueLocations();
        /**
         * local references
         */
        if (defS.scope.scopeTag !== 'global') {
          const localRefs = filterSymbolsInScope(symbols, cursorPosition)
            .filter(s => s.name === defS.name)
            .filter(s => s.scopeSmallerThan(defS) && s.scope.scopeTag !== defS.scope.scopeTag)
            .filter(s => s.scope.scopeNode.equals(defS.scope.scopeNode))

          for (const node of getChildNodes(defS.scope.scopeNode)) {
            if (localRefs.some(s => s.scope.containsNode(node))) {
              continue;
            }
            if (node.text === defS?.name) {
              uniqueLocations.add(LSP.Location.create(defS.uri, getRange(node)))
            }
          }
          uniqueLocations.locations.forEach(l => locations.push(l));
        }
        /**
         * global/all references
         */
        if (defS.scope.scopeTag === 'global') {
          analyzer.uris.forEach(uri => {
            const _cached = analyzer.cached.get(uri);
            if (!_cached) return;
            const localRefs = flattenNested(..._cached.symbols)
              .filter(s => s.name === defS.name)
              .filter(s => s.scopeSmallerThan(defS) && s.scope.scopeTag !== defS.scope.scopeTag)

            for (const node of _cached.nodes) {
              if (!node.isNamed || node.type !== 'word') {
                continue
              }
              if (localRefs.some(s => s.scope.containsNode(node))) {
                continue;
              }
              if (node.text === defS?.name) {
                uniqueLocations.add(LSP.Location.create(uri, getRange(node)))
              }
            }
          })
          uniqueLocations.locations.forEach(l => locations.push(l));
        }
        console.log('refs');
        expect(locations.length).toBe(2)
        expect(locations.every(l => l.uri === doc.uri)).toBeTruthy()
        locations.forEach(s => {
          console.log(s.uri, s.range);
        })
      })

      // it('local refs: functions/dupes.fish', () => {
      //   testSymbolFiltering('functions/dupe2.fish', [
      //     'function dupes2',
      //     '    dupes',
      //     'end',
      //   ].join('\n'));                   
      //   const { doc, cursorPosition } = testSymbolFiltering('functions/dupes.fish', [
      //     'function dupes',
      //     '    foo_bar',
      //     'end',
      //     'function foo_bar -a a',
      //     '    echo "$a"',
      //     'end',
      //     'dupes█'
      //   ].join('\n'));
      //
      //   const defS  = analyzer.getDefinitionSymbol(doc, cursorPosition).pop()
      //   console.log('def: ', defS?.debugString());
      //   //
      //   const refS = analyzer.getReferences(doc, cursorPosition)
      //   let i = 0
      //   console.log('refs');
      //   for (const s of refS) {
      //     console.log(i, s.uri, s.range);
      //     i++;
      //   }
      // })
    });
  })
})


    // });
    //
    // describe('analyzer', () => {
    //   it('local variables: getGlobalLocations(),getLocalLocations() ', () => {
    //     const { doc } = testSymbolFiltering('functions/foo.fish', [
    //       'function foo',
    //       '    set -l arg_1 $argv[1]',
    //       '    set -l arg_2 $argv[1]',
    //       '    set arg_1 "hi"',
    //       '    echo $arg_1',
    //       'end'
    //     ].join('\n'));
    //
    //     const searchPosition = Position.create(4, 10);
    //     const locals = analyzer.getLocalLocations(doc, searchPosition);
    //     const globals = analyzer.getGlobalLocations(doc, searchPosition);
    //     expect(locals.length).toBe(3);
    //     expect(globals.length).toBe(0);
    //   });
    //
    //   it('global variables: getGlobalLocations()', () => {
    //     let currentDocument: LspDocument;
    //     let cursor: Position;
    //     let documentTree: Parser.Tree;
    //     TestWorkspace.functionsOnly.documents.forEach(doc => {
    //       const currentCached = analyzer.analyze(doc);
    //       const { tree, nodes } = currentCached;
    //       if (doc.uri.endsWith('foo.fish')) {
    //         currentDocument = doc;
    //         cursor = TreeSitterUtils.pointToPosition(nodes.find(n => n.text === 'test')!.startPosition);
    //         documentTree = tree;
    //       }
    //     });
    //
    //     const globals = analyzer.getGlobalLocations(currentDocument!, cursor!);
    //
    //     // for (const g of globals) {
    //     //   const { root } = analyzer.cached.get(g.uri)!;
    //     //   const n = TreeSitterUtils.getNodeAtRange(root, g.range);
    //     //   console.log(n?.text);
    //     // }
    //
    //     expect(globals.length).toBe(2);
    //   });
    // });


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


/**
 * https://github.com/ndonfris/fish-lsp/blob/76e31bd6d585f4648dc7fedde942bfbfb679cc23/src/workspace-symbol.ts
 */
describe('src/workspace-symbol.ts refactors', () => {
  function setupTest(relPath: string, content: string) {
    const doc: LspDocument = createFakeLspDocument(relPath, content);
    const tree: Parser.Tree = parser.parse(doc.getText());
    const root: SyntaxNode = tree.rootNode;
    const nodes: SyntaxNode[] = TreeSitterUtils.getChildNodes(root);
    const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(doc.uri, tree.rootNode);
    return { doc, tree, root, nodes, symbols };
  }

  it('source filenames (`test-source`)', () => {
    const { nodes } = setupTest('functions/test-source.fish', [
      'function test-source',
      '    source ~/.config/fish/config.fish',
      '    source $var',
      'end',
    ].join('\n'));

    const focusedNodes: SyntaxNode[] =
      nodes
        .filter(n => isCommandName(n) && n.text === 'source' && !!n.nextSibling)
        .map(n => n.nextSibling) as SyntaxNode[];

    /** get the first and second occurrences in the input */
    const sourceFilename = focusedNodes.at(0) as SyntaxNode;
    const sourceVariable = focusedNodes.at(1) as SyntaxNode;

    /** make sure filename expands */
    const expectedFilename = `${os.homedir()}/.config/fish/config.fish`;
    expect(SyncFileHelper.expandEnvVars(sourceFilename.text)).toBe(expectedFilename);

    /** make sure variable is found */
    const expectedSourceVariable = '$var';
    expect(sourceVariable.text).toBe(expectedSourceVariable);

    /** test our isSourceFilename implementation */

    // console.log([
    //   `isSourceFilename(sourceFilename) === ${isSourceFilename(sourceFilename)}`,
    //   `isSourceFilename(sourceVariable) === ${isSourceFilename(sourceVariable)}`
    // ]);

    expect([
      isSourceFilename(sourceFilename),
      isSourceFilename(sourceVariable),
    ]).toEqual([ true, false ]);
  });
});

// const result: SyntaxNode[] = [];
// const flat = flattenNested(...symbols);
// const localSymbols = filterDocumentSymbolInScope(symbols, searchPosition)
//   .filter(
//     s => {
//       const isBefore = s.kind === SymbolKind.Variable ? TreeSitterUtils.precedesRange(s.selectionRange, getRange(searchNode)) : true;
//       return (s.name === searchNode?.text
//         && (s.scope.containsPosition(searchPosition) &&
//           containsRange(getRange(s.scope.scopeNode), getRange(searchNode))
//           && isBefore
//         ));
//     }
//   )
//   .map(s => s.scope.scopeNode);
// localSymbols.forEach(s => {
//   result.push(...TreeSitterUtils.getChildNodes(s).filter(n => n.text === searchNode.text));
// });

// /**
//  * workspace symbols
//  */
// if (localSymbols.length === 0) {
//   analyzer.uris.forEach(uri => {
//     const _cached = analyzer.cached.get(uri);
//     if (!_cached) return;
//     const _symbols = flattenNested(..._cached.symbols)
//       .filter(s => s.scope.scopeTag !== 'global');
//
//     const gSymbols = getGlobalSymbolsInDocument(_cached.nodes, _symbols)
//       .filter(s => s.text === searchNode.text);
//
//
//     result.push(...gSymbols);
//
//   });
//   // localSymbols.push(...)



/**
  * UNTESTED
  */
// describe('**UNTESTED** [SPECIAL VARIABLES] `argparse`,`$status`,`$pipestatus`,`$argv`', () => {
//   function testSpecialVariables(filename: string, code: string, targetText: string) {
//     const tree = parser.parse(code);
//     const { rootNode } = tree;
//     const symbols: FishDocumentSymbol[] = getFishDocumentSymbolItems(filename, rootNode);
//     const cursor: Position = getRange(
//       TreeSitterUtils
//         .getChildNodes(rootNode)
//         .find(n => (isCommandName(n) || n.text === targetText) && n.text === targetText)!,
//     ).end;
//
//     const cursorNode: SyntaxNode = tree.rootNode.namedDescendantForPosition(
//       TreeSitterUtils.positionToPoint({
//         line: cursor.line,
//         character: cursor.character - 1,
//       }),
//     )!;
//
//     // console.log(targetText, { cursorNode: cursorNode.text });
//     return cursorNode;
//   }
//
//   it('argparse h/help', () => {
//     const cursorNode = testSpecialVariables('functions/foo.fish', `
//       function foo
//           argparse h/help n/name q/query -- $argv
//           or return
//
//           set -gx e "$a $b $c $d"
//           set depth 1
//       end
//     `, 'argparse');
//     expect(cursorNode.text).toBe('argparse');
//   });
//
//   it('`_flag_help` from `argparse h/help -- $argv; or return`', () => {
//     const cursorNode = testSpecialVariables('functions/foo.fish', `
//       function foo --argument-names a b c d
//           argparse h/help n/name q/query -- $argv
//           or return
//
//           if set -q _flag_help
//               echo "help message"
//           end
//           set depth 1
//       end
//     `, '_flag_help');
//     expect(cursorNode.text).toBe('_flag_help');
//   });
//
//   it('`$argv` from `argparse h/help -- $argv; or return`', () => {
//     const cursorNode = testSpecialVariables('functions/foo.fish', `
//       function foo
//           argparse h/help n/name q/query -- $argv
//           or return
//
//           set depth 1
//       end
//     `, '$argv');
//     expect(cursorNode.text).toBe('argv');
//   });
//
//   it('`$status` from `argparse h/help -- $argv; or return`', () => {
//     const cursorNode = testSpecialVariables('functions/foo.fish', `
//       function foo
//           argparse h/help n/name q/query -- $argv
//           or return
//
//           return $status
//       end
//     `, '$status');
//     expect(cursorNode.text).toBe('status');
//   });
//
//   it('`$pipe_status` from `echo \'hello world\' | string split \' \'`', () => {
//     const cursorNode = testSpecialVariables('functions/foo.fish', `
//       function foo
//           echo 'hello world' | string split ' '
//
//           return $pipestatus
//       end
//     `, '$pipestatus');
//     expect(cursorNode.text).toBe('pipestatus');
//   });
// });


// it('local refs: {completions,functions}/dupes.fish', () => {
//   testSymbolFiltering('completions/dupes.fish', [
//     'function foo_bar',
//     `    echo -e 'a\tdescription a'`,
//     `    echo -e 'b\tdescription b'`,
//     `    echo -e 'c\tdescription c'`,
//     `end`,
//     `foo_bar`,
//     `complete -f -c dupes -a 'foo_bar'`,
//   ].join('\n'))
//
//   const { doc, cursorPosition } = testSymbolFiltering('functions/dupes.fish', [
//     'function dupes',
//     '    foo_bar█',
//     'end',
//     'function foo_bar -a a',
//     '    echo "$a"',
//     'end'
//   ].join('\n'));
//
//   const defS  = analyzer.getDefinitionSymbol(doc, cursorPosition).pop()!
//   // console.log('def: ', defS.debugString());
//   //
//   const refS = analyzer.getReferences(doc, cursorPosition)
//   // let i = 0
//   // console.log('refs');
//   // for (const s of refS) {
//   //   console.log(i, s.uri, s.range);
//   //   i++;
//   // }
// })

// it('global refs: {completions,functions}/dupes.fish', () => {
//   testSymbolFiltering('completions/dupes.fish', [
//     `complete -c dupes -s h -l help -d 'show help'`,
//   ].join('\n')) 
//
//   const { flatSymbols, symbols, rootNode, doc, cursorPosition } = testSymbolFiltering('functions/dupes.fish', [
//     'function dupes',
//     '    foo_bar',
//     'end',
//     'function foo_bar -a a',
//     '    echo "$a"',
//     'end',
//     'dupes█'
//   ].join('\n'))
//
//
//
//   // const node: SyntaxNode = getChildNodes(rootNode).find((n: SyntaxNode) => n.text === 'dupes')!
//   // const cursor = pointToPosition(node.endPosition)
//
//   filterSymbolsInScope(symbols, cursorPosition).forEach(s => {
//     console.log(s.debugString());
//   })
//   // flatSymbols.forEach(s => {
//   //   console.log(s.debugString());
//   // })
//   const defS  = analyzer.getDefinitionSymbol(doc, cursorPosition).pop()!
//   // console.log('def: ', defS.debugString());
//   //
//   // const refS = analyzer.getReferences(doc, cursorPosition)
//   let i = 0
//   console.log('dupes refs');
//   const locations: LSP.Location[] = []
//   analyzer.uris.forEach(uri => {
//     const doc = analyzer.cached.get(uri)!;
//     const localRefs = flattenNested(...doc.symbols)
//     .filter(s => s.name === defS.name)
//     .filter(s => s.scopeSmallerThan(defS) && s.scope.scopeTag !== defS.scope.scopeTag)
//
//     for (const node of doc.nodes) {
//       if (!node.isNamed || node.type !== 'word') {
//         continue
//       }
//       if (localRefs.some(s => s.scope.containsNode(node))) {
//         continue;
//       }
//       if (node.text === defS?.name) {
//         locations.push(LSP.Location.create(uri, getRange(node)))
//       }
//     }
//   })
//   locations.forEach(s => {
//     console.log(s.uri, s.range);
//   })
// })

class UniqueLocations {
  private map = new Map<string, LSP.Location>();
  private arr: LSP.Location[] = [];

  private key(loc: LSP.Location): string {
    const { uri, range } = loc;
    const { start, end } = range;
    return `${uri}:${start.line}:${start.character}-${end.line}:${end.character}`;
  }

  add(loc: LSP.Location): void {
    const key = this.key(loc);
    if (!this.map.has(key)) {
      this.map.set(key, loc);
      this.arr.push(loc);
    }
  }

  get locations(): LSP.Location[] {
    return this.arr;
  }
}