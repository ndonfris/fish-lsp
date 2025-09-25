import fs from 'fs';
import path from 'path';
import { workspaceManager } from '../src/utils/workspace-manager';
import { focusedWorkspace, TestFile, TestWorkspace } from './test-workspace-utils';
import { SyncFileHelper } from '../src/utils/file-operations';

describe('Test Workspace Setup (`TestWorkspace.create()` usage)', () => {
  describe('t1', () => {
    TestWorkspace.create({
      name: 'test-setup',
      autoAnalyze: true,
      autoFocusWorkspace: true,
    }).addFiles(
      TestFile.config('fish_add_path --path /usr/local/bin'),
      TestFile.confd('paths', `
fish_add_path --path /usr/bin
fish_add_path --path ~/.local/bin
fish_add_path --path /bin
fish_add_path --path /usr/bin
`),
    ).setup();

    it('should have a valid workspace', () => {
      const ws = workspaceManager.current!;
      expect(ws?.name).toBe('test-setup');
      expect(ws?.needsAnalysis()).toBe(false);
      expect(ws?.uris.indexedCount).toBeGreaterThan(0);
      expect(ws?.uris.indexedCount).toBe(2);
      console.log(`Workspace ${ws.name} has ${ws.uris.indexedCount} indexed files.`);
      console.log(ws.toTreeString());
    });

    it('auto focus workspace', () => {
      expect(focusedWorkspace!.name).toBe('test-setup');
      expect(focusedWorkspace!.uris.indexedCount).toBe(2);
    });
  });

  describe('t2', () => {
    TestWorkspace.create({
      name: 'test-setup-2',
      autoAnalyze: true,
      forceAllDefaultWorkspaceFolders: true,
      addEnclosingFishFolder: true,
      autoFocusWorkspace: true,
    }).addFiles(
      TestFile.config('fish_add_path --path /usr/local/bin'),
      TestFile.function('ls', `function ls
  echo "Listing files in current directory"
  command exa 
  `),
      TestFile.completion('ls', `
complete -c ls -n "__fish_seen_subcommand_from ls" -f -a "(\ls)"
`),
    ).setup();

    it('should have a valid workspace (w/ `fish` enclosing wrapper)', () => {
      const ws = focusedWorkspace!;
      console.log({
        name: ws.name,
        uri: ws.uri,
        uriCount: ws.uris.all.length,
        needsAnalysis: ws.needsAnalysis(),
        indexedCount: ws.uris.indexedCount,
        path: ws.path,
        docs: ws.allDocuments().map(doc => doc.getRelativeFilenameToWorkspace()),
      });
      expect(ws?.name).toBe('test-setup-2');
      expect(ws?.needsAnalysis()).toBe(false);
      expect(ws?.uris.indexedCount).toBeGreaterThan(0);
      expect(ws?.uris.indexedCount).toBe(3);
      console.log(`Workspace ${ws.name} has ${ws.uris.indexedCount} indexed files.`);
      console.log(ws.toTreeString());
    });

    it('show tree sitter parse tree', () => {
      const ws = focusedWorkspace!;
      // expect(ws).toBeDefined();
      ws.showAllTreeSitterParseTrees();
    });
  });

  describe('check cleaned up success', () => {
    it('should have no workspaces left', () => {
      const excludeTestWorkspaces = ['test-setup', 'test-setup-2'];

      const workspacesPath = path.resolve('./tests/workspaces/');
      const folders = fs.readdirSync(workspacesPath)
        .filter(f => !!f.trim())
        .map(f => path.join(workspacesPath, f))
        .filter(f => SyncFileHelper.isDirectory(f))
        .map(f => f.split(path.sep).slice(-1)[0] || f);

      const badFolders: string[] = folders.filter(f => excludeTestWorkspaces.includes(f));
      expect(badFolders.length).toBe(0);
    });
  });
});
