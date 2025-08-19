import { TestWorkspace, TestFile } from './test-workspace-utils';
import * as fs from 'fs';
import * as path from 'path';

describe('Snapshot Functionality Tests', () => {
  let workspace: TestWorkspace;
  let snapshotPath: string;

  beforeAll(() => {
    workspace = TestWorkspace.create({ name: 'snapshot_test' })
      .addFiles(
        TestFile.function('test_func', 'function test_func\n  echo "test"\nend'),
        TestFile.completion('test_func', 'complete -c test_func -l help'),
        TestFile.config('set -g fish_greeting "Test config"'),
      );
    workspace.initialize();
  });

  it('should create a snapshot file', async () => {
    snapshotPath = workspace.writeSnapshot();

    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(snapshotPath).toContain('.snapshot');
    expect(snapshotPath).toContain('snapshot_test');
  });

  it('should contain valid JSON snapshot data', async () => {
    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    const snapshot = JSON.parse(snapshotContent);

    expect(snapshot.name).toBe('snapshot_test');
    expect(snapshot.files).toHaveLength(3);
    expect(snapshot.timestamp).toBeGreaterThan(0);

    // Check file structure
    const functionFile = snapshot.files.find((f: any) => f.relativePath === 'functions/test_func.fish');
    expect(functionFile).toBeDefined();
    expect(functionFile.content).toContain('function test_func');
  });

  it('should restore workspace file specs from snapshot', async () => {
    const restoredWorkspace = TestWorkspace.fromSnapshot(snapshotPath);

    expect(restoredWorkspace.name).toBe('snapshot_test');
    // Check that files were added correctly (before initialization)
    expect((restoredWorkspace as any)._files).toHaveLength(3);

    // Check file content is preserved
    const files = (restoredWorkspace as any)._files;
    const funcFile = files.find((f: any) => f.relativePath === 'functions/test_func.fish');
    expect(funcFile.content).toContain('function test_func');
  });

  it('should create snapshot with custom path', async () => {
    const customPath = path.join(__dirname, 'custom-snapshot.json');
    const customSnapshotPath = workspace.writeSnapshot(customPath);

    expect(customSnapshotPath).toBe(customPath);
    expect(fs.existsSync(customPath)).toBe(true);

    // Cleanup
    fs.unlinkSync(customPath);
  });

  afterAll(() => {
    // Cleanup snapshot
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }
  });
});
