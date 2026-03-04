import { ReferenceParams } from 'vscode-languageserver';
import { Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { createMockConnection, setLogger, setupStartupMock } from './helpers';
import TestWorkspace from './test-workspace-utils';

setupStartupMock();

import FishServer from '../src/server';

describe('server onReferences', () => {
  setLogger();

  let server: FishServer;

  beforeAll(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();

    const mockConnection = createMockConnection();
    const mockInitializeParams = {
      processId: 1234,
      rootUri: 'file:///tmp',
      rootPath: '/tmp',
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [],
    };

    const result = await FishServer.create(mockConnection, mockInitializeParams as any);
    server = result.server;
    server.backgroundAnalysisComplete = true;
  });

  describe('argv in regular caller + no-scope callee', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/caller.fish',
        content: [
          'function caller',
          '   set val_1 1',
          '   set val_2 2',
          '   set val_3 3',
          '   set val_4 4',
          '   called',
          '   set --show argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/called.fish',
        content: [
          'function called --no-scope-shadowing',
          '    set -f argv 1 2 3',
          '    set --show argv',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/outer.fish',
        content: [
          'function outer',
          '    caller',
          '    set --show argv',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('keeps argv references anchored to request position (includes caller+called, excludes outer)', async () => {
      const callerDoc = workspace.getDocument('functions/caller.fish')!;
      const calledDoc = workspace.getDocument('functions/called.fish')!;
      const outerDoc = workspace.getDocument('functions/outer.fish')!;

      const params: ReferenceParams = {
        context: { includeDeclaration: true },
        textDocument: { uri: calledDoc.uri },
        position: { line: 1, character: 11 }, // `argv` in: set -f argv 1 2 3
      };

      const refs = await server.onReferences(params);

      const callerRefLines = refs.filter(r => r.uri === callerDoc.uri).map(r => r.range.start.line);
      const calledRefLines = refs.filter(r => r.uri === calledDoc.uri).map(r => r.range.start.line);
      const outerRefLines = refs.filter(r => r.uri === outerDoc.uri).map(r => r.range.start.line);

      expect(callerRefLines).toContain(6);
      expect(calledRefLines).toContain(1);
      expect(calledRefLines).toContain(2);
      expect(outerRefLines).not.toContain(2);
    });
  });
});
