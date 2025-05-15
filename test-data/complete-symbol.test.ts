import { initializeParser } from '../src/parser';
import { createTestWorkspace, setLogger, locationAsString, fakeDocumentTrimUri } from './helpers';
// import { isLongOption, isOption, isShortOption, NodeOptionQueryText } from '../src/utils/node-types';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { Range, SymbolKind } from 'vscode-languageserver';
// import { isFunctionDefinitionName } from '../src/parsing/function';
import { Analyzer } from '../src/analyze';
import { getCompletionSymbol, CompletionSymbol } from '../src/parsing/complete';
import { LspDocument } from '../src/document';
import { getReferences } from '../src/references';

let analyzer: Analyzer;
let parser: Parser;

describe('parsing symbols', () => {
  setLogger();
  beforeEach(async () => {
    setupProcessEnvExecFile();
    parser = await initializeParser();
    await setupProcessEnvExecFile();
  });

  describe('completion --> to argparse', () => {
    let workspace: LspDocument[] = [];
    beforeEach(async () => {
      parser = await initializeParser();
      analyzer = new Analyzer(parser);
      workspace = createTestWorkspace(analyzer,
        {
          path: 'functions/foo.fish',
          text: [
            'function foo',
            '    argparse -i h/help long other-long s \'1\' -- $argv',
            '    or return',
            '    echo hi',
            'end',
          ].join('\n'),
        },
        {
          path: 'completions/foo.fish',
          text: [
            'complete -c foo -f -k',
            'complete -c foo -s h -l help',
            'complete -c foo -k -l long',
            'complete -c foo -k -l other-long -d \'other long\'',
            'complete -c foo -k -s s -d \'short\'',
            'complete -c foo -k -s 1 -d \'1 item\'',
          ].join('\n'),
        },
        {
          path: 'conf.d/bar.fish',
          text: [
            'complete -c bar -f',
            'complete -c bar -s h -l help',
            'complete -c bar -s 1 -l oneline',
            '',
            'function bar',
            '    argparse h/help 1/oneline -- $argv',
            '    or return',
            '    echo inside bar',
            'end',
          ].join('\n'),
        },
        {
          path: 'conf.d/baz.fish',
          text: [
            'function baz',
            '    argparse h/help -- $argv',
            '    or return',
            '    if set -ql _flag_help',
            '         echo \'help message\'',
            '    end',
            '    echo \'inside baz\'',
            'end',
            'complete -c baz -f',
            'complete -c baz -s h -l help',
            'function baz_helper',
            '     foo --help',
            'end',
          ].join('\n'),
        },
      );
    });

    // it('completion >>(((*> function', () => {
    it('completion simple => `complete -c foo -l help` -> `argparse h/help`', () => {
      const expectedOpts = [
        'foo -h',
        'foo --help',
        'foo --long',
        'foo --other-long',
        'foo -s',
        'foo -1',
      ];

      const searchDoc = workspace.find(doc => doc.uri.endsWith('functions/foo.fish'))!;
      const funcName = searchDoc?.getAutoLoadName() as string;
      const results: CompletionSymbol[] = [];

      analyzer.findNodes((n: SyntaxNode, doc: LspDocument) => {
        if (['functions', ''].includes(doc.getAutoloadType())) {
          return false;
        }
        const completeSymbol = getCompletionSymbol(n, doc);
        if (completeSymbol.isNonEmpty() && completeSymbol.hasCommandName(funcName)) {
          results.push(completeSymbol);
          return true;
        }
        return false;
      });

      const uniqueUris = new Set(results.map(res => res.doc?.uri));
      expect(uniqueUris.size === 1).toBeTruthy();
      // results.forEach((res) => {
      //   console.log({
      //     res: res.toUsage(),
      //     uri: res.doc?.uri,
      //   });
      // });
      const usages = results.map(res => res.toUsage());
      expect(usages).toEqual(expectedOpts);

      const helpOpt = results.find(opt => opt.isMatchingRawOption('--help'))!;
      expect(helpOpt.toUsage()).toBe('foo --help');

      const helpOptPosition = helpOpt.getRange().start;
      // const helpOptLocation = Location.create(helpOpt.doc!.uri, helpOpt.getRange())

      const defSymbol = analyzer.getDefinition(helpOpt.doc!, helpOptPosition);
      if (!defSymbol) {
        fail();
      }
      expect({
        name: defSymbol.name,
        uri: defSymbol.uri,
        fishKind: defSymbol.fishKind,
        parentName: defSymbol.parent!.name,
      }).toEqual({
        name: '_flag_help',
        uri: searchDoc.uri,
        fishKind: 'ARGPARSE',
        parentName: 'foo',
      });

      const refLocations = getReferences(analyzer, searchDoc, defSymbol.selectionRange.start);
      // console.log(JSON.stringify({
      //   refLocations: refLocations.map(r => ({
      //     location: locationAsString(r),
      //     text: analyzer.getTextAtLocation(r)
      //   })),
      // }, null, 2));

      const locationUris = refLocations.map(l => {
        const doc = analyzer.getDocument(l.uri)!;
        return fakeDocumentTrimUri(doc);
      });
      expect(locationUris).toEqual([
        'functions/foo.fish',
        'completions/foo.fish',
        'conf.d/baz.fish',
      ]);

      expect(refLocations.map(l => {
        const doc = analyzer.getDocument(l.uri)!;
        return {
          uri: fakeDocumentTrimUri(doc),
          range: l.range,
          text: analyzer.getTextAtLocation(l),
        };
      })).toEqual([
        {
          uri: 'functions/foo.fish',
          range: Range.create(1, 18, 1, 22),
          text: 'help',
        },
        {
          uri: 'completions/foo.fish',
          range: Range.create(1, 24, 1, 28),
          text: 'help',
        },
        {
          uri: 'conf.d/baz.fish',
          range: Range.create(11, 11, 11, 16),
          text: 'help',
        },
      ]);
    });

    it('argparse simple => `argparse h/help -- $argv` -> `complete -c foo -l help`', () => {
      const searchDoc = workspace.find(doc => doc.uri.endsWith('functions/foo.fish'))!;
      // const funcName = searchDoc?.getAutoLoadName() as string;
      const funcSymbol = analyzer.getFlatDocumentSymbols(searchDoc.uri).find((symbol) => {
        if (symbol.name === '_flag_help' && symbol?.parent && symbol.parent.name === 'foo') {
          return true;
        }
        return false;
      });

      const defSymbol = analyzer.getDefinition(searchDoc, funcSymbol!.selectionRange.start);
      if (!defSymbol) {
        fail();
      }
      const refLocations = getReferences(analyzer, searchDoc, defSymbol.selectionRange.start);
      expect(refLocations.map(l => {
        const doc = analyzer.getDocument(l.uri)!;
        return {
          uri: fakeDocumentTrimUri(doc),
          range: l.range,
          text: analyzer.getTextAtLocation(l),
        };
      })).toEqual([
        {
          uri: 'functions/foo.fish',
          range: Range.create(1, 18, 1, 22),
          text: 'help',
        },
        {
          uri: 'completions/foo.fish',
          range: Range.create(1, 24, 1, 28),
          text: 'help',
        },
        {
          uri: 'conf.d/baz.fish',
          range: Range.create(11, 11, 11, 16),
          text: 'help',
        },
      ]);
    });

    it('completion advanced => `complete -c foo -l other-long` -> `argparse --other-long`', () => {
      const searchDoc = workspace.find(doc => doc.uri.endsWith('completions/foo.fish'))!;
      const funcName = searchDoc?.getAutoLoadName() as string;
      const results: CompletionSymbol[] = [];

      analyzer.findNodes((n: SyntaxNode, doc: LspDocument) => {
        if (['functions', ''].includes(doc.getAutoloadType())) {
          return false;
        }
        const completeSymbol = getCompletionSymbol(n, doc);
        if (completeSymbol.isNonEmpty() && completeSymbol.hasCommandName(funcName)) {
          results.push(completeSymbol);
          return true;
        }
        return false;
      });

      const foundOpt = results.find(opt => opt.isMatchingRawOption('--other-long'));
      expect(foundOpt).toBeDefined();
      expect(foundOpt?.toUsage()).toBe('foo --other-long');
      if (!foundOpt) {
        fail();
      }
      const foundDef = analyzer.getDefinition(foundOpt.doc!, foundOpt.getRange().start)!;
      console.log({
        foundDef: foundDef?.name,
      });

      const foundDefDoc = analyzer.getDocument(foundDef.uri)!;
      /**
       * Confirm that getReferences works when passing in both:
       * a reference and a definition Location
       */
      const foundRef = getReferences(analyzer, foundDefDoc, foundDef.selectionRange.start);
      const foundRefOg = getReferences(analyzer, searchDoc, foundOpt.getRange().start);
      // console.log(JSON.stringify({
      //   foundRef: foundRef.map(r => ({ uri: r.uri, range: r.range })),
      //   foundRefOg: foundRefOg.map(r => ({ uri: r.uri, range: r.range })),
      // }, null, 2));
      expect(foundRef).toEqual(foundRefOg);
      expect(foundRefOg.map(r => {
        const doc = analyzer.getDocument(r.uri);
        return {
          uri: fakeDocumentTrimUri(doc!),
          range: r.range,
          text: analyzer.getTextAtLocation(r),
        };
      })).toEqual([
        {
          uri: 'functions/foo.fish',
          range: Range.create(1, 28, 1, 38),
          text: 'other-long',
        },
        {
          uri: 'completions/foo.fish',
          range: Range.create(3, 22, 3, 32),
          text: 'other-long',
        },
      ]);
    });

    it('command => `complete -c baz` -> `function baz;end;`', () => {
      const searchDoc = workspace.find(doc => doc.uri.endsWith('conf.d/baz.fish'))!;
      const searchSymbol = analyzer.getFlatDocumentSymbols(searchDoc.uri).find((symbol) => {
        return symbol.name === 'baz' && symbol.kind === SymbolKind.Function;
      });
      if (!searchSymbol) {
        fail();
      }
      const refLocations = getReferences(analyzer, searchDoc, searchSymbol.selectionRange.start);
      refLocations.forEach(l => {
        console.log({
          location: locationAsString(l),
          text: analyzer.getTextAtLocation(l),
        });
      });
      expect(refLocations).toHaveLength(3);
      expect(
        refLocations.map(l =>
          ({
            uri: fakeDocumentTrimUri(analyzer.getDocument(l.uri)!),
            range: l.range,
          }),
        ),
      ).toEqual([
        { uri: 'conf.d/baz.fish', range: Range.create(0, 9, 0, 12) },
        { uri: 'conf.d/baz.fish', range: Range.create(8, 12, 8, 15) },
        { uri: 'conf.d/baz.fish', range: Range.create(9, 12, 9, 15) },
      ]);
    });
  });
});
