import { CancellationTokenSource, RenameParams, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { createTestServer, setLogger, setupStartupMock, type TestServerHandle } from './helpers';
import TestWorkspace from './test-workspace-utils';

setupStartupMock();

import FishServer from '../src/server';

function applyEdit(text: string, edits: TextEdit[]): string {
  // Apply right-to-left so column offsets within a line stay valid as we mutate.
  // Multi-line edits use the same scheme — sort by (line, column) descending.
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  const lines = text.split('\n');
  for (const edit of sorted) {
    const { start, end } = edit.range;
    // We only need single-line edits for these test cases.
    const line = lines[start.line]!;
    lines[start.line] = line.slice(0, start.character) + edit.newText + line.slice(end.character);
  }
  return lines.join('\n');
}

function extractDocChanges(edit: WorkspaceEdit | null, uri: string): TextEdit[] {
  expect(edit).toBeTruthy();
  const docEdits = edit!.changes?.[uri] ?? [];
  return docEdits;
}

describe('server onRename', () => {
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

  describe('cancellation + no-op cases', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/cancel_me.fish',
      content: [
        'function cancel_me',
        '    set my_var 1',
        '    echo $my_var',
        'end',
      ].join('\n'),
    }).initialize();

    it('returns null when the cancellation token is already cancelled', async () => {
      const doc = workspace.getDocument('functions/cancel_me.fish')!;
      const tokenSource = new CancellationTokenSource();
      tokenSource.cancel();
      const params: RenameParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 },
        newName: 'renamed',
      };
      await expect(server.onRename(params, tokenSource.token)).resolves.toBeNull();
    });

    it('returns null when renaming to the same name', async () => {
      const doc = workspace.getDocument('functions/cancel_me.fish')!;
      const params: RenameParams = {
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 },
        newName: 'my_var',
      };
      await expect(server.onRename(params)).resolves.toBeNull();
    });
  });

  describe('local variable', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/foo_local.fish',
      content: [
        'function foo_local',
        '    set my_var 1',
        '    echo $my_var',
        '    echo $my_var',
        'end',
      ].join('\n'),
    }).initialize();

    it('rewrites every reference of a local variable from the definition site', async () => {
      const doc = workspace.getDocument('functions/foo_local.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 9 }, // `my_var` in `set my_var 1`
        newName: 'renamed_var',
      });
      const edits = extractDocChanges(edit, doc.uri);
      expect(edits.length).toBe(3); // def + 2 reads
      const applied = applyEdit(workspace.getDocument('functions/foo_local.fish')!.getText(), edits);
      expect(applied).toContain('set renamed_var 1');
      expect(applied).toContain('echo $renamed_var');
      expect(applied).not.toContain('my_var');
    });

    it('rewrites every reference of a local variable from a usage site', async () => {
      const doc = workspace.getDocument('functions/foo_local.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line: 2, character: 11 }, // `my_var` in first `echo $my_var`
        newName: 'renamed_var',
      });
      const edits = extractDocChanges(edit, doc.uri);
      expect(edits.length).toBe(3);
      const applied = applyEdit(workspace.getDocument('functions/foo_local.fish')!.getText(), edits);
      expect(applied).not.toContain('my_var');
    });
  });

  describe('local function', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/local_fn.fish',
      content: [
        'function local_fn',
        '    function helper',
        '        echo "hi"',
        '    end',
        '    helper',
        '    helper',
        'end',
      ].join('\n'),
    }).initialize();

    it('renames a nested function and its call sites', async () => {
      const doc = workspace.getDocument('functions/local_fn.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line: 1, character: 16 }, // `helper` in `function helper`
        newName: 'renamed_helper',
      });
      const edits = extractDocChanges(edit, doc.uri);
      expect(edits.length).toBeGreaterThanOrEqual(3); // def + 2 calls
      const applied = applyEdit(doc.getText(), edits);
      expect(applied).toContain('function renamed_helper');
      const lines = applied.split('\n');
      expect(lines[4]!.trim()).toBe('renamed_helper');
      expect(lines[5]!.trim()).toBe('renamed_helper');
    });
  });

  // The argparse flag scenarios — same source used by `server-prepare-rename`.
  // Validates the rename pipeline fully covers every reference site:
  //   - the argparse-definition cursor (`name` inside `'n/name='`)
  //   - the `--name="value"` concatenation usage
  //   - the bare-space `--name "value"` usage
  //   - the `_flag_name` variable usage
  // For each cursor, the user types `email` (the placeholder form returned by
  // onPrepareRename) and expects all sites to be rewritten coherently:
  // `argparse 'n/email='`, `--email=...`, `--email ...`, `_flag_email`.
  describe('argparse flag (--name=, --name, _flag_name) accepts bare `email`', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/greet_rename.fish',
      content: [
        'function greet_rename -d "Greet someone by name"',  // 0
        "    argparse 'n/name=' -- $argv",                   // 1
        '    or return 1',                                   // 2
        '',                                                  // 3
        '    not set -ql _flag_name',                        // 4
        '    and set _flag_name "world"',                    // 5
        '',                                                  // 6
        '    echo "Hello, $_flag_name!"',                    // 7
        'end',                                               // 8
        '',                                                  // 9
        'greet_rename --name="fish-lsp user"',               // 10  equals form
        'greet_rename --name "fish-lsp user"',               // 11  space form
      ].join('\n'),
    }).initialize();

    async function renameAt(line: number, character: number) {
      const doc = workspace.getDocument('functions/greet_rename.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line, character },
        newName: 'email',
      });
      const edits = extractDocChanges(edit, doc.uri);
      const applied = applyEdit(doc.getText(), edits);
      return { edits, applied, doc };
    }

    function expectArgparseRenamed(applied: string) {
      expect(applied).toContain("argparse 'n/email='");
      expect(applied).toContain('set -ql _flag_email');
      expect(applied).toContain('set _flag_email "world"');
      expect(applied).toContain('"Hello, $_flag_email!"');
      expect(applied).toContain('greet_rename --email="fish-lsp user"');
      expect(applied).toContain('greet_rename --email "fish-lsp user"');
      expect(applied).not.toMatch(/_flag_name\b/);
    }

    it('rename from definition site (`name` inside `argparse \'n/name=\'`)', async () => {
      const { edits, applied } = await renameAt(1, 17);
      expect(edits.length).toBeGreaterThan(0);
      expectArgparseRenamed(applied);
    });

    it('rename from `--name="..."` reference (equals form)', async () => {
      const { edits, applied } = await renameAt(10, 17);
      expect(edits.length).toBeGreaterThan(0);
      expectArgparseRenamed(applied);
    });

    it('rename from `--name` reference (space form)', async () => {
      const { edits, applied } = await renameAt(11, 17);
      expect(edits.length).toBeGreaterThan(0);
      expectArgparseRenamed(applied);
    });

    it('rename from `_flag_name` reference', async () => {
      const { edits, applied } = await renameAt(4, 22);
      expect(edits.length).toBeGreaterThan(0);
      expectArgparseRenamed(applied);
    });
  });

  // Regression: when the cursor is on `set _flag_name "world"` (a write to
  // the argparse-injected variable, e.g. the `and set _flag_name "world"`
  // fallback after `argparse 'n/name=' -- $argv`), rename used to resolve to
  // a separate SET FishSymbol with a narrow lexical scope — missing the
  // argparse definition itself and every `--name` call site. The symbol
  // model now redirects the SET redefinition to its sibling ARGPARSE symbol
  // so rename/refs from the redef site cover the full identifier.
  describe('argparse `_flag_*` redefinition site (regression)', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/greet_redef.fish',
      content: [
        'function greet_redef -d "Greet someone by name"',  // 0
        "    argparse 'n/name=' -- $argv",                  // 1
        '    or return 1',                                  // 2
        '',                                                 // 3
        '    not set -ql _flag_name',                       // 4
        '    and set _flag_name "world"',                   // 5  redef site
        '',                                                 // 6
        '    echo "Hello, $_flag_name!"',                   // 7
        'end',                                              // 8
        '',                                                 // 9
        'greet_redef --name="fish-lsp user"',               // 10
      ].join('\n'),
    }).initialize();

    it('rename from `set _flag_name` redef rewrites argparse def + every reference', async () => {
      const doc = workspace.getDocument('functions/greet_redef.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line: 5, character: 17 }, // `_flag_name` in `and set _flag_name "world"`
        newName: 'email',
      });
      const edits = extractDocChanges(edit, doc.uri);
      expect(edits.length).toBeGreaterThanOrEqual(5);
      const applied = applyEdit(doc.getText(), edits);
      // Every site must be rewritten — including the argparse def (L1) and
      // the `--name` call (L10), which the old SET-symbol-scoped rename
      // would have missed.
      expect(applied).toContain("argparse 'n/email='");
      expect(applied).toContain('set -ql _flag_email');
      expect(applied).toContain('set _flag_email "world"');
      expect(applied).toContain('"Hello, $_flag_email!"');
      expect(applied).toContain('greet_redef --email="fish-lsp user"');
      expect(applied).not.toMatch(/_flag_name\b/);
      expect(applied).not.toMatch(/--name/);
    });
  });

  // Renaming an argparse flag with a `--prefixed` new name should still work
  // — `fixNewText` strips leading dashes so the downstream edits land on the
  // canonical `name` portion of each reference site.
  describe('argparse flag accepts `--email` (long form) new name', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'functions/greet_long.fish',
      content: [
        'function greet_long',
        "    argparse 'n/name=' -- $argv",
        '    or return 1',
        '    echo "Hello, $_flag_name!"',
        'end',
        '',
        'greet_long --name="x"',
      ].join('\n'),
    }).initialize();

    it('rewrites references when newName is `--email`', async () => {
      const doc = workspace.getDocument('functions/greet_long.fish')!;
      const edit = await server.onRename({
        textDocument: { uri: doc.uri },
        position: { line: 6, character: 14 }, // inside `--name=`
        newName: '--email',
      });
      const edits = extractDocChanges(edit, doc.uri);
      expect(edits.length).toBeGreaterThan(0);
      const applied = applyEdit(doc.getText(), edits);
      expect(applied).toContain('greet_long --email="x"');
      expect(applied).toContain("argparse 'n/email='");
      expect(applied).toContain('$_flag_email');
    });
  });
});
