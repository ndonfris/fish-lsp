import { TestWorkspace, TestFile } from './test-workspace-utils';

describe('Unified API Refactored', () => {
  describe('Single file with new unified API', () => {
    const workspace = TestWorkspace.createSingle('function greet\n  echo "hello"\nend', 'function', 'greet');
    workspace.setupWithFocus();

    it('should have focused document access', () => {
      const doc = workspace.focusedDocument;
      expect(doc).toBeDefined();
      expect(doc?.getText()).toContain('function greet');
    });

    it('should work like regular workspace too', () => {
      const docs = workspace.documents;
      expect(docs).toHaveLength(1);

      const foundDoc = workspace.getDocument('greet.fish');
      expect(foundDoc).toBeDefined();
      expect(foundDoc?.getText()).toContain('function greet');
    });
  });

  describe('Multi-file with focus', () => {
    const workspace = TestWorkspace.create({ name: 'multi_with_focus' })
      .addFiles(
        TestFile.function('main', 'function main\n  echo "main"\nend'),
        TestFile.completion('main', 'complete -c main -l help'),
      )
      .focus('functions/main.fish');

    workspace.setup();

    it('should have focused document', () => {
      const doc = workspace.focusedDocument;
      expect(doc?.getText()).toContain('function main');
    });

    it('should have all documents', () => {
      expect(workspace.documents).toHaveLength(2);
    });
  });

  describe('Traditional multi-file usage (unchanged)', () => {
    const workspace = TestWorkspace.create({ name: 'traditional' })
      .addFiles(
        TestFile.function('func1', 'function func1\nend'),
        TestFile.function('func2', 'function func2\nend'),
      );

    workspace.setup();

    it('should work exactly as before', () => {
      expect(workspace.documents).toHaveLength(2);
      expect(workspace.focusedDocument).toBeNull(); // No focus set

      const func1 = workspace.getDocument('func1.fish');
      expect(func1?.getText()).toContain('function func1');
    });
  });
});
