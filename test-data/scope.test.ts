import Parser from 'web-tree-sitter';
import { setLogger } from './helpers';
import { TestWorkspace } from './workspace-utils';
import {
  flattenNested,
} from '../src/utils/symbol';
import { initializeParser } from '../src/parser';
import { LspDocument } from '../src/document';

import { Analyzer } from '../src/future-analyze';


setLogger();

describe('analyzer test suite', () => {
  let parser: Parser;
  let analyzer: Analyzer;

  beforeEach(async () => {
    parser = await initializeParser();
    analyzer = new Analyzer(parser);
  });

  function setupAndFind(documents: LspDocument[], findUri: string = '') {
    documents.forEach(doc => {
      analyzer.analyze(doc);
    });
    const document = documents.find(doc => doc.uri.endsWith(findUri)) || null;
    return { documents, document };
  }

  describe('unit tests', () => {

    describe('using scopes', () => {

      describe('TestWorkspace.functionsOnly', () => {
        it('private.fish: local symbols', () => {
          const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'private.fish');
          if (!document) fail();
          const localSymbols = analyzer.getFlatSymbols(document).filter(s => s.scope.scopeTag === 'local');
          expect(localSymbols.length).toBe(1);
        });

        it('nested.fish: nested symbols', () => {
          const { document } = setupAndFind(TestWorkspace.functionsOnly.documents, 'nested.fish');
          if (!document) fail();
          const symbols = analyzer.getFlatSymbols(document);
          // console.log('nested', symbols.map(s => s.name + ' ' + isProgram(s.scope.scopeNode) + ' ' + s.scope.scopeTag));
          // console.log(symbols.map(s => s.name));
          expect(symbols.filter(s => s.scope.scopeTag === 'function').length).toBe(1);
        });

        it('global document scoped SyntaxNode[]', () => {
          const { documents } = setupAndFind(TestWorkspace.functionsOnly.documents);
          for (const doc of documents) {
            const { symbols, nodes } = analyzer.analyze(doc);
            if (!doc.uri.endsWith('private.fish')) continue;
            const flatSymbols = flattenNested(...symbols)
              .filter(s => s.scope.scopeTag !== 'global')

            // const res = filterAndCollectNodes(nodes, flatSymbols);
            // console.log(res.map(n => n.text));



            // const skipped = getGlobalSymbolsInDocument(nodes, symbols);
            // console.log('SKIPPED', skipped.map(n => n.text));
            // console.log('SKIPPED_two', globalNodes.filter(n => n.text === 'private').map(n => n.text));
            // console.log();

            // for (const range of flatSymbols) {
            //
            //   // console.log('NAME', s.name);
            //   // console.log('TEXT', getChildNodes(s.scope.scopeNode).map(n => n.text));
            //   break;
            // }

            // let result: SyntaxNode[] = nodes.filter((node) => {
            //   if (flatSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) {
            //     return false;
            //   }
            //   return true;
            // })

            // const globalNodes = filterNodes(nodes, flatSymbols);
            //
            // console.log({uri: doc.uri, symbols: flatSymbols.map(s => s.name).join(', ')});


            // for (const s of flatSymbols) {
            //   if (s.scope.scopeNode())
            // }  

            // console.log(doc.uri, result.map(n => n.text));

            // const globalNodes = nodes.filter(n => !nodeIsInSymbolScope(n, flatSymbols));
            // for (const node of globalNodes) {
            //   console.log(node.text);
            // }
          }

        });
      });
    });

    // describe('special scopes', () => {
    // })

    // describe('scope analysis', () => {
    // })
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

})