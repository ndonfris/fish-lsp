
import { createFakeLspDocument, rangeAsString, setLogger, TestWorkspaces } from './helpers';
import { getReferencesOld } from '../src/old-references';
import { NestedSyntaxNodeWithReferences, ReferenceOptions, allUnusedLocalReferences, getReferences } from '../src/references';
import { Analyzer, analyzer } from '../src/analyze';
import { documents, LspDocument } from '../src/document';
import * as path from 'path';
import { SyncFileHelper } from '../src/utils/file-operations';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { workspaceManager } from '../src/utils/workspace-manager';
import { Workspace } from '../src/utils/workspace';
import { getChildNodes, getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Location } from 'vscode-languageserver';
import { logger } from '../src/logger';
import { FishAlias, isAliasDefinitionValue } from '../src/parsing/alias';
import { findParentCommand, isString } from '../src/utils/node-types';
import { extractCommands } from '../src/parsing/nested-strings';
import { Option, isMatchingOptionOrOptionValue } from '../src/parsing/options';
// import { pathToUri } from '../src/utils/translation';

const testWorkspace = TestWorkspaces.workspace2;
const ws = Workspace.syncCreateFromUri(testWorkspace.uri)!;

function referenceLocationsToString(locations: Location[]) {
  return locations.map(loc => {
    const doc = ws.findDocument(doc => doc.uri === loc.uri);
    return `${doc?.getRelativeFilenameToWorkspace()}   ${rangeAsString(loc.range)}`;
  });
}

function findDocumentByAutoloadedName(name: string): LspDocument | undefined {
  return ws.allDocuments().find(doc => doc.isAutoloadedFunction() && doc.getAutoLoadName() === name);
}

describe('testing references with new `opts` param', () => {
  setLogger();

  beforeAll(async () => {
    // logger.setLogLevel('debug');
    await setupProcessEnvExecFile();
    await Analyzer.initialize();
  });

  beforeEach(async () => {
    workspaceManager.add(ws);
    workspaceManager.setCurrent(ws);
    await workspaceManager.analyzePendingDocuments();
  });

  afterEach(() => {
    ws.setAllPending();
    documents.closeAll();
    workspaceManager.clear();
  });

  describe(`setting up workspace ${ws.name}`, () => {
    it('workspace path', () => {
      console.log({
        doesExist: SyncFileHelper.exists(TestWorkspaces.workspace2.path),
        isDirectory: SyncFileHelper.isDirectory(TestWorkspaces.workspace2.path),
      });
      expect(SyncFileHelper.exists(TestWorkspaces.workspace2.path)).toBe(true);
      expect(SyncFileHelper.isDirectory(TestWorkspaces.workspace2.path)).toBe(true);
    });

    it('workspace non-completion docs', () => {
      workspaceManager.current?.allDocuments().forEach((doc: LspDocument, idx) => {
        console.log({
          idx,
          path: doc.getRelativeFilenameToWorkspace(),
          symbols: analyzer.getFlatDocumentSymbols(doc.uri)
            .filter(s => s.isGlobal())
            .map(s => s.name),
        });
      });
    });

    it('count types of documents', () => {
      const docTypes = workspaceManager.current!.allDocuments().reduce((acc, doc) => {
        const ext = doc.getAutoloadType() as 'config' | 'functions' | 'completions' | 'conf.d';
        acc[ext] = (acc[ext] || 0) + 1;
        return acc;
      }, {} as Record<('config' | 'functions' | 'completions' | 'conf.d'), number>);
      console.log({
        workspace: ws.name,
        docTypes,
      });
      expect(docTypes.config).toBe(1);
    });

    it('check if workspace is analyzed', () => {
      expect(workspaceManager.current?.isAnalyzed()).toBe(true);
    });

    it('check if workspace has documents', () => {
      expect(workspaceManager.current?.allDocuments().length).toBeGreaterThanOrEqual(22);
    });

    it('check if workspace has global symbols', () => {
      const wsSymbols = analyzer.getWorkspaceSymbols('');
      console.log({
        workspace: ws.name,
        symbols: wsSymbols.map(s => s.name),
        totalSymbols: wsSymbols.length,
      });
      expect(wsSymbols.length).toBeGreaterThanOrEqual(34); // if more symbols are added, this might not be an exact match
    });

    it('find functions with completions', () => {
      const funcs: LspDocument[] = [] as LspDocument[];
      const cmps: LspDocument[] = [] as LspDocument[];
      const funcsWithCompletions: LspDocument[] = [] as LspDocument[];
      ws.allDocuments().forEach(doc => {
        if (doc.getAutoloadType() === 'functions') {
          funcs.push(doc);
        }
        if (doc.getAutoloadType() === 'completions') {
          cmps.push(doc);
        }
      });
      for (const func of funcs) {
        const fname = func.getFileName();
        if (cmps.some(cmp => cmp.getFileName() === fname)) {
          funcsWithCompletions.push(func);
        }
      }
      console.log({
        workspace: ws.name,
        funcsWithCompletions: funcsWithCompletions.map(f => f.getRelativeFilenameToWorkspace()),
        totalFuncsWithCompletions: funcsWithCompletions.length,
        funcs: funcs.map(f => f.getRelativeFilenameToWorkspace()),
        cmps: cmps.map(c => c.getRelativeFilenameToWorkspace()),
      });
      expect(funcsWithCompletions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('working with function<->completion references', () => {
    const symbolNamesWithFunctionsAndCompletions = [
      'cdls',
      'fzf-history-search',
      'os-name',
      'source_fish',
    ] as string[];

    it('all docs for symbolNamesWithFunctionsAndCompletions', () => {
      symbolNamesWithFunctionsAndCompletions.forEach(name => {
        // console.log({
        //   name,
        //   workspaceSymbols: analyzer.getWorkspaceSymbols(name).map(s => s.name),
        //   docs: ws.findMatchingFishIdentifiers(name),
        // })
        expect(ws.findMatchingFishIdentifiers(name)).toHaveLength(2);
      });
    });

    it('`cdls` function, references for `ls`', () => {
      const cdlsDoc = findDocumentByAutoloadedName('cdls')!;
      const cmds = analyzer.cache.getCommands(cdlsDoc.uri);
      expect(cmds).toBeDefined();
      expect(cmds.length).toBeGreaterThan(1);
      const lsNode = cmds.find(c => c.firstNamedChild!.text.startsWith('ls'))!;
      expect(lsNode).toBeDefined();
      expect(lsNode.text).toBe('ls');
      const lsPosition = pointToPosition(lsNode.startPosition);
      const defSymbol = analyzer.getDefinition(cdlsDoc, lsPosition);
      const refs = getReferences(cdlsDoc, lsPosition);
      const newRefs = getReferences(cdlsDoc, lsPosition, { logPerformance: true });
      // logger.warning({
      //   cdlsDoc: cdlsDoc.getRelativeFilenameToWorkspace(),
      //   cdlsDocSymbols: analyzer.getFlatDocumentSymbols(cdlsDoc.uri)
      //     .filter(s => s.isGlobal())
      //     .map(s => s.name),
      //   cmds: cmds.map(c => c.firstNamedChild?.text),
      //   lsNode: lsNode.text,
      //   defSymbol: {
      //     name: defSymbol?.name,
      //     uri: ws.findDocument(doc => doc.uri === defSymbol?.uri)?.getRelativeFilenameToWorkspace(),
      //     position: JSON.stringify(defSymbol?.selectionRange),
      //   },
      //   refs: referenceLocationsToString(refs),
      //   newRefs: referenceLocationsToString(newRefs),
      // });
      expect(refs.length).toBeGreaterThanOrEqual(6); // TODO: should be more, `alias blah=sl`, etc...
      for (const ref of newRefs) {
        const doc = ws.findDocument(d => d.uri === ref.uri)!;
        if (!doc.uri.endsWith('config.fish')) continue;
        console.log({
          msg: `New ref: ${ref.uri.slice(-40)} - ${rangeAsString(ref.range)}`,
          txt: doc.getText(ref.range),
        });
      }
      console.log({
        msg: `checking newRefs.length for '${defSymbol!.name}': ${newRefs.length}`,
        refs: referenceLocationsToString(newRefs),
      });
      expect(newRefs.length).toBeGreaterThanOrEqual(7);
    });

    it('`fzf-history-search.fish` document, references in `fish_user_key_bindings.fish`', () => {
      const histDoc = findDocumentByAutoloadedName('fzf-history-search')!;
      const symbol = analyzer
        .getFlatDocumentSymbols(histDoc.uri)
        .find(s => s.name === 'fzf-history-search');
      if (!symbol) {
        fail('Symbol for fzf-history-search not found');
      }
      expect(symbol).toBeDefined();
      expect(symbol?.uri).toBe(histDoc.uri);
      const pos = pointToPosition(symbol.focusedNode.startPosition);
      const refs = getReferences(histDoc, pos);
      const newRefs = getReferences(histDoc, pos);
      console.log({
        refs: referenceLocationsToString(refs),
        newRefs: referenceLocationsToString(newRefs),
      });
      const newRefUriSet = new Set(newRefs.map(r => r.uri));
      // for (const ref of newRefs) {
      //   const doc = ws.findDocument(d => d.uri === ref.uri)!;
      //   console.log({
      //     msg: `New ref: file:///${ref.uri.slice(ref.uri.lastIndexOf('workspace_2'))} - ${rangeAsString(ref.range)}`,
      //     txt: doc.getText(ref.range),
      //   });
      // }
      expect(newRefUriSet.size).toBe(3);
    });
  });

  describe('finding alias refs', () => {
    it('config.fish', () => {
      const doc = ws.findDocument(d => d.getFilename().endsWith('config.fish'))!;
      const nodes = analyzer.getNodes(doc.uri);
      const aliasValues = nodes.filter(n => isAliasDefinitionValue(n));
      aliasValues.forEach(n => {
        const parent = findParentCommand(n);
        logger.warning({
          text: n.text,
          type: n.type,
          range: rangeAsString(getRange(n)),
          info: FishAlias.getInfo(parent!),
        });
      });
    });
  });

  describe('parse inline string references', () => {
    it('should find references in inline strings', () => {
      const fakeDoc = createFakeLspDocument('test_inline_string.fish',
        'function __test_inline_string_1',
        '    echo "This is a test string with a reference to ls"',
        '    return 0',
        'end',
        'function __test_inline_string_2',
        '    echo "Another test string with a reference to ls"',
        '    return 0',
        'end',
        'complete -c test_inline_string -n "__test_inline_string_1" -l ls',
        'complete -c test_inline_string -n "__test_inline_string_2" -l exa',
        '',
        'complete -c test_inline_string -n "not __test_inline_string_1" -s l',
        'complete -c test_inline_string -n "not __test_inline_string_2" -s e',
        '',
        'complete -c test_inline_string -n "__test_inline_string_1; and not __test_inline_string_2" -l both1',
        'complete -c test_inline_string -n "not __test_inline_string_1; and not __test_inline_string_2" -l both2',
      );
      const cached = analyzer.analyze(fakeDoc);
      expect(cached).toBeDefined();

      workspaceManager.current?.add(fakeDoc.uri);

      const symbol = cached.documentSymbols.find(s => s.name === '__test_inline_string_1');
      expect(symbol).toBeDefined();
      const pos = pointToPosition(symbol!.focusedNode.startPosition);
      const refs = getReferences(fakeDoc, pos, { logPerformance: true });
      const cmpStr = getChildNodes(cached.root).find(n => isString(n) && n.text === '"__test_inline_string_1; and not __test_inline_string_2"')!;
      const extractedCommands = extractCommands(cmpStr);
      expect(extractedCommands).toHaveLength(2);
      expect(refs).toHaveLength(5);
      for (const ref of refs) {
        const doc = ws.findDocument(d => d.uri === ref.uri)!;
        console.log({
          msg: `New ref: file:///${ref.uri.slice(ref.uri.lastIndexOf('workspace_2'))} - ${rangeAsString(ref.range)}`,
          txt: doc.getText(ref.range),
        });
      }
    });

    it('function foo --wraps=bar', () => {
      const fakeDoc = createFakeLspDocument('functions/foo.fish',
        'function foo --wraps=bar',
        '    echo "This is a test string with a reference to bar"',
        '    return 0',
        'end',
        'function bar',
        '    echo "This is bar function"',
        '    return 0',
        'end',
      );
      const cached = analyzer.analyze(fakeDoc);
      expect(cached).toBeDefined();
      workspaceManager.current?.add(fakeDoc.uri);

      const fooSymbol = cached.documentSymbols.find(s => s.name === 'foo')!;
      const barSymbol = cached.documentSymbols.find(s => s.name === 'bar')!;
      const wrappedNode = getChildNodes(fooSymbol?.node).find(n => n.text === '--wraps=bar')!;
      expect(wrappedNode).toBeDefined();
      // logger.debug({
      //   msg: `Wrapped node: ${wrappedNode?.text}`,
      //   type: wrappedNode?.type,
      //   range: rangeAsString(getRange(wrappedNode!)),
      //   isOpt: isMatchingOptionOrOptionValue(wrappedNode, Option.fromRaw('-w', '--wraps')),
      //   parent: {
      //     text: wrappedNode.parent?.text,
      //     type: wrappedNode.parent?.type,
      //   },
      //   isWrappedCall: NestedSyntaxNodeWithReferences.isWrappedCall(barSymbol, wrappedNode),
      // });
      const barRefs = getReferences(cached.document, pointToPosition(barSymbol.focusedNode.startPosition));
      console.log({
        barRefs: referenceLocationsToString(barRefs),
      });
      expect(barRefs).toHaveLength(2);
    });

    it("function foo --wraps='bar'", () => {
      const fakeDoc = createFakeLspDocument('functions/foo.fish',
        'function foo --wraps=\'bar\'',
        '    echo "This is a test string with a reference to bar"',
        '    return 0',
        'end',
        'function bar',
        '    echo "This is bar function"',
        '    return 0',
        'end',
      );
      const cached = analyzer.analyze(fakeDoc);
      expect(cached).toBeDefined();
      workspaceManager.current?.add(fakeDoc.uri);

      const fooSymbol = cached.documentSymbols.find(s => s.name === 'foo')!;
      const barSymbol = cached.documentSymbols.find(s => s.name === 'bar')!;
      const wrappedNode = getChildNodes(fooSymbol?.node).find(n => n.text === '\'bar\'')!;
      expect(wrappedNode).toBeDefined();
      const barRefs = getReferences(cached.document, pointToPosition(barSymbol.focusedNode.startPosition));
      console.log({
        barRefs: referenceLocationsToString(barRefs),
      });
      expect(barRefs).toHaveLength(2);
    });
  });

  describe('find entire workspace local symbol usages', () => {
    // it('single doc', () => {
    //   ws.allDocuments().forEach(doc => {
    //     if (!doc.uri.endsWith('completions/os-name.fish')) return;
    //     const symbols = analyzer.getFlatDocumentSymbols(doc.uri)
    //       .filter(s => s.isLocal());
    //     for (const symbol of symbols) {
    //       const localRefs = getReferences(doc, pointToPosition(symbol.focusedNode.startPosition), { logPerformance: true, firstMatch: true, excludeDefinition: true });
    //       if (localRefs.length === 0) {
    //         logger.warning({
    //           msg: `No local references found for symbol: ${symbol.name}`,
    //           uri: doc.getRelativeFilenameToWorkspace(),
    //           position: JSON.stringify(symbol.focusedNode.startPosition),
    //         });
    //       }
    //     };
    //   });
    // });

    it.only('multiple docs', () => {
      ws.allDocuments().forEach(doc => {
        analyzer.analyze(doc);
        const symbols = analyzer.getFlatDocumentSymbols(doc.uri)
          .filter(s => s.isLocal());
        for (const symbol of symbols) {
          if (symbol.name === 'argv') continue;

          if (!symbol.uri.endsWith('functions/toggle-auto-complete.fish')) continue; // skip this one, it has too many references
          const localRefs = getReferences(doc, symbol.selectionRange.start, { excludeDefinition: true, localOnly: true, firstMatch: true });
          if (symbol.fishKind === 'ARGPARSE' && symbol.aliasedNames.length > 1) {
            const otherSymbol = symbols.find(s => s.equalArgparse(symbol));
            localRefs.push(...getReferences(doc, otherSymbol!.selectionRange.start, { excludeDefinition: true, localOnly: true, firstMatch: true }));
          }
          if (localRefs.length === 0) {
            logger.warning({
              msg: `No local references found for symbol: ${symbol.name}`,
              uri: doc.getRelativeFilenameToWorkspace(),
              localRefs: referenceLocationsToString(localRefs),
            });
          } else {
            logger.warning({
              msg: `Found local references for symbol: ${symbol.name}`,
              uri: doc.getRelativeFilenameToWorkspace(),
              position: JSON.stringify(symbol.focusedNode.startPosition),
              refs: referenceLocationsToString(localRefs),
            });
          }
        }
      });
    });

    it.only('single doc', () => {
      const doc = findDocumentByAutoloadedName('toggle-auto-complete');
      if (!doc) {
        fail('Document with toggle-auto-complete not found');
      }
      const localRefs = allUnusedLocalReferences(doc);
      logger.warning({
        uri: doc.getRelativeFilenameToWorkspace(),
        msg: `Found unused local references: ${localRefs.length}`,
        refs: referenceLocationsToString(localRefs),
        refNames: localRefs.map(ref => ref.name),
      });
    });
  });
});
