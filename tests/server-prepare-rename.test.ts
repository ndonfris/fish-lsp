import { CancellationTokenSource, PrepareRenameParams, RenameParams } from 'vscode-languageserver';
import { Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { createMockConnection, setLogger, setupStartupMock } from './helpers';
import TestWorkspace from './test-workspace-utils';

setupStartupMock();

import FishServer from '../src/server';

describe('server onPrepareRename', () => {
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

  describe('local variable', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo',
          '    set my_var 1',
          '    echo $my_var',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('returns a prepare-rename result for a normal local variable', () => {
      const doc = workspace.getDocument('functions/foo.fish')!;
      const params: PrepareRenameParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 }, // my_var in `set my_var 1`
      };

      const result = server.onPrepareRename(params);
      expect(result).toEqual({ defaultBehavior: true });
    });
  });

  describe('argv', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo_argv.fish',
        content: [
          'function foo_argv',
          '    echo $argv',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('throws for argv rename attempts', () => {
      const doc = workspace.getDocument('functions/foo_argv.fish')!;
      const params: PrepareRenameParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 11 }, // argv in `echo $argv`
      };

      expect(() => server.onPrepareRename(params)).toThrowError(/read-only|not defined in fish/i);
    });
  });

  describe('onRename cancellation', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/rename_cancel.fish',
        content: [
          'function rename_cancel',
          '    set my_var 1',
          '    echo $my_var',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('returns null when cancellation is already requested', async () => {
      const doc = workspace.getDocument('functions/rename_cancel.fish')!;
      const params: RenameParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 }, // my_var in `set my_var 1`
        newName: 'renamed_var',
      };
      const tokenSource = new CancellationTokenSource();
      tokenSource.cancel();

      await expect(server.onRename(params, tokenSource.token)).resolves.toBeNull();
    });
  });
});
