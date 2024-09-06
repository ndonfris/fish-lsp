
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { createFakeCursorLspDocument, createFakeLspDocument, setLogger } from './helpers';
import { Simple } from './simple';
import {
  FishDocumentSymbol,
  flattenNested,
  getFishDocumentSymbolItems,
} from '../src/utils/symbol';
import { execEscapedSync } from '../src/utils/exec';
import * as TreeSitterUtils from '../src/utils/tree-sitter';
import { initializeParser } from '../src/parser';
import { isCommandName, isEndStdinCharacter, isFunctionDefinition, isOption, isProgram, isString } from '../src/utils/node-types';
import { LspDocument } from '../src/document';
import { findFirstParent, getChildNodes, getNodeAtPosition, getRange } from '../src/utils/tree-sitter';

import { Analyzer } from '../src/future-analyze';
import { TestWorkspace } from './workspace-utils';
import { SymbolKind } from 'vscode-languageserver';
import { symbolKindToString } from '../src/utils/translation';
import { DefinitionScope } from '../src/utils/definition-scope';



describe.skip('analyzer test suite', () => {

  setLogger();

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
    const nodes = getChildNodes(rootNode);
    let cursorNode = getNodeAtPosition(tree, cursorPosition)!;
    let fixedCursorPos = cursorPosition;
    if (cursorNode.text.startsWith('$')) {
      fixedCursorPos = { line: cursorPosition.line, character: cursorPosition.character + 1 };
      cursorNode = getNodeAtPosition(tree, fixedCursorPos)!;
    }
    // console.log({ flatSymbolsNames: flatSymbols.map(s => s.name) });
    analyzer.analyze(document);
    return {
      symbols,
      flatSymbols,
      tree: tree,
      rootNode,
      nodes,
      doc: document,
      cursorPosition: fixedCursorPos,
      cursorNode,
      input,
    };
  }


  function setupAndFind(documents: LspDocument[], findUri: string = '') {
    documents.forEach(doc => {
      analyzer.analyze(doc);
    });
    const document = documents.find(doc => doc.uri.endsWith(findUri)) || null;
    return { documents, document };
  }


  // @TODO
  // function setupAndFindWithCursor(documents: LspDocument[], findUri: string = '') {
  // }

  // describe(`filterDocumentSymbolInScope()`, () => {
  //   it('local NESTED workspace def `test`', () => {
  //     const _setup = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
  //     if (!_setup.document) fail();
  //     const _cached = analyzer.cached.get(_setup.document.uri!);
  //     // const { root: rootNode, document: doc } = _cached!;
  //     if (!_cached) fail();
  //     const { document, root, symbols } = _cached;
  //     const focus = TreeSitterUtils.getChildNodes(root).find(node => isCommandName(node) && node.text === 'test')!;
  //     const pos = getRange(focus).start;
  //
  //     // const currentNode = getNodeAtPosition(tree, pos)!;
  //     const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
  //       symbols.nested(),
  //       pos
  //     );
  //
  //     // console.log(localSymbols.map(s => s.name));
  //     const defSymbol = analyzer.getDefinitionSymbol(document, pos);
  //     expect(defSymbol?.map(s => s.uri)).toEqual([
  //       `${document.uri}`
  //     ]);
  //   });
  //
  //   it('local PRIVATE workspace def `test`', () => {
  //     const _setup = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
  //     if (!_setup.document) fail();
  //     const _cached = analyzer.cached.get(_setup.document.uri!);
  //     if (!_cached) fail();
  //     const { document, root, symbols } = _cached;
  //
  //     const focus = TreeSitterUtils.getChildNodes(root).find(node => isCommandName(node) && node.text === 'test')!;
  //     const pos = getRange(focus).start;
  //
  //     // const currentNode = getNodeAtPosition(tree, pos)!;
  //     const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
  //       symbols.nested(),
  //       pos
  //     );
  //
  //     // console.log(localSymbols.map(s => s.name));
  //     const defSymbol = analyzer.getDefinitionSymbol(document, pos);
  //     // console.log(defSymbol.map(s => s.uri));
  //     expect(defSymbol?.map(s => s.uri)).toEqual([ document.uri ]);
  //     const symbolUri = defSymbol.map(s => s.uri).pop()!;
  //     expect(symbolUri.endsWith('private.fish')).toBeTruthy();
  //   });
  // })

  // @TODO: implement tests
  describe('getDefinitionSymbols()', () => {
    function logDefSymbols(defSymbol: FishDocumentSymbol[]) {
      defSymbol.forEach(({ name, uri, scope: _scope, kind: _kind }, idx) => {
        const scope = _scope.scopeTag;
        const kind = symbolKindToString(_kind);
        console.log({ idx, name, uri, scope, kind });
      });
    }

    it('global function', () => {
      testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '   echo "foo test"',
        'end',
      ].join('\n'));
      const { doc, cursorPosition } = testSymbolFiltering('config.fish', [
        'foo█'
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => s.name)).toEqual([
        'foo'
      ]);

    });
    //
    it('local function', () => {
      const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '   echo "foo test"',
        'end',
        'foo█'
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => s.name)).toEqual([
        'foo'
      ]);

    });

    it('private function', () => {
      const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
        'function foo',
        '    __bar█',
        'end',
        '',
        'function __bar',
        '    echo "test"',
        'end',
        ''
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(
        defSymbol.map(({ name, selectionRange, uri, kind }) => ({
          name,
          selectionRange,
          uri: uri.split('/').slice(-2).join('/'),
          kind: symbolKindToString(kind),
        }))
      ).toEqual([
        {
          name: '__bar',
          selectionRange: {
            start: { line: 4, character: 9 },
            end: { line: 4, character: 14 }
          },
          uri: 'functions/foo.fish',
          kind: 'function'
        }
      ]);
    });

    it('global var', () => {
      testSymbolFiltering('config.fish', [
        'set -gx test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/testvar.fish', [
        'function testvar',
        '    echo $test█ ',
        'end',
      ].join('\n'));
      const defSymbol = analyzer.getDefinitionSymbol(doc, { line: 1, character: 10 });
      // logDefSymbols(defSymbol);
      expect(defSymbol.length).toEqual(1);
      expect(
        defSymbol.map(symbol => Simple.symbol(symbol))
      ).toEqual([
        {
          name: 'test',
          uri: 'config.fish',
          kind: 'variable',
          scope: 'global'
        }
      ]);
    });
    //
    it('local var', () => {
      testSymbolFiltering('config.fish', [
        'set -g test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/testvar.fish', [
        'function testvar',
        '    set test 1',
        '    echo $test█',
        'end'
      ].join('\n'));

      expect(cursorPosition).toEqual({ line: 2, character: 10 });

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.length).toEqual(1);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual([
        'functions/testvar.fish'
      ]);
    });

    it('private var', () => {
      testSymbolFiltering('config.fish', [
        'set -g test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('conf.d/testvar.fish', [
        'function testvar -a __test',
        '    echo $__test█',
        'end'
      ].join('\n'));

      const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual([ 'conf.d/testvar.fish' ]);

    });
    //
    it('nested var', () => {

      testSymbolFiltering('config.fish', [
        'set -gx _test 1',
      ].join('\n'));

      const { doc, cursorPosition } = testSymbolFiltering('functions/nested.fish', [
        'function nested',
        '    function test-nest',
        '        echo "$_test█"',
        '    end',
        'end'
      ].join('\n'));

      // console.log({cursorPosition})
      // console.log({cursorPosition, uris: analyzer.uris, ws: analyzer.workspaceSymbols.get('_test').map(s => s.debugString())});
      // for (const [uri, entry] of analyzer.cachedEntries) {
      //   console.log(uri);
      //   console.log(entry.nodes.map(n => ({'start': n.startPosition, text: n.text, type: n.type})));
      // }
      const defSymbol = analyzer.getDefinitionSymbol(doc, { line: 2, character: 15 });
      // logDefSymbols(defSymbol);
      expect(defSymbol.map(s => Simple.relPath(s.uri))).toEqual([ 'config.fish' ]);
    });

    describe.skip('fallback', () => {

      it('fallback: exec script', () => {
        const out = execEscapedSync("type -p alias");
        if (out.startsWith('/') && out.endsWith('.fish')) {
          analyzer.analyzeFilepath(out);
        }
        expect(analyzer.uris).toContain(`file://${out}`);
        expect(analyzer.uris.length).toBeGreaterThan(0);
      });

      it('fallback: global', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'alias█'

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(analyzer.uris.length).toBeGreaterThan(1);
        expect(
          defSymbol.map(s => ({
            name: s.name,
            kind: s.kind,
            scope: s.scope.scopeTag
          }))
        ).toEqual([
          {
            name: 'alias',
            kind: SymbolKind.Function,
            scope: 'global'
          }
        ]);
      });

      it('fallback: Does Not Exist', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'abbr█'

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('fallback: invalid/builtin', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'string█'

        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('fallback: command', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'fzf█'
        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(0);
        expect(analyzer.uris.length).toEqual(1);
      });

      it('analyzer.getDefinitionSymbol() use fallback', () => {
        const { doc, cursorPosition } = testSymbolFiltering('functions/foo.fish', [
          'function foo',
          '   echo "foo test"',
          'end',
          'fisher█'
        ].join('\n'));
        const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // logDefSymbols(defSymbol);
        expect(defSymbol.length).toEqual(1);
        expect(analyzer.uris.length).toBeGreaterThan(1);
      });

    });

    describe.only('special cases', () => {
      test('$argv: script & function', () => {
        const { flatSymbols, doc, rootNode } = testSymbolFiltering('farg-f.fish', [
          'function arg-f',
          '    echo $argv█',
          'end',
          ''
        ].join('\n'));

        expect(flatSymbols.length).toEqual(3);
        expect(flatSymbols.map(s => s.name)).toEqual([
          'argv',
          'arg-f',
          'argv'
        ])
        const item = analyzer.cached.get(doc.uri);
        if (!item) fail();
        
        expect(item.symbols.flat().map(s => s.name)).toEqual([
          'argv',
          'arg-f',
          'argv'
        ]);

        // const result: FishDocumentSymbol[] = []
        // if (!doc.isAutoLoaded()) {
        //   flatSymbols.unshift(FishDocumentSymbol.create({
        //     name: 'argv',
        //     kind: SymbolKind.Variable,
        //     uri: doc.uri,
        //     range: getRange(rootNode),
        //     selectionRange: { start: {line: 0, character: 0}, end: {line: 0, character: 0} },
        //     scope: DefinitionScope.create(
        //       rootNode,
        //       'local'
        //     ),
        //     node: rootNode,
        //     parent: null,
        //     children: []
        //   }))
        // }

        // flatSymbols.forEach(symbol => {
        //   if (symbol.kind === SymbolKind.Function) {
        //     result.push(FishDocumentSymbol.create({
        //       ...symbol,
        //       name: 'argv',
        //       kind: SymbolKind.Variable,
        //       scope: DefinitionScope.create(
        //         symbol.node,
        //         'function'
        //       )
        //     }));
        //   }
        // })
        // flatSymbols.forEach(symbol => {
        //   console.log('function', Simple.symbol(symbol));
        // })
        // const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
        // expect(defSymbol.length).toEqual(1);
        // expect(Simple.symbol(defSymbol[ 0 ])).toMatchObject({
        //   name: 'argv',
        //   uri: 'functions/arg-f.fish',
        //   kind: 'variable',
        //   scope: 'local',
        //   range: [ 0, 0, 2, 3 ]
        // });
      });

      // test('$argv: script', () => {
      //
      //   const { tree, doc, cursorPosition, cursorNode } = testSymbolFiltering('scripts/arg-s.fish', [
      //     '#!/usr/bin/env fish',
      //     'echo $argv█',
      //     'printf',
      //     'for i in (seq 1 10)',
      //     '    echo $i',
      //     'end'
      //   ].join('\n'))
      //
      //   TreeSitterUtils.getChildNodes(tree.rootNode)
      //     .filter(isCommandName)
      //     .forEach(node => {
      //       console.log('command', Simple.nodeVerbose(node));
      //       c
      //       console.log('firstChild', node.parent.firstChild.text);
      //       console.log('lastChild', node.parent.lastChild.text);
      //     })
      //   // console.log(Simple.node(rootNode));
      //   // console.log(Simple.node(cursorNode));
      //   // if (isNodeWithParent(cursorNode)) {
      //     // console.log('with parent: ', Simple.nodeVerbose(cursorNode.parent));
      //   }
      //   const defSymbol = analyzer.getDefinitionSymbol(doc, cursorPosition);
      //   // console.log(defSymbol.map(s => Simple.symbol(s)));
      // })
      // it('$argv: script', () => {
      //   
      // })
      // it('$status', () => {
      //
      // })
      // it('$pipestatus', () => {
      //
      // })
      it(`\`argparse 'h/help' -- $argv; or return\``, () => {
        const { flatSymbols, doc } = testSymbolFiltering('functions/argparse-test.fish', [
          'function argparse-test',
          `    argparse --name=argparse-test h/help 'n/name=' 'p/path=!test -d "$_flag_value"' s long -- $argv`,
          `    or return█`,
          'end',
        ].join('\n'));

        expect(flatSymbols.length).toEqual(10);
        expect(flatSymbols.map(s => s.name)).toEqual([
          'argparse-test',
          'argv',
          '_flag_h',
          '_flag_help',
          '_flag_n',
          '_flag_name',
          '_flag_p',
          '_flag_path',
          '_flag_s',
          '_flag_long',
        ])

        const item = analyzer.cached.get(doc.uri);
        if (!item) fail();
        
        expect(item.symbols.flat().map(s => s.name)).toEqual(flatSymbols.map(s => s.name));

        // flatSymbols.forEach((s, i) => {
        //   console.log(i, Simple.symbol(s));
        // })
        // store the results
        // const result: FishDocumentSymbol[] = [];
        //
        // // commandName is `argparse`
        // const cmd = nodes
        //   .find(node => isCommandName(node) && node.text === 'argparse')
        //   .parent;
        //
        // // find the `--` end token
        // const endChar = cmd?.children.find(node => isEndStdinCharacter(node));
        // if (!endChar) fail();
        //
        // // split the `h/help` into `h` and `help`
        // function splitSlash(str: string): string[] {
        //   const results = str.replace(/-/g, '_').split('/').filter(s => !!s.trim());
        //   const maxResults = results.length < 2 ? results.length : 2;
        //   return results.slice(0, maxResults);
        // }
        //
        // // find the parent function or program
        // const argParseScope = findFirstParent(
        //   cmd,
        //   (node) => isFunctionDefinition(node) || isProgram(node)
        // );
        //
        // // find all flags before the `--` end token
        // const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;
        //
        // cmd.children
        //   .filter(node => !isOption(node) && !isCommandName(node) && isBefore(node, endChar))
        //   .forEach(node => {
        //     let flagNames = node.text;
        //     if (isString(node)) {
        //       flagNames = node.text.slice(1, -1).split('=').shift();
        //     }
        //     const seenFlags = splitSlash(flagNames);
        //     // add all seenFlags to the `result: FishDocumentSymbol[]` array
        //     seenFlags.map(flagName => {
        //       result.push(FishDocumentSymbol.create({
        //         name: `_flag_${flagName}`,
        //         kind: SymbolKind.Variable,
        //         uri: doc.uri,
        //         range: getRange(cmd),
        //         selectionRange: getRange(node),
        //         scope: DefinitionScope.create(argParseScope, "local"),
        //         node: node,
        //         parent: cmd,
        //         children: [],
        //       }));
        //     });
        //   });

        // log results
        // result.forEach((s, idx) => {
        //   const matches = result
        //     .filter(o => o.equivalentFlags(s))
        //     .map(o => Simple.symbol(o))
        //   console.log({idx, length: matches.length, matches: matches})
        // });
      });
    });
  });

  // @TODO
  describe('getReferences()', () => {
    it('reference symbols', () => {
      // const { docPrivate } = buildWorkspaceOne();
      const thisTest = createFakeLspDocument('functions/this_test.fish', [
        'function this_test',
        '   function test',
        '       echo "test"',
        '   end',
        '   test', // should be local test
        'end',
        'test' // should be global test
      ].join('\n'));

      const { symbols } = analyzer.analyze(thisTest);
      // console.log(flattenNested(...symbols).map(n => n.name + ' ' + n.scope.scopeTag + '::' + n.scope.scopeNode!.text.split(' ').slice(0, 2).join(' ') + '...'));


      // const { tree, doc, rootNode, flatSymbols, symbols } = docPrivate;
      // const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isFunctionDefinitionName(node) && node.text === 'test')!;
      // const pos = getRange(focus).start;
      // const defSymbol = analyzer.getDefinitionSymbol(doc, pos)
      // 
      //
      //
      // /* is defSymbol `local` or `global` scope*/
      // /** if `global` get all references of a symbol in workspace */
      // const location = analyzer.getValidNodes(doc, defSymbol[0]!)
      // for (const l of location) {
      //   const n = getNodeAtPosition(tree, l.range.start);
      //   console.log(n?.text);
      // }


      // switch (defSymbol[0].scope.scopeTag) {
      //   case 'universal':
      //   case 'global':
      //     /* handle global symbols */
      //     break;
      //   case 'local':
      //   default:
      //     /* handle local symbols */
      //     break;
      // }


      // if (symbol) {
      // const doc = analyzer.getDocument(symbol.uri)!;
      //   /** refactor inside analyzer */
      //   const { scopeTag } = symbol.scope;
      //       switch (scopeTag) {
      //         case 'global':
      //         case 'universal':
      //           return findGlobalLocations(analyzer, doc, symbol.selectionRange.start);
      //         case 'local':
      //         default:
      //           return findLocalLocations(analyzer, document, symbol.selectionRange.start);
      //       }
      // }
      //         position
      //     for (const sym of defSymbol) {
      //       if (sym.scope.scopeTag === 'local') {
      //
      //       }
      //     }


      /* if no local Symbols */
      /** get all references of a symbol in workspace */

      // workspaceSymbols.get(currentNode.text) || [];

      // console.log(defSymbol.map(s => s.name + s.scope.scopeTag));

    });
  });

  // @TODO: implement WorkspaceSymbol
  describe('WorkspaceSymbol', () => {
    it('simple `.hasWorkspaceSymbols`', () => {

      setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/inner.fish');
      const keys = Array.from(analyzer.workspaceSymbols.keys());
      expect(keys).toBeInstanceOf(Array);
      expect(keys).toEqual([
        'test',
        'foo',
        'nested',
        'private'
      ]);
    });

    it('global workspaceSymbols `test` def', () => {
      const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/foo.fish');

      if (!document) fail();
      const _cached = analyzer.cached.get(document.uri);
      const { root: rootNode, document: doc } = _cached!;
      const focus = TreeSitterUtils.getChildNodes(rootNode).find(node => isCommandName(node) && node.text === 'test')!;
      const pos = getRange(focus).start;
      const defSymbol = analyzer.getDefinitionSymbol(doc, pos);
      // console.log(defSymbol?.map(s => s.detail));
      expect(defSymbol?.map(s => s.name)).toEqual([
        'test'
      ]);
    });

    it('query: ""', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = '';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test',
        'foo',
        'nested',
        'private'
      ]);
    });

    it('query: "t"', () => {
      setupAndFind(TestWorkspace.functionsOnly.documents);
      const query = 't';
      const result = analyzer.getWorkspaceSymbols(query);
      expect(result.map(s => s.name)).toEqual([
        'test'
      ]);
    });
  });

  // @TODO: implement completions tests
  describe('completions', () => {
    describe('completions from FishDocumentSymbol', () => {
      // it('completions NESTED "test"', () => {
      //   const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/nested.fish');
      //   if (!document) fail();
      //
      //   /** after `test` commandName inside `nested` */
      //   let pos = { line: 4, character: 7 };
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'nested',
      //     'test',
      //   ]);
      //
      //   /** after final `end` outside of `nested` */
      //   pos = { line: 5, character: 4 };
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'nested'
      //   ]);
      // });

      // it('completions PRIVATE "test"', () => {
      //   const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'functions/private.fish');
      //   if (!document) fail();
      //
      //   // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      //   // console.log(pos);
      //
      //   // /** after `test` commandName inside `nested` */
      //   //   let pos = {line: 1, character: 8};
      //   //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //   //     'private',
      //   //   ])
      //   //
      //   //   /** after final `end` outside of `nested` */
      //   //   pos = { line: 5, character: 4 };
      //   //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //   //     'private',
      //   //     'test'
      //   //   ]);
      //   // });
      // });

      /**
       * WRONG!!!
       */
      // it('completions VARIABLES "test"', () => {
      //
      //   setupAndFind(TestWorkspace.functionsOnly.documents);
      //
      //   const { document } = analyzer.analyze(createFakeLspDocument('functions/var.fish', [
      //     'function var',
      //     '   set -l test 1',
      //     '   ',
      //     'end',
      //     '',
      //     ''
      //   ].join('\n')));
      //
      //   if (!document) fail();
      //
      //   // let pos = getRange(analyzer.cached.get(document.uri)?.nodes.find(s => isCommandName(s) && s.text === 'test')!)!.end;
      //   // console.log(pos);
      //
      //   // /** after `test` commandName inside `nested` */
      //   let pos = { line: 2, character: 3 };
      //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'var',
      //     'test',
      //   ])
      //
      //   /** after final `end` outside of `nested` */
      //   pos = { line: 4, character: 0 };
      //   // console.log(analyzer.getCompletionSymbols(document, pos).map(s => s.name));
      //   expect(analyzer.getCompletionSymbols(document, pos).map(s => s.name)).toEqual([
      //     'var',
      //   ]);
      // });
    });

    //
    // @TODO: implement tests
    // describe('completion for index', () => {
    //
    //    it('command completion `t`',  () => {
    //
    //    })
    //
    //    it('variable completion `test $t`',  () => {
    //
    //    })
    //
    //    it('variable completion `$`',  () => {
    //
    //    })
    //
    //    it('command multiline: `cmd \\\n--flag`', () => {
    //
    //    })
    //
    //    it('argument index/distance from command', () => {
    //
    //    })
    //
    //    it('command matches string', () => {
    //
    //    })
    //
    //    it('command w/ flag', () => {
    //
    //    })
    // })
    //
    // @TODO: implement tests
    // describe('special coses', () => {
    //   it('`$argv`', () => {
    //
    //   })
    //   it('`$status`', () => {
    //
    //   })
    //   it('`$pipestatus`', () => {
    //
    //   })
    //   it('`argparse` inside function', () => {
    //
    //   })
    //   it('`argparse` autoloaded completion from uri', () => {
    //
    //   })
    //   it('`complete -c ${_}` autoloaded uri name', () => {
    //
    //   })
    //   it('sort locality', () => {
    //
    //   })
    // })
    //
  });

  // @TODO
  // describe('getHover()', () => {
  //   it('builtin echo', () =. {
  //
  //   })
  //   it('command ls', () =. {
  //
  //   })
  //   it('pipe |', () =. {
  //
  //   })
  //   it('redirect &>', () =. {
  //
  //   })
  //   it('return 1', () =. {
  //
  //   })
  //
  //   it('variable $argv', () => {
  //
  //   })
  //   it('variable $status', () => {
  //
  //   })
  //   it('variable $pipestatus', () => {
  //
  //   })
  //
  //   it('cmd --flag', () => {
  //
  //   })
  //
  //   it('cmd -f', () => {
  //
  //   })
  //
  //   it('cmd subcmd', () => {
  //
  //   })
  //   
  //   it(`if cmd1; and`, () => {
  //
  //   })
  //
  //   if(`for i in (seq 1 10); echo $i`, () => {
  //
  //   })
  //
  //   if(`for i in (seq 1 10); echo $i; end`, () => {
  //
  //   })
  //   
  //   it('special function: `fish_greeting`', () => {
  //
  //   })
  //   
  //   it(`special string: \`status\` doesn't overwrite $status`, () => {
  //
  //   })
  //   
  //   it(`special sequence: \`cmd \\\n --flag\``, () => {
  //
  //   })
  //
  //   it(`special sequence: (regexString) \`string match -r '\w\``, () => {
  //
  //   })
  //
  //   it(`special sequence: (escape) \`printf %\``, () => {
  //
  //   })
  //
  //   it(`special sequence: \`#comment\``, () => {
  //     // skip comments
  //   })
  //
  //   describe('fish-lsp env variables', () => {
  //       it('$fish_lsp_logsfile', () => {
  //
  //       })
  //
  //       it('$fish_lsp_all_indexed_paths', () => {
  //
  //       })
  //       it('$fish_lsp_show_client_popups', () => {
  //
  //       })
  //       
  //       it('$fish_lsp_diagnostic_disable_error_codes', () => {
  //
  //       })
  //       it('$fish_lsp_diagnostic_disable_error_codes 2001', () => {
  //
  //       })
  //   })
  // })

  // @TODO
  // describe('getSignatureHelp()', () => {
  // })

  // @TODO
  // describe('public properties', () => {
  //     it('cached', () => {
  //     
  //     })
  //     it('cachedEntries', () => {
  //     
  //     })
  //     it('workspaceSymbols', () => {
  //
  //     })
  //     it('documents', () => {
  //
  //     })
  //     it('uris', () => {
  //
  //     })
  //     it('symbols', () => {
  //
  //     })
  //     it('sourcedFiles', () => {
  //
  //     })
  //     
  // })

  // @TODO
  // describe('analyzeFilepath(filepath: string)', () => {
  //
  //     it('analyzeFilepath: normal', () => {
  //
  //     })
  //     it('analyzeFilepath: `config.fish` function', () => {
  //
  //     })
  //     it('analyzeFilepath: `config.fish` variable', () => {
  //
  //     })
  //     it('analyzeFilepath: invalid', () => {
  //
  //     })
  //     it('analyzeFilepath: empty', () => {
  //
  //     })
  //     it('analyzeFilepath: non-existent', () => {
  //
  //     })
  //
  //     it('analyzeFilepath + findDefinition()', () => {
  //
  //     })
  // })

  // @TODO
  // describe('initializeBackgroundAnalysis()', () => {
  //     it('small', () => {
  //
  //     })
  //     it('medium', () => {
  //
  //     })
  //     it('large', () => {
  //
  //     })
  // })

  // @TODO
  // describe(`config change`, () => {
  //    it('source: `fish_lsp_diagnostic_disable_error_codes`', () => {
  //
  //    })
  //
  //    it('source: `fish_lsp_show_client_popups`', () => {
  //
  //    })
  //    
  //    it('client: fish-lsp.diagnostic.disableErrorCodes', () => {
  //
  //    })
  //    
  //    it('client: fish-lsp.showClientPopups', () => {
  //
  //    })
  // })

  // @TODO
  // describe('rename/textEdit', () => {
  // })
  //
  // @TODO
  // describe('FishDocumentSymbol[]', () => {
  //    it('document: `functions/inner.fish`', () => {
  //
  //    })
  //    it('document: `functions/nested.fish`', () => {
  //
  //    })
  //    it('document: `functions/private.fish`', () => {
  //
  //    })
  //    it('onFoldingRange()', () => {
  //
  //    })
  //
  //    it('onDocumentSymbol()', () => {
  //
  //    })
  // })

  // @TODO 
  // describe('inlayHint', () => {
  //
  // })

});