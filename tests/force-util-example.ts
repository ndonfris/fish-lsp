// Example usage of the new forceUtil() API

import TestWorkspace, { TestFile } from './workspace-util';

// Create a workspace for force operations
const workspace = TestWorkspace.create('force_example')
  .add(
    TestFile.function('example', 'function example\n  echo "Hello"\nend'),
    TestFile.completion('example', 'complete -c example -l help'),
  );

// Get the force utility object
const util = workspace.forceUtil();

// Example 1: Synchronous initialization (fast, no async/await needed)
console.log('=== Sync Initialization ===');
util.initialize(); // or util.initializeSync()
console.log('Documents:', workspace.documents.length);

// Example 2: Create snapshot
console.log('=== Snapshot ===');
const snapshotPath = util.snapshot();
console.log('Snapshot saved to:', snapshotPath);

// Example 3: Reset and reinitialize
console.log('=== Reset and Reinitialize ===');
util.reset();
console.log('After reset, initialized:', workspace.initialized);
util.initialize();
console.log('After reinit, initialized:', workspace.initialized);

// Example 4: Async initialization (if you need full analysis)
console.log('=== Async Initialization ===');
async function testAsync() {
  util.reset();
  await util.initializeAsync();
  console.log('Async init complete, documents:', workspace.documents.length);
}

// Example 5: Enable inspection mode and clean removal
console.log('=== Inspection and Cleanup ===');
util.inspect(); // Prevents automatic cleanup
util.remove(); // Force remove with state reset

// Chain operations
TestWorkspace.create('chain_example')
  .add(TestFile.function('chain', 'function chain; echo "chained"; end'))
  .forceUtil()
  .initialize()
  .snapshot();

export { workspace, util };
