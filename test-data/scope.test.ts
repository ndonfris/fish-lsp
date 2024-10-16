import * as Parser from 'web-tree-sitter';
import { setLogger } from './helpers';
import { TestWorkspace } from './workspace-utils';
import { flattenNested } from '../src/utils/flatten';
import { initializeParser } from '../src/parser';
import { LspDocument } from '../src/document';
import { Analyzer } from '../src/future-analyze';
import { FishDocumentSymbol, getFishDocumentSymbols, getFishDocumentSymbolsIterative } from '../src/utils/new-symbol';
import { symbolKindToString } from '../src/utils/translation';
import { Range, SymbolKind } from 'vscode-languageserver';
import { getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Scope, ScopeTag } from '../src/utils/new-scope';
import { isVariableDefinitionCommand } from '../src/utils/node-types';

function findSymbolInSymbolsAndLogReferences(symbols: FishDocumentSymbol[], name: string) {
  const symbol = flattenNested(...symbols).find(s => s.name === name);
  console.log({ symbol: symbol?.toString(), excludedNodes: symbol!.scope!.excludedNodes.map(n => n.text).join('\n') });
  if (!symbol) return;
  console.log('-'.repeat(80));
  console.log('References: ', name);
  console.log('-'.repeat(80));
  if (name.startsWith('_flag_')) {
    const flagType = name.slice(6).length === 1 ? 'short' : 'long';
    const flagText = symbol.currentNode.text.split('/');
    const flagRange = getRange(symbol.currentNode);

    switch (flagType) {
      case 'short':
        console.log('Short Flag:', flagText[0], '====', `${flagRange.start.line}:${flagRange.start.character}`, '====', `${flagRange.end.line}:${flagRange.start.character + 1}`);
        break;
      case 'long':
        // `argparse help -- $argv` -> help flag doesn't have a short flag
        if (flagText.length === 1) {
          console.log('Long Flag:', flagText[0], '====', `${flagRange.start.line}:${flagRange.start.character}`, '====', `${flagRange.end.line}:${flagRange.end.character}`);
          break;
        }
        // `argparse h/help -- $argv` -> help flag has a short flag
        console.log('Long Flag:', flagText[1], '====', `${flagRange.start.line}:${flagRange.start.character + 2}`, '====', `${flagRange.end.line}:${flagRange.end.character}`);
        break;
    }
  }
  symbol.scope.getNodes()
    .filter(n => n.text === name)
    .forEach(node => {
      console.log(node.text, '====', node.type, '====', `${node.startPosition.row}:${node.startPosition.column}`, '====', node.parent?.type);
    });
  console.log('-'.repeat(80));
  return symbol;
}

setLogger();

describe('analyzer test suite', () => {
  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function setupSymbols(documents: LspDocument[], findUri: string = '') {
    for (const doc of documents) {
      if (doc.uri.endsWith(findUri)) {
        const tree = parser.parse(doc.getText()) as Parser.Tree;
        const symbols = getFishDocumentSymbols(doc.uri, tree.rootNode, tree.rootNode);
        return { uri: doc.uri, symbols, flatSymbols: flattenNested(...symbols), tree, doc };
      }
    }
    return { uri: '', symbols: [], flatSymbols: [], tree: null, doc: null };
  }

  function setupAndFind(documents: LspDocument[], findUri: string = '') {
    documents.forEach(doc => {
      analyzer.analyze(doc);
    });
    const document = documents.find(doc => doc.uri.endsWith(findUri)) || null;
    return { documents, document };
  }

  const toStringSymbolRange = (range: Range) => {
    return Array.from([
      Object.values(range.start).join(','), '|', Object.values(range.end).join(','),
    ]).join('').toString();
  };

  const logNode = (node?: Parser.SyntaxNode) => {
    if (!node) return '';
    return node.text.split('\n').map((line) => line.trim()).join(';');
  };

  const symbolArrayLogger = (symbols: FishDocumentSymbol[]) => {
    for (const [index, symbol] of symbols.enumerate()) {
      console.log([
        {
          index,
          name: symbol.name,
          kind: symbolKindToString(symbol.kind),
          uri: symbol.uri,
          range: toStringSymbolRange(symbol.range),
          selectionRange: toStringSymbolRange(symbol.selectionRange),
        },
        { symbol: symbol.scope.toObject() },
        {
          node: symbol.currentNode.toString().slice(0, 80),
          text: logNode(symbol.scope.currentNode),
          type: symbol.scope.currentNode.type,

        },
        {
          node: symbol.scope.parentNode.toString().slice(0, 80),
          text: logNode(symbol.scope.parentNode),
          type: symbol.scope.parentNode.type,
        },
      ], `\n${'-'.repeat(80)}`);
    }
  };

  describe('unit tests', () => {
    describe('Scope class', () => {
      it.only('Scope.fromSymbol', () => {
        const { uri, symbols, flatSymbols, tree, doc } = setupSymbols(TestWorkspace.completeConfig.documents, 'config.fish');

        if (!uri || !symbols || !flatSymbols || !tree || !doc) fail();

        // console.log([
        //   'test_1:::rootNode',
        //   tree.rootNode.text,
        //   '-'.repeat(80),
        // ].join('\n'));
        // console.log('');
        // console.log('');
        // console.log('-'.repeat(80));
        // console.log('');
        // console.log('');

        /**
         * TODO:
         *   - [x] fix `set -q _` variable case creating definition
         *   - [x] fix itaration for retrieving all children Symbols or Nodes
         */
        // for (const symbol of symbols) {
        //   let symbolStr = ['______', symbol.kindToString(), symbol.name].join(' ').padEnd(55, ' ');
        //
        //   console.log(symbolStr, '---', symbol.scope.tag.padEnd(10), '---', symbol.parent.name, symbol.parent.kindToString());
        //   symbol.allChildren().forEach((child: FishDocumentSymbol) => {
        //     let padding = '     |';
        //     let cscope: FishDocumentSymbol = child.parent;
        //     while (cscope && cscope?.parent.kind !== SymbolKind.Null) {
        //       cscope = cscope.parent;
        //       padding += '     |';
        //     }
        //     symbolStr = [padding, child.kindToString(), child.name].join(' ').padEnd(55, ' ');
        //     console.log(symbolStr, '---', child.scope.tag.padEnd(10), '---', child.parent.name, child.parent.kindToString());
        //   });
        // }
        // const rootSym = symbols
        //   .find(s => s.parent.kind === SymbolKind.Null).parent;
        //
        // console.log(rootSym.toString());

        // console.log('\n\nfish_user_key_bindings');
        // const fishKeyBindings = symbols.find(s => s.name === 'fish_user_key_bindings')!;
        // const fishKeyBindingsPos = fishKeyBindings.selectionRange.start;
        // flatSymbols.forEach((s) => {
        //   if (s.isBeforePosition(fishKeyBindingsPos)) {
        //     console.log(s.name, '=====', s.kindToString());
        //   }
        // });
        // fishKeyBindings?.scope.getNodes().forEach(node => {
        //   if (node.isNamed) {
        //     console.log(node.type.trim(), '::::::', node.text.trim().split('\n').at(0).trim());
        //   }
        // });

        // findSymbolInSymbolsAndLogReferences(symbols, '_flag_help');

        // console.log('\n\nshow_help_msg');
        // findSymbolInSymbolsAndLogReferences(symbols, 'show_help_msg');

        // flattenNested(...symbols).find(s => s.name === 'set_theme_variables')!.scope.callableNodes().forEach(node => {
        //   if (node.type.trim() && node.text.trim() && !['(', "'", '"', '$'].includes(node.type) && node.type !== 'word') {
        //     console.log('set_theme_variables callable:', node.type, node.text);
        //   }
        // });

        const fukb = flatSymbols.find(s => s.name === 'fish_user_key_bindings')!;
        const foo = fukb.allChildren().find(s => s.name === 'FOO')! as FishDocumentSymbol;
        console.log('FOO:', foo.toString());
        // console.log(foo.getNodesInScope().map(n => n.text).join('\n'));
        expect(foo.getLocalReferences().length).toEqual(2);
        const fooRef = flattenNested(...symbols).find(s => s.name === 'FOO' && s.scope.isGlobal)!;
        console.log('GLOBAL FOO:', fooRef.toString());

        // show reference ktable
        const t: { name: string; kind: string; refs: string; scope: ScopeTag; }[] = [];
        fukb?.parent.allChildren().forEach((child) => {
          t.push({
            name: child.name,
            kind: child.kindToString(),
            refs: child.getLocalReferences().length.toString(),
            scope: child.scope.tag,
          });
        });
        console.table(t, ['name', 'kind', 'refs', 'scope']);

        expect(doc).toBeDefined();
      });

      // describe('integration tests', () => {
      //   // describe('document symbols', () => {
      //   //   it('all document symbols', () => {
      //   //   })
      //   //
      //   //   it('document symbols in scope', () => {
      //   //   })
      //   // })
      //   //
      //   // describe('workspace symbols', () => {
      //   //   it('all workspace symbols', () => {
      //   //   })
      //   //
      //   //   it('workspace symbols in scope', () => {
      //   //   })
      //   // });
      // })

      // describe('e2e tests', () => {
      // })
    });

    describe('smoke tests', () => {
      describe('analyzer', () => {
        it('analyzer is defined', () => {
          expect(analyzer).toBeDefined();
        });

        describe('TestWorkspace.functionsOnly', () => {
          it('size === 4', () => {
            TestWorkspace.functionsOnly.documents.forEach(doc => {
              analyzer.analyze(doc);
            });
            expect(analyzer.cached.size).toBe(4);
          });
        });
      });
    });
  });
});