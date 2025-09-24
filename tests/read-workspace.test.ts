import { TestWorkspace } from './test-workspace-utils';

describe('TestWorkspace', () => {
  describe('read workspace 1 from directory `workspace_1/fish`', () => {
    const ws = TestWorkspace.read('workspace_1/fish').initialize();

    it('should read files from the specified directory', () => {
      const docs = ws.documents;
      expect(docs.length).toBeGreaterThan(2);
      expect(docs.map(f => f.getRelativeFilenameToWorkspace())).toContain('config.fish');
    });
  });

  describe('read workspace 2 from directory `workspace_1`', () => {
    const ws = TestWorkspace.read('workspace_1').initialize();

    it('should read files from the specified directory', () => {
      const docs = ws.documents;
      expect(docs.length).toBeGreaterThan(2);
      expect(docs.map(f => f.getRelativeFilenameToWorkspace())).toContain('config.fish');
    });
  });

  describe('read workspace 3 from directory `workspace_1` w/config', () => {
    const ws = TestWorkspace.read({ folderPath: 'workspace_1' }).initialize();

    it('should read files from the specified directory', () => {
      const docs = ws.documents;
      expect(docs.length).toBeGreaterThan(2);
      expect(docs.map(f => f.getRelativeFilenameToWorkspace())).toContain('config.fish');
    });
  });
});

