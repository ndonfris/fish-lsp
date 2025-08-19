# Test Workspace Utilities

A comprehensive framework for creating and managing temporary fish shell workspaces in tests. Ensures test fish files behave exactly like production usage by integrating with the same analysis pipeline used by the language server.

## Quick Start - Single File (Recommended)

```typescript
import { TestWorkspace } from './test-workspace-utils';

describe('My Test', () => {
  // Pattern 1: Simple with initialize()
  const { document, workspace } = TestWorkspace.createSingleFile('function greet\n  echo "Hello!"\nend');
  workspace.initialize();
  
  it('should work', () => {
    expect(document.getText()).toContain('function greet'); // No null checks needed!
  });
  
  // Pattern 2: Async ready (for beforeAll)
  beforeAll(async () => {
    testData = await TestWorkspace.createSingleFileReady('function test\nend');
  });
});
```

## Multi-File Workspaces

```typescript
import { TestWorkspace, TestFile, Query } from './test-workspace-utils';

describe('Complex Test', () => {
  const workspace = TestWorkspace.create()
    .addFiles(
      TestFile.function('greet', 'function greet\n  echo "Hello, $argv[1]!"\nend'),
      TestFile.completion('greet', 'complete -c greet -l help')
    );
  
  workspace.initialize(); // Handles beforeAll/afterAll automatically
  
  it('should find documents', () => {
    const doc = workspace.getDocument('greet.fish');
    expect(doc).toBeDefined();
  });
});
```

## Features

### 🚀 Single File Utilities (NEW!)
- `TestWorkspace.createSingleFile(content, options?)` - Create single file workspace with lazy document access
- `TestWorkspace.createSingleFileReady(content, options?)` - Async version that's immediately ready to use
- **Zero null checks** - Document is guaranteed to exist after initialization
- **Random name generation** - Automatic unique filenames and workspace names
- **All file types supported** - functions, completions, config, conf.d, scripts

### 🏗️ Multi-File TestWorkspace Class
- **Automated lifecycle management** with Jest hooks
- **Unique name generation** to prevent conflicts  
- **Production-identical analysis** workflow
- **Workspace inheritance** from existing directories

### 📁 TestFile Helpers
- `TestFile.function(name, content)` - Function files
- `TestFile.completion(name, content)` - Completion files  
- `TestFile.config(content)` - config.fish files
- `TestFile.confd(name, content)` - conf.d files
- `TestFile.script(name, content)` - Script files
- `TestFile.custom(path, content)` - Custom paths
- `.withShebang()` - Add shebang lines

### 🔍 Advanced Querying
```typescript
// Get documents using the query system
workspace.getDocuments(
  Query.functions().withName('foo'),        // functions/foo.fish
  Query.completions().withName('foo'),      // completions/foo.fish
  Query.firstMatch().autoloaded(),          // First autoloaded file
  Query.withPath('functions/', 'scripts/')  // Files in specific dirs
);
```

### ⚡ Live Editing
```typescript
workspace.editFile('functions/foo.fish', 'new content'); // Triggers re-analysis
```

### 🔧 Debugging & Utilities
- `workspace.inspect()` - Prevent cleanup for debugging
- `workspace.dumpFileTree()` - Visual file structure
- `workspace.writeSnapshot()` - Save workspace state
- `TestLogger.setSilent(true)` - Control log output

### 📦 Predefined Workspaces
- `DefaultTestWorkspaces.basicFunctions()` - Simple function testing
- `DefaultTestWorkspaces.complexFunctions()` - Function interactions
- `DefaultTestWorkspaces.configAndEvents()` - Config & event handlers  
- `DefaultTestWorkspaces.projectWorkspace()` - Real project simulation

## Example Usage

See `tests/example-test-workspace-usage.test.ts` for comprehensive examples demonstrating all features.

## Integration

The utility automatically integrates with:
- `Analyzer` - For document analysis
- `workspaceManager` - For workspace management
- `documents` - For document state management
- `LspDocument` - For document creation and manipulation

All temporary files are automatically cleaned up after tests complete, unless you call `workspace.inspect()` to prevent cleanup for debugging purposes.