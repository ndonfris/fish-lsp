import { TestWorkspace, TestFile, Query, TestWorkspaceResult } from './test-workspace-utils';

describe('Unified Test Workspace API', () => {
  describe('API consistency without initialization timing issues', () => {
    it('single file and multi-file workspaces provide consistent API', async () => {
      // Single file approach
      const singleFileResult = await TestWorkspace.createSingleFileReady('function test_func\n  echo "test"\nend');

      // Multi-file approach - we need to test this differently
      const multiFileWorkspace = TestWorkspace.create()
        .addFile(TestFile.function('test_func', 'function test_func\n  echo "test"\nend'));

      // Both should provide the same API methods
      expect(typeof singleFileResult.getDocument).toBe('function');
      expect(typeof singleFileResult.getDocuments).toBe('function');
      expect(Array.isArray(singleFileResult.documents)).toBe(true);

      expect(typeof multiFileWorkspace.getDocument).toBe('function');
      expect(typeof multiFileWorkspace.getDocuments).toBe('function');
      expect(Array.isArray(multiFileWorkspace.documents)).toBe(true);

      // Single file should work immediately
      const singleDoc = singleFileResult.getDocument('test_func.fish');
      expect(singleDoc).toBeDefined();
      expect(singleDoc!.getText()).toContain('function test_func');

      // Multi-file workspace needs initialization to work (that's expected)
      expect(multiFileWorkspace.documents).toHaveLength(0); // Before initialization
    });

    it('asResult() method provides unified interface', async () => {
      const workspace = TestWorkspace.create()
        .addFiles(
          TestFile.function('func1', 'function func1\nend'),
          TestFile.completion('func1', 'complete -c func1 -l help'),
        );
      workspace.initialize();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = workspace.asResult();

      // Should have all TestWorkspaceResult methods
      expect(typeof result.getDocument).toBe('function');
      expect(typeof result.getDocuments).toBe('function');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.workspace).toBe(workspace);

      // Should work the same as direct workspace methods
      expect(result.getDocument('func1.fish')).toBe(workspace.getDocument('func1.fish'));
      expect(result.getDocuments(Query.functions())).toEqual(workspace.getDocuments(Query.functions()));
    });

    it('unified API works with polymorphic function usage', async () => {
      // Function that accepts either single-file or multi-file result
      function analyzeWorkspace(result: TestWorkspaceResult): number {
        const functions = result.getDocuments(Query.functions());
        const completions = result.getDocuments(Query.completions());
        return functions.length + completions.length;
      }

      // Single file workspace
      const singleFile = await TestWorkspace.createSingleFileReady('function test\nend');

      // Multi-file workspace
      const multiFile = TestWorkspace.create()
        .addFiles(
          TestFile.function('test1', 'function test1\nend'),
          TestFile.completion('test1', 'complete -c test1'),
        );
      multiFile.initialize();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      // Both should work with the same function
      expect(analyzeWorkspace(singleFile)).toBe(1); // 1 function, 0 completions
      expect(analyzeWorkspace(multiFile.asResult())).toBe(2); // 1 function, 1 completion
    });

    it('query system works consistently across both approaches', async () => {
      // Create similar workspaces using both approaches
      const singleFile = await TestWorkspace.createSingleFileReady(
        'complete -c mycommand -l help',
        { type: 'completion', filename: 'mycommand' },
      );

      const multiFile = TestWorkspace.create()
        .addFile(TestFile.completion('mycommand', 'complete -c mycommand -l help'));
      multiFile.initialize();

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      // Query results should be equivalent
      const singleCompletions = singleFile.getDocuments(Query.completions());
      const multiCompletions = multiFile.getDocuments(Query.completions());

      expect(singleCompletions).toHaveLength(1);
      expect(multiCompletions).toHaveLength(1);
      expect(singleCompletions[0]?.getText()).toContain('complete -c mycommand');
      expect(multiCompletions[0]?.getText()).toContain('complete -c mycommand');
    });
  });

  describe('Type safety improvements', () => {
    it('provides better type inference', async () => {
      const result = await TestWorkspace.createSingleFileReady('function test\nend');

      // TypeScript should infer these correctly
      const doc: typeof result.document = result.document;
      const docs: typeof result.documents = result.documents;
      const workspace: typeof result.workspace = result.workspace;

      expect(doc).toBeDefined();
      expect(Array.isArray(docs)).toBe(true);
      expect(workspace).toBeDefined();
    });

    it('maintains backward compatibility', async () => {
      // Old usage pattern should still work
      const { document, workspace } = await TestWorkspace.createSingleFileReady('function test\nend');

      expect(document.getText()).toContain('function test');
      expect(workspace.documents).toHaveLength(1);

      // New usage pattern should also work
      const result = await TestWorkspace.createSingleFileReady('function test2\nend');
      const doc = result.getDocument('test2.fish');
      const docs = result.getDocuments(Query.functions());

      expect(doc?.getText()).toContain('function test2');
      expect(docs).toHaveLength(1);
    });
  });
});
