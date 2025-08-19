import { TestWorkspace } from './test-workspace-utils';

describe('Single File Test Workspace - Working Examples', () => {
  describe('✅ Pattern 1: Create + Initialize', () => {
    const testData = TestWorkspace.createSingleFile(`
function greet
    echo "Hello, $argv[1]!"
end`);

    testData.workspace.initialize();

    it('should work perfectly', () => {
      expect(testData.document.getText()).toContain('function greet');
      expect(testData.document.uri).toContain('functions/');
      expect(testData.workspace.documents).toHaveLength(1);
    });

    it('should avoid null checks', () => {
      // No need for: if (document) { ... }
      expect(testData.document).toBeDefined();
      expect(testData.document.getText()).toBeTruthy();
    });
  });

  describe('✅ Pattern 2: createSingleFileReady (Async)', () => {
    it('should work with immediate initialization', async () => {
      const { document, workspace } = await TestWorkspace.createSingleFileReady(`
function calculate
    math $argv[1] + $argv[2]
end`);

      // Already initialized - no need to call workspace.initialize()
      expect(document.getText()).toContain('function calculate');
      expect(workspace.documents).toHaveLength(1);
      expect(workspace.getWorkspace()?.allDocuments().length).toBe(1);
    });

    it('should work with different file types', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        'complete -c mycommand -l help -d "Show help"',
        { type: 'completion', filename: 'mycommand' },
      );

      expect(document.getText()).toContain('complete -c mycommand');
      expect(document.uri).toContain('completions/mycommand.fish');
    });
  });

  describe('✅ Pattern 3: beforeAll with createSingleFileReady', () => {
    let testData: any;

    beforeAll(async () => {
      testData = await TestWorkspace.createSingleFileReady(
        'function test_func\n  echo "test"\nend',
        { filename: 'test_func' },
      );
    });

    it('document is immediately available', () => {
      expect(testData.document.getText()).toContain('function test_func');
      expect(testData.document.uri).toContain('test_func.fish');
    });

    it('workspace is fully analyzed', () => {
      const workspace_obj = testData.workspace.getWorkspace();
      expect(workspace_obj?.allDocuments().length).toBe(1);
    });
  });

  describe('✅ Easy Migration Examples', () => {
    it('replaces old createFakeLspDocument pattern', async () => {
      // OLD WAY (example):
      // const doc = createFakeLspDocument('test.fish', 'function foo\nend');
      // if (doc) {
      //   analyzer.analyze(doc);
      //   expect(doc.getText()).toContain('function foo');
      // }

      // NEW WAY:
      const { document } = await TestWorkspace.createSingleFileReady('function foo\nend');

      // No null checks needed!
      expect(document.getText()).toContain('function foo');
    });

    it('handles complex multiline content', async () => {
      const { document } = await TestWorkspace.createSingleFileReady([
        'function complex_function',
        '    set -l local_var "value"',
        '    if test -n "$argv[1]"',
        '        echo "Argument: $argv[1]"',
        '    else',
        '        echo "No argument provided"',
        '    end',
        'end',
      ]);

      const text = document.getText();
      expect(text).toContain('function complex_function');
      expect(text).toContain('set -l local_var');
      expect(text).toContain('if test -n');
    });
  });

  describe('✅ All File Types Work', () => {
    it('creates function files (default)', async () => {
      const { document } = await TestWorkspace.createSingleFileReady('function test\nend');
      expect(document.uri).toContain('functions/');
    });

    it('creates completion files', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        'complete -c cmd -l help',
        { type: 'completion', filename: 'cmd' },
      );
      expect(document.uri).toContain('completions/cmd.fish');
    });

    it('creates config files', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        'set -g fish_greeting "Hi!"',
        { type: 'config' },
      );
      expect(document.uri).toContain('config.fish');
    });

    it('creates conf.d files', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        'function init --on-event fish_prompt\nend',
        { type: 'confd', filename: 'init' },
      );
      expect(document.uri).toContain('conf.d/init.fish');
    });

    it('creates script files', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        '#!/usr/bin/env fish\necho "script"',
        { type: 'script', filename: 'deploy' },
      );
      expect(document.uri).toContain('deploy.fish');
      expect(document.uri).not.toContain('functions/');
    });
  });

  describe('✅ Options and Customization', () => {
    it('respects custom filenames', async () => {
      const { document } = await TestWorkspace.createSingleFileReady(
        'function my_func\nend',
        { filename: 'my_func' },
      );
      expect(document.uri).toContain('my_func.fish');
    });

    it('respects custom workspace names', async () => {
      const { workspace } = await TestWorkspace.createSingleFileReady(
        'function test\nend',
        { workspaceName: 'custom_workspace' },
      );
      expect(workspace.name).toMatch(/^custom_workspace(_\d+)?$/);
    });

    it('generates random names when not specified', async () => {
      const { document, workspace } = await TestWorkspace.createSingleFileReady('function test\nend');

      expect(document.uri).toMatch(/test_.*\.fish$/);
      expect(workspace.name).toMatch(/single_file_test_.*$/);
    });
  });
});
