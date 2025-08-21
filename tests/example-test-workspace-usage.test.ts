import { workspaceManager } from '../src/utils/workspace-manager';
import { setLogger } from './helpers';
import { TestWorkspace, TestFile, Query, DefaultTestWorkspaces, focusedWorkspace } from './test-workspace-utils';

describe('Example Test Workspace Usage', () => {
  describe('Basic Usage Example', () => {
    const testWorkspace = TestWorkspace.create({ name: 'example_basic' })
      .addFiles(
        TestFile.function('greet', `
function greet
    echo "Hello, $argv[1]!"
end`),
        TestFile.completion('greet', `
complete -c greet -a "(ls)"
complete -c greet -l help -d "Show help"`),
        TestFile.config(`
set -g fish_greeting "Welcome to test!"
set -gx PATH $PATH /usr/local/test/bin`),
        TestFile.confd('setup', `
function setup_test --on-event fish_prompt
    if not set -q test_loaded
        set -g test_loaded true
        echo "Test environment loaded"
    end
end`),
      );

    testWorkspace.setup();

    it('should create all expected documents', () => {
      expect(focusedWorkspace?.allDocuments.length).toBe(4);
    });

    it('should find documents by simple path', () => {
      const greetFunc = testWorkspace.getDocument('functions/greet.fish');
      expect(greetFunc).toBeDefined();
      expect(greetFunc?.getText()).toContain('function greet');
    });

    it('should support advanced querying', () => {
      // Get all function files
      const functions = focusedWorkspace!.allDocuments().filter(d => d.getAutoloadType() === 'functions');
      expect(functions.length).toBeGreaterThanOrEqual(1);
      expect(functions[0]!.getText()).toContain('function greet');

      // Get files by name across types
      const greetFiles = testWorkspace.getDocuments(Query.withName('greet'));
      expect(greetFiles).toHaveLength(2); // function and completion

      // Get first autoloaded file
      const firstAutoloaded = testWorkspace.getDocuments(Query.firstMatch().autoloaded());
      expect(firstAutoloaded).toHaveLength(1);

      // Complex query: functions and completions with specific name
      const specificFiles = testWorkspace.getDocuments(
        Query.functions().withName('greet'),
        Query.completions().withName('greet'),
      );
      expect(specificFiles).toHaveLength(2);
    });

    it('should provide workspace analysis', () => {
      const workspace = testWorkspace.getWorkspace();
      expect(workspace).toBeDefined();
      expect(workspace?.allDocuments().length).toBeGreaterThan(0);
    });

    it('should support live file editing', () => {
      const originalDoc = testWorkspace.getDocument('functions/greet.fish');
      const originalContent = originalDoc?.getText();

      testWorkspace.editFile('functions/greet.fish', `
function greet
    echo "Hello there, $argv[1]!"
    echo "Nice to meet you!"
end`);

      const updatedDoc = testWorkspace.getDocument('functions/greet.fish');
      expect(updatedDoc?.getText()).toContain('Hello there');
      expect(updatedDoc?.getText()).not.toBe(originalContent);
    });
  });

  describe('Using Predefined Workspaces', () => {
    const basicWorkspace = DefaultTestWorkspaces.basicFunctions();
    basicWorkspace.setup();

    it('should work with predefined basic functions workspace', () => {
      expect(basicWorkspace.documents.length).toBeGreaterThan(2);

      const greetFunc = basicWorkspace.getDocument('greet.fish');
      expect(greetFunc).toBeDefined();

      const addFunc = basicWorkspace.getDocument('add.fish');
      expect(addFunc).toBeDefined();
    });
  });

  describe('Advanced Features', () => {
    // should log
    const advancedWorkspace = TestWorkspace.create({
      name: 'example_advanced',
      // debug: true,
    }).addFiles(
      TestFile.script('deploy', `
#!/usr/bin/env fish
echo "Deploying application..."
# Deploy logic here`).withShebang(),
      TestFile.function('helper', `
function helper
    echo "Helper function"
end`),
    );

    advancedWorkspace.setup();

    it('should handle scripts with shebangs', () => {
      const deployScript = advancedWorkspace.getDocument('deploy.fish');
      expect(deployScript?.getText()).toContain('#!/usr/bin/env fish');
    });

    it('should support workspace inspection', () => {
      const fileTree: string = focusedWorkspace!.allDocuments().map(doc => [doc.getRelativeFilenameToWorkspace(), doc.getTree()].join('\n')).join('\n');
      expect(fileTree).toContain('deploy.fish');
      expect(fileTree).toContain('functions');
    });

    it('should create snapshots', () => {
      const snapshotPath = advancedWorkspace.writeSnapshot();
      expect(snapshotPath).toContain('.snapshot');

      // Test loading from snapshot
      const restoredWorkspace = TestWorkspace.fromSnapshot(snapshotPath);
      expect(restoredWorkspace.name).toBe('example_advanced');
    });
  });

  describe('Complex Project Simulation', () => {
    const projectWorkspace = DefaultTestWorkspaces.projectWorkspace();
    projectWorkspace.setup();

    it('should simulate a complete project structure', () => {
      expect(projectWorkspace.documents.length).toBeGreaterThan(5);

      // Check for build function
      const buildFunc = projectWorkspace.getDocument('build.fish');
      expect(buildFunc?.getText()).toContain('Building project');

      // Check for install script
      const installScript = projectWorkspace.getDocument('install.fish');
      expect(installScript?.getText()).toContain('#!/usr/bin/env fish');

      // Use queries to get different file types
      const functions = projectWorkspace.getDocuments(Query.functions());
      const completions = projectWorkspace.getDocuments(Query.completions());
      const scripts = projectWorkspace.getDocuments(Query.scripts());

      expect(functions.length).toBeGreaterThan(2);
      expect(completions.length).toBeGreaterThan(1);
      expect(scripts.length).toBeGreaterThan(0);

      // Verify workspace analysis
      const workspace = projectWorkspace.getWorkspace();
      expect(workspace?.allDocuments().length).toBeGreaterThan(5);
    });
  });

  describe('test 3', () => {
    TestWorkspace.create({ name: 'example_test3' })
      .addFiles(
        TestFile.function('test3', `
function test3
echo "This is test 3"
end`),
        TestFile.completion('test3', `
complete -c test3 -a "(ls)"
complete -c test3 -l help -d "Show help"`),
        TestFile.config(`
set -g fish_greeting "Welcome to test 3!"
set -gx PATH $PATH /usr/local/test3/bin`),
        TestFile.confd('setup_test3', `
function setup_test3 --on-event fish_prompt
if not set -q test3_loaded
set -g test3_loaded true
echo "Test 3 environment loaded"
end
end`),
        TestFile.custom('test3_script_1', `
echo "Running test 3 script..."
set -gx file_path test3_script_1
`).withShebang(),
        TestFile.custom('test3_script_2', `
function run_2;
  echo "Running test 3 script...";
end`).withShebang(),
        TestFile.custom('test3_script_3', `
source ./test3_script_1
source ./test3_script_2
`).withShebang(),
      )
      .setup();

    it('should create all expected documents for test 3', () => {
      const docs = focusedWorkspace!.allDocuments();
      expect(docs!.length).toBe(7);
    });

    it('should find documents by simple path in test 3', () => {
      const test3Func = focusedWorkspace!.findDocument(d => d.uri.endsWith('functions/test3.fish'));
      expect(test3Func).toBeDefined();
      expect(test3Func?.getText()).toContain('function test3');
    });

    it('show file tree', () => {
      const output: string[] = [];
      focusedWorkspace!.allDocuments().forEach(doc => {
        output.push(doc.getRelativeFilenameToWorkspace());
        output.push(doc.getText());
        output.push(doc.getTree());
      });
      const res = output.join('\n');
      // const fileTree = focusedWorkspace!.showAllTreeSitterParseTrees();
      // console.log(fileTree);
      expect(res).toContain('test3.fish');
      expect(res).toContain('test3_script_1');
      expect(res).toContain('test3_script_2');
      expect(res).toContain('test3_script_3');
      expect(res).not.toContain('test3_script_1.fish');
      expect(res).not.toContain('test3_script_2.fish');
      expect(res).not.toContain('test3_script_3.fish');
    });
  });

  describe('test workspace src', () => {
    const testSrcWorkspace = TestWorkspace.create({ name: 'example_test_src' })
      .addFiles(
        TestFile.function('src_test', `
function src_test
    echo "This is a src test function"
end`),
      ).inheritFilesFromExistingAutoloadedWorkspace('$__fish_data_dir');

    testSrcWorkspace.setup();

    // setLogger();

    it('should create all expected documents for src test', () => {
      const ws = focusedWorkspace!;
      // Array.from(ws!.allUris).forEach(uri => {
      //   console.log(`URI: ${uri}`);
      // })
      console.log(`len: ${ws?.allDocuments().length}`);
      testSrcWorkspace.addDocument(
        TestFile.function('src_test2', 'function src_test2; echo "This is src test 2"; end'),
      );
      expect(testSrcWorkspace.documents.length).toBeGreaterThan(1);
      workspaceManager.setCurrent(testSrcWorkspace.getWorkspace()!);
      console.log(`workspaceManager: ${workspaceManager.current?.allDocuments().length}`);
    });

    it('should create all expected documents for src test2', () => {
      const ws = testSrcWorkspace.getWorkspace();

      // testSrcWorkspace.getDocuments.forEach(workspace => {
      //   console.log(`Workspace: ${workspace.name}, Documents: ${workspace.documents.length}`);
      // });
      // Array.from(ws!.allUris).forEach(uri => {
      //   console.log(`URI: ${uri}`);
      // })
      console.log(`len: ${ws?.allDocuments().length}`);
      expect(testSrcWorkspace.documents.length).toBeGreaterThan(1);
      workspaceManager.setCurrent(testSrcWorkspace.getWorkspace()!);
      console.log(`workspaceManager: ${workspaceManager.current?.allDocuments().length}`);
      testSrcWorkspace.writeSnapshot();
    });
  });
});
