import { existsSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, relative } from 'path';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { createFakeLspDocument, setLogger } from './helpers';
import { workspaceManager } from '../src/utils/workspace-manager';
import { testCloseDocument } from './document-test-helpers';

setLogger();

describe('TestWorkspace disk fixtures', () => {
  const workspace = TestWorkspace.create()
    .addFiles(TestFile.custom('nested/fixture.fish', 'echo fixture'));

  describe('file lifecycle', () => {
    workspace.initializeFiles();

    it('creates readable files under tests/workspaces without registering a workspace', () => {
      const filePath = join(workspace.path, 'nested/fixture.fish');
      expect(relative(join(__dirname, 'workspaces'), filePath).startsWith('..')).toBe(false);
      expect(readFileSync(filePath, 'utf8')).toBe('echo fixture');
      expect(workspaceManager.all.some(ws => ws.path === workspace.path)).toBe(false);
      expect(workspace.getDocument('nested/fixture.fish')).toBeUndefined();
    });
  });

  afterAll(() => {
    // The nested suite's cleanup must remove the directory and its contents.
    expect(existsSync(workspace.path)).toBe(false);
  });
});

describe('logical temporary document paths', () => {
  it('keeps a /tmp URI in memory without creating a file', () => {
    const filePath = `/tmp/fish-lsp-virtual-${randomUUID()}.fish`;
    expect(existsSync(filePath)).toBe(false);
    const document = createFakeLspDocument(filePath, 'echo virtual');
    try {
      expect(document.uri).toBe(`file://${filePath}`);
      expect(document.getText()).toBe('echo virtual');
      expect(existsSync(filePath)).toBe(false);
    } finally {
      testCloseDocument(document.uri);
      workspaceManager.clear();
    }
  });
});
