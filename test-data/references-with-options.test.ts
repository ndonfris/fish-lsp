
import { createFakeLspDocument, rangeAsString, setLogger, TestWorkspaces } from './helpers';
import { getReferencesOld } from '../src/old-references';
import { ReferenceOptions, getReferences } from '../src/references';
import { Analyzer, analyzer } from '../src/analyze';
import { documents, LspDocument } from '../src/document';
import * as path from 'path';
import { SyncFileHelper } from '../src/utils/file-operations';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { workspaceManager } from '../src/utils/workspace-manager';
import { Workspace } from '../src/utils/workspace';
import { getRange, pointToPosition } from '../src/utils/tree-sitter';
import { Location } from 'vscode-languageserver';
import { logger } from '../src/logger';
import { FishAlias, isAliasDefinitionValue } from '../src/parsing/alias';
import { findParentCommand } from '../src/utils/node-types';
// import { pathToUri } from '../src/utils/translation';

const testWorkspace = TestWorkspaces.workspace2;
const ws = Workspace.syncCreateFromUri(testWorkspace.uri)!;

function referenceLocationsToString(locations: Location[]) {
  return locations.map(loc => {
    const doc = ws.findDocument(doc => doc.uri === loc.uri);
    return `${doc?.getRelativeFilenameToWorkspace()}---${rangeAsString(loc.range)}`;
  });
}

function findDocumentByAutoloadedName(name: string): LspDocument | undefined {
  return ws.allDocuments().find(doc => doc.isAutoloadedFunction() && doc.getAutoLoadName() === name);
}

describe('testing references with new `opts` param', () => {
  setLogger();

  beforeAll(async () => {
    logger.setLogLevel('debug');
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
    it("workspace path", () => {
      console.log({
        doesExist: SyncFileHelper.exists(TestWorkspaces.workspace2.path),
        isDirectory: SyncFileHelper.isDirectory(TestWorkspaces.workspace2.path),
      });
      expect(SyncFileHelper.exists(TestWorkspaces.workspace2.path)).toBe(true);
      expect(SyncFileHelper.isDirectory(TestWorkspaces.workspace2.path)).toBe(true);
    });

    it("workspace non-completion docs", () => {
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
    it("config.fish", () => {
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
      })
        ;
    });

  });

});
