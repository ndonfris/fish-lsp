import { CancellationTokenSource, PrepareRenameParams, RenameParams } from 'vscode-languageserver';
import { createTestServer, setLogger, type TestServerHandle } from './helpers';
import TestWorkspace from './test-workspace-utils';

import FishServer from '../src/server';

describe('server onPrepareRename', () => {
  setLogger();

  let handle: TestServerHandle;
  let server: FishServer;

  beforeAll(async () => {
    handle = await createTestServer();
    server = handle.server;
  });

  afterAll(async () => {
    await handle?.shutdown();
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
      expect(result).toEqual({
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 14 },
        },
        placeholder: 'my_var',
      });
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

  // Regression: invoking rename on an argparse flag should expose `name` (the
  // flag name) as the placeholder, not `_flag_name` (the variable form). The
  // returned range should also reflect the cursor's token, narrowed to the
  // flag-name portion (strip leading `--`, trailing `=...`, or leading
  // `_flag_`), so the editor highlights the renameable substring at the
  // click site.
  describe('argparse flag', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/greet.fish',
        content: [
          'function greet -d "Greet someone by name"',          // 0
          "    argparse 'n/name=' -- $argv",                    // 1
          '    or return 1',                                    // 2
          '',                                                   // 3
          '    not set -ql _flag_name',                         // 4
          '    and set _flag_name "world"',                     // 5
          '',                                                   // 6
          '    echo "Hello, $_flag_name!"',                     // 7
          'end',                                                // 8
          '',                                                   // 9
          'greet --name="fish-lsp user"',                       // 10
          'greet --name "fish-lsp user"',                       // 11
        ].join('\n'),
      },
    ).initialize();

    it('exposes `name` as the placeholder for cursor on `--name="..."`', () => {
      const doc = workspace.getDocument('functions/greet.fish')!;
      const result = server.onPrepareRename({
        textDocument: { uri: doc.uri },
        position: { line: 10, character: 8 }, // inside `--name=`
      }) as any;
      expect(result).toBeTruthy();
      expect(result.placeholder).toBe('name');
      expect(result.range.start).toEqual({ line: 10, character: 8 });
      expect(result.range.end).toEqual({ line: 10, character: 12 });
    });

    it('exposes `name` as the placeholder for cursor on `--name`', () => {
      const doc = workspace.getDocument('functions/greet.fish')!;
      const result = server.onPrepareRename({
        textDocument: { uri: doc.uri },
        position: { line: 11, character: 8 }, // inside `--name`
      }) as any;
      expect(result).toBeTruthy();
      expect(result.placeholder).toBe('name');
      expect(result.range.start).toEqual({ line: 11, character: 8 });
      expect(result.range.end).toEqual({ line: 11, character: 12 });
    });

    it('exposes `name` as the placeholder for cursor on `_flag_name`', () => {
      const doc = workspace.getDocument('functions/greet.fish')!;
      const result = server.onPrepareRename({
        textDocument: { uri: doc.uri },
        position: { line: 4, character: 17 }, // inside `_flag_name`
      }) as any;
      expect(result).toBeTruthy();
      expect(result.placeholder).toBe('name');
      // Range covers just the `name` portion, skipping the `_flag_` prefix.
      expect(result.range.start.line).toBe(4);
      expect(result.range.start.character).toBe(16 + '_flag_'.length);
    });

    // Regression: `canRenameWithNewText` used to reject bare new names like
    // `email` whenever the cursor was on a flag form (`--name`, `--name=`),
    // because it required the new text to be in the same short/long flag
    // form as the cursor's token. That blocked the legitimate path where
    // the placeholder is `name` (the canonical flag name) and the user
    // types another bare name. With the argparse-aware bypass in place,
    // rename should succeed from every reference site too — not just from
    // the definition.
    describe('onRename succeeds for every reference site (regression)', () => {
      it('rename from definition site (`name` inside `argparse \'n/name=\'`)', async () => {
        const doc = workspace.getDocument('functions/greet.fish')!;
        const edit = await server.onRename({
          textDocument: { uri: doc.uri },
          position: { line: 1, character: 17 },
          newName: 'email',
        });
        expect(edit).toBeTruthy();
        expect(edit!.changes![doc.uri]!.length).toBeGreaterThan(0);
      });

      it('rename from `--name="..."` reference', async () => {
        const doc = workspace.getDocument('functions/greet.fish')!;
        const edit = await server.onRename({
          textDocument: { uri: doc.uri },
          position: { line: 10, character: 8 },
          newName: 'email',
        });
        expect(edit).toBeTruthy();
        expect(edit!.changes![doc.uri]!.length).toBeGreaterThan(0);
      });

      it('rename from `--name` reference (space form)', async () => {
        const doc = workspace.getDocument('functions/greet.fish')!;
        const edit = await server.onRename({
          textDocument: { uri: doc.uri },
          position: { line: 11, character: 8 },
          newName: 'email',
        });
        expect(edit).toBeTruthy();
        expect(edit!.changes![doc.uri]!.length).toBeGreaterThan(0);
      });

      it('rename from `_flag_name` reference', async () => {
        const doc = workspace.getDocument('functions/greet.fish')!;
        const edit = await server.onRename({
          textDocument: { uri: doc.uri },
          position: { line: 4, character: 17 },
          newName: 'email',
        });
        expect(edit).toBeTruthy();
        expect(edit!.changes![doc.uri]!.length).toBeGreaterThan(0);
      });
    });
  });
});
