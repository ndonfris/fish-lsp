import { TestWorkspace, TestFile, Query } from './test-workspace-utils';

describe('Unified API - Simple Tests', () => {
  describe('Single File Workspace API', () => {
    it('provides consistent interface methods', async () => {
      const result = await TestWorkspace.createSingleFileReady('function test_func\n  echo "test"\nend');

      // Should have all the required interface methods
      expect(typeof result.getDocument).toBe('function');
      expect(typeof result.getDocuments).toBe('function');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.workspace).toBeDefined();

      // Should find the document correctly
      const doc = result.getDocument('test_func.fish');
      expect(doc).toBeDefined();
      expect(doc!.getText()).toContain('function test_func');

      // Should work with queries
      const functions = result.getDocuments(Query.functions());
      expect(functions).toHaveLength(1);
      expect(functions[0]!.getText()).toContain('function test_func');
    });

    it('works with different file types', async () => {
      const completion = await TestWorkspace.createSingleFileReady(
        'complete -c mycommand -l help',
        { type: 'completion', filename: 'mycommand' },
      );

      // Should find completion file
      const doc = completion.getDocument('mycommand.fish');
      expect(doc).toBeDefined();
      expect(doc!.getText()).toContain('complete -c mycommand');

      // Should work with completion queries
      const completions = completion.getDocuments(Query.completions());
      expect(completions).toHaveLength(1);
    });
  });

  describe('TestWorkspace asResult() method', () => {
    const workspace = TestWorkspace.create({ name: 'test_as_result' })
      .addFiles(
        TestFile.function('func1', 'function func1\nend'),
        TestFile.completion('func1', 'complete -c func1 -l help'),
      );

    workspace.initialize();

    it('provides unified interface', async () => {
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = workspace.asResult();

      // Should have all interface methods
      expect(typeof result.getDocument).toBe('function');
      expect(typeof result.getDocuments).toBe('function');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.workspace).toBe(workspace);

      // Methods should delegate to workspace
      const wsDoc = workspace.getDocument('func1.fish');
      const resultDoc = result.getDocument('func1.fish');
      expect(resultDoc).toBe(wsDoc);
    });
  });

  describe('Backwards compatibility', () => {
    it('old destructuring pattern still works', async () => {
      const { document, workspace } = await TestWorkspace.createSingleFileReady('function test\nend');

      expect(document.getText()).toContain('function test');
      expect(workspace.documents).toHaveLength(1);
    });

    it('new unified pattern also works', async () => {
      const result = await TestWorkspace.createSingleFileReady('function test2\nend');

      const doc = result.getDocument('test2.fish');
      const docs = result.getDocuments(Query.functions());

      expect(doc?.getText()).toContain('function test2');
      expect(docs).toHaveLength(1);
    });
  });

  describe('Type consistency demonstration', () => {
    it('can be used polymorphically', async () => {
      // Function that works with any TestWorkspaceResult
      function countFiles(result: any): number {
        return result.documents.length;
      }

      const singleFile = await TestWorkspace.createSingleFileReady('function test\nend');

      expect(countFiles(singleFile)).toBe(1);
    });
  });
});
