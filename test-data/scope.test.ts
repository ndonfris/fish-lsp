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
import { getRange } from '../src/utils/tree-sitter';
import { Scope } from '../src/utils/new-scope';

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

        console.log([
          'test_1:::rootNode',
          tree.rootNode.text,
          '-'.repeat(80),
        ].join('\n'));
        console.log('');
        console.log('');
        console.log('-'.repeat(80));
        console.log('');
        console.log('');

        // symbolArrayLogger(flatSymbols);

        // const outer_function = flatSymbols.find(s => s.name === 'FOO') as FishDocumentSymbol;
        // const inner_function = flatSymbols.find(s => s.name === '') as FishDocumentSymbol;

        // const oScope = outer_function.scope;
        // const iScope = inner_function.scope;

        /**
         * TODO:
         *   - [ ] fix `set -q _` variable case creating definition
         */
        for (const symbol of symbols) {
          let symbolStr = ['______', symbol.kindToString(), symbol.name].join(' ').padEnd(55, ' ');

          console.log(symbolStr, '---', symbol.scope.tag.padEnd(10), '---', symbol.parent.name, symbol.parent.kindToString());
          symbol.getAllChildren().forEach((child: FishDocumentSymbol) => {
            let padding = '     |';
            let cscope: FishDocumentSymbol = child.parent;
            while (cscope && cscope?.parent.kind !== SymbolKind.Null) {
              cscope = cscope.parent;
              padding += '     |';
            }
            symbolStr = [padding, child.kindToString(), child.name].join(' ').padEnd(55, ' ');
            console.log(symbolStr, '---', child.scope.tag.padEnd(10), '---', child.parent.name, child.parent.kindToString());
          });
        }

        // console.log(oScope.toString());
        // console.log(outer_function.toString());

        // for (const symbol of flatSymbols) {
        //   console.log(symbol.scope.toString());
        // }

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
