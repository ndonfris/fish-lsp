/**
 * Test build() and delete() methods for direct workspace control
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { TestWorkspace, TestFile } from './test-workspace-utils';

describe('Build and Delete Methods', () => {
  it('should build workspace synchronously for immediate use', () => {
    const workspace = TestWorkspace.create() // Use generated name to avoid conflicts
      .addFile(TestFile.function('build_test', 'function build_test\n  echo "built"\nend'));

    // Build synchronously
    workspace.buildSync();

    // Workspace should now exist
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(workspace.documents.length).toBe(1);
    expect(workspace.getDocument('build_test.fish')).toBeDefined();

    // Clean up
    workspace.deleteSync();
    expect(fs.existsSync(workspace.path)).toBe(false);
  });

  it('should build workspace asynchronously', async () => {
    const workspace = TestWorkspace.create()
      .addFile(TestFile.function('async_test', 'function async_test\n  echo "async"\nend'));

    // Build asynchronously
    await workspace.build();

    // Workspace should now exist
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(workspace.documents.length).toBe(1);
    expect(workspace.getDocument('async_test.fish')).toBeDefined();

    // Clean up
    await workspace.delete();
    expect(fs.existsSync(workspace.path)).toBe(false);
  });

  it('should handle multiple build calls gracefully', () => {
    const workspace = TestWorkspace.create()
      .addFile(TestFile.function('multi_test', 'function multi_test\n  echo "multi"\nend'));

    // First build
    workspace.buildSync();
    expect(fs.existsSync(workspace.path)).toBe(true);

    const initialDocCount = workspace.documents.length;

    // Second build should not duplicate
    workspace.buildSync();
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(workspace.documents.length).toBe(initialDocCount);

    // Clean up
    workspace.deleteSync();
  });

  it('should allow rebuild after delete', async () => {
    const workspace = TestWorkspace.create()
      .addFile(TestFile.function('rebuild', 'function rebuild\n  echo "rebuild"\nend'));

    // Build, delete, rebuild cycle
    await workspace.build();
    expect(fs.existsSync(workspace.path)).toBe(true);

    await workspace.delete();
    expect(fs.existsSync(workspace.path)).toBe(false);

    await workspace.build();
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(workspace.documents.length).toBe(1);

    // Final cleanup
    await workspace.delete();
  });

  it('should demonstrate manual control in test context', () => {
    const workspace = TestWorkspace.create()
      .addFiles(
        TestFile.function('func1', 'function func1\n  echo "func1"\nend'),
        TestFile.completion('func1', 'complete -c func1 -l help'),
      );

    // Manual build
    workspace.buildSync();

    // Verify setup
    expect(fs.existsSync(workspace.path)).toBe(true);
    expect(workspace.documents.length).toBe(2);

    const documents = workspace.getDocuments();
    expect(documents.length).toBe(2);

    // Manual cleanup when we're done with this specific workspace
    workspace.deleteSync();
    expect(fs.existsSync(workspace.path)).toBe(false);
  });

  it('should work with manual lifecycle management', async () => {
    const testWorkspace = TestWorkspace.create()
      .addFile(TestFile.function('lifecycle', 'function lifecycle\n  echo "lifecycle"\nend'));

    // Manual build
    await testWorkspace.build();

    // The test itself just uses the pre-built workspace
    expect(fs.existsSync(testWorkspace.path)).toBe(true);
    expect(testWorkspace.documents.length).toBe(1);
    expect(testWorkspace.getDocument('lifecycle.fish')).toBeDefined();

    // Manual cleanup
    await testWorkspace.delete();
    expect(fs.existsSync(testWorkspace.path)).toBe(false);
  });

  it('should handle delete of non-existent workspace gracefully', async () => {
    const workspace = TestWorkspace.create()
      .addFile(TestFile.function('test', 'function test\nend'));

    // Try to delete without building - should not throw
    await workspace.delete();
    workspace.deleteSync();

    // These should complete without errors
    expect(true).toBe(true);
  });
});
