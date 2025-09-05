import { vi, describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createFakeLspDocument, setLogger, createTestWorkspace } from './helpers';
import { analyzer, Analyzer } from '../src/analyze';
import { documents, LspDocument } from '../src/document';
import { workspaceManager } from '../src/utils/workspace-manager';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import FishServer from '../src/server';
import * as LSP from 'vscode-languageserver';
import { createServerLogger } from '../src/logger';
import * as startupModule from '../src/utils/startup';
import { uriToPath, pathToUri } from '../src/utils/translation';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { initializeCompletionPager } from '../src/utils/completion/pager';
import { initializeDocumentationCache } from '../src/utils/documentation-cache';
import { initializeDefaultFishWorkspaces } from '../src/utils/workspace';
import { Config } from '../src/config';
import { URI } from 'vscode-uri';

// Mock connection for web/virtual scenarios
function createMockBrowserConnection() {
  return {
    listen: vi.fn(),
    onInitialize: vi.fn(),
    onInitialized: vi.fn(),
    onShutdown: vi.fn(),
    onDidOpenTextDocument: vi.fn(),
    onDidChangeTextDocument: vi.fn(),
    onDidCloseTextDocument: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    onCompletion: vi.fn(),
    onCompletionResolve: vi.fn(),
    onDocumentSymbol: vi.fn(),
    onWorkspaceSymbol: vi.fn(),
    onWorkspaceSymbolResolve: vi.fn(),
    onDefinition: vi.fn(),
    onImplementation: vi.fn(),
    onReferences: vi.fn(),
    onHover: vi.fn(),
    onRenameRequest: vi.fn(),
    onDocumentFormatting: vi.fn(),
    onDocumentRangeFormatting: vi.fn(),
    onDocumentOnTypeFormatting: vi.fn(),
    onCodeAction: vi.fn(),
    onCodeLens: vi.fn(),
    onFoldingRanges: vi.fn(),
    onDocumentHighlight: vi.fn(),
    languages: { inlayHint: { on: vi.fn() } },
    onSignatureHelp: vi.fn(),
    onExecuteCommand: vi.fn(),
    sendDiagnostics: vi.fn(),
    window: {
      createWorkDoneProgress: vi.fn().mockResolvedValue({
        begin: vi.fn(),
        report: vi.fn(),
        done: vi.fn(),
      }),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
    },
    workspace: {
      onDidChangeWorkspaceFolders: vi.fn(),
    },
    console: {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
    dispose: vi.fn(),
  } as unknown as LSP.Connection;
}

describe('Virtual Fish File Handling', () => {
  let mockConnection: LSP.Connection;

  beforeAll(async () => {
    setLogger();
    await initializeParser();
    await setupProcessEnvExecFile();
  });

  beforeEach(async () => {
    mockConnection = createMockBrowserConnection();
    documents.clear();
    workspaceManager.clear();
    await Analyzer.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
    documents.clear();
    workspaceManager.clear();
  });

  describe('Virtual URI Schemes', () => {
    it('should handle https://file.fish URIs', async () => {
      const virtualUri = 'https://example.com/virtual.fish';
      const fishCode = `
function hello_world
    echo "Hello from virtual file!"
end
`.trim();

      // Test that we can create a document with a virtual URI
      const doc = LspDocument.createTextDocumentItem(virtualUri, fishCode);
      expect(doc).toBeDefined();
      expect(doc.uri).toBe(virtualUri);
      expect(doc.getText()).toBe(fishCode);

      // Add to documents collection
      documents.set(doc);
      const retrievedDoc = documents.getDocument(virtualUri);
      expect(retrievedDoc).toBeDefined();
      expect(retrievedDoc?.uri).toBe(virtualUri);
    });

    it('should handle data: URIs for fish content', async () => {
      const fishCode = 'function test\n    echo "test"\nend';
      const dataUri = `data:text/fish;base64,${Buffer.from(fishCode).toString('base64')}`;

      // Simulate creating document from data URI
      const doc = LspDocument.createTextDocumentItem(dataUri, fishCode);
      expect(doc.uri).toBe(dataUri);
      expect(doc.getText()).toBe(fishCode);

      // Test analysis works on virtual content
      const analyzedDoc = analyzer.analyze(doc);
      expect(analyzedDoc).toBeDefined();
      expect(analyzedDoc.document.uri).toBe(dataUri);
    });

    it('should handle untitled: URIs for temporary fish files', async () => {
      const untitledUri = 'untitled:Untitled-1.fish';
      const fishCode = `
set -l var_name "value"
echo $var_name
`.trim();

      const doc = LspDocument.createTextDocumentItem(untitledUri, fishCode);
      expect(doc.uri).toBe(untitledUri);

      // Test that symbols can be extracted from virtual content
      const analyzedDoc = analyzer.analyze(doc);
      const symbols = analyzer.getDocumentSymbols(doc.uri);
      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThan(0);
    });
  });

  describe('Server Virtual File Support', () => {
    it('should create web server that handles virtual files', async () => {
      const virtualParams: LSP.InitializeParams = {
        processId: null,
        rootUri: null,
        rootPath: null,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: true } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
          },
          workspace: { workspaceFolders: true },
        },
        initializationOptions: {},
        workspaceFolders: null,
      };

      const { server, initializeResult } = await FishServer.createWebServer({
        connection: mockConnection,
        params: virtualParams,
      });

      expect(server).toBeDefined();
      expect(initializeResult).toBeDefined();
      expect(initializeResult.capabilities).toBeDefined();
      expect(initializeResult.capabilities.textDocumentSync).toBeDefined();
      expect(initializeResult.capabilities.completionProvider).toBeDefined();
      expect(initializeResult.capabilities.hoverProvider).toBeDefined();
    });

    it('should handle didOpenTextDocument with virtual URI', async () => {
      const { server } = await FishServer.createWebServer({
        connection: mockConnection,
        params: {
          processId: null,
          rootUri: null,
          rootPath: null,
          capabilities: {},
          initializationOptions: {},
          workspaceFolders: null,
        },
      });

      const virtualUri = 'https://example.com/test.fish';
      const fishContent = 'function virtual_func\n    echo "hello"\nend';

      const openParams: LSP.DidOpenTextDocumentParams = {
        textDocument: {
          uri: virtualUri,
          languageId: 'fish',
          version: 1,
          text: fishContent,
        },
      };

      // This should not throw and should handle the virtual file
      await expect(server.didOpenTextDocument(openParams)).resolves.not.toThrow();

      // Verify document was added
      const doc = documents.getDocument(virtualUri);
      expect(doc).toBeDefined();
      expect(doc?.getText()).toBe(fishContent);
    });

    it('should provide completions for virtual files', async () => {
      const { server } = await FishServer.createWebServer({
        connection: mockConnection,
      });

      const virtualUri = 'memory://test.fish';
      const fishContent = `
function my_function
    echo "test"
end

# Complete here: my_f
`.trim();

      // Open virtual document
      await server.didOpenTextDocument({
        textDocument: {
          uri: virtualUri,
          languageId: 'fish',
          version: 1,
          text: fishContent,
        },
      });

      // Request completions at the end of the file
      const completionParams: LSP.CompletionParams = {
        textDocument: { uri: virtualUri },
        position: { line: 4, character: 4 }, // After "my_f"
      };

      const completions = await server.onCompletion(completionParams);
      expect(completions).toBeDefined();
      // Should have some completions available (might be empty due to lack of background analysis)
      expect(completions.items).toBeDefined();
    });

    it('should handle hover for virtual files', async () => {
      const { server } = await FishServer.createWebServer({
        connection: mockConnection,
      });

      const virtualUri = 'vscode-vfs://github/user/repo/test.fish';
      const fishContent = `
function test_func
    echo "Testing hover"
end

test_func
`.trim();

      // Open virtual document
      await server.didOpenTextDocument({
        textDocument: {
          uri: virtualUri,
          languageId: 'fish',
          version: 1,
          text: fishContent,
        },
      });

      // Request hover on function call
      const hoverParams: LSP.HoverParams = {
        textDocument: { uri: virtualUri },
        position: { line: 4, character: 2 }, // On "test_func"
      };

      const hover = await server.onHover(hoverParams);
      // Hover might be null if symbol isn't found, but shouldn't throw
      expect(hover).toBeDefined();
    });

    it('should update virtual document content when client sends didChangeTextDocument', async () => {
      const { server } = await FishServer.createWebServer({
        connection: mockConnection,
      });

      const virtualUri = 'https://example.com/dynamic.fish';
      const initialContent = `
function original_func
    echo "original content"
end
`.trim();

      // Open initial virtual document
      await server.didOpenTextDocument({
        textDocument: {
          uri: virtualUri,
          languageId: 'fish',
          version: 1,
          text: initialContent,
        },
      });

      // Verify initial document exists with correct content
      const initialDoc = documents.getDocument(virtualUri);
      expect(initialDoc).toBeDefined();
      expect(initialDoc?.getText()).toBe(initialContent);
      expect(initialDoc?.version).toBe(1);

      // Send didChangeTextDocument to update the virtual document
      const updatedContent = `
function updated_func
    echo "updated content"
    set -l new_var "added variable"
end

function additional_func
    echo "new function added"
end
`.trim();

      const changeParams: LSP.DidChangeTextDocumentParams = {
        textDocument: {
          uri: virtualUri,
          version: 2,
        },
        contentChanges: [
          {
            // Full document replacement
            text: updatedContent,
          },
        ],
      };

      // Apply the changes
      await server.didChangeTextDocument(changeParams);

      // Verify document was updated with new content
      const updatedDoc = documents.getDocument(virtualUri);
      expect(updatedDoc).toBeDefined();
      expect(updatedDoc?.getText()).toBe(updatedContent);
      expect(updatedDoc?.version).toBe(2);
      expect(updatedDoc?.uri).toBe(virtualUri);

      // Verify the server can still provide language features on the updated content
      const symbols = await server.onDocumentSymbols({
        textDocument: { uri: virtualUri },
      });

      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThanOrEqual(2);
      expect(symbols.some((s: any) => s.name === 'updated_func')).toBe(true);
      expect(symbols.some((s: any) => s.name === 'additional_func')).toBe(true);
      expect(symbols.some((s: any) => s.name === 'original_func')).toBe(false);

      // Test incremental changes
      const incrementalChangeParams: LSP.DidChangeTextDocumentParams = {
        textDocument: {
          uri: virtualUri,
          version: 3,
        },
        contentChanges: [
          {
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 21 },
            },
            text: 'echo "incrementally updated"',
          },
        ],
      };

      await server.didChangeTextDocument(incrementalChangeParams);

      const finalDoc = documents.getDocument(virtualUri);
      expect(finalDoc).toBeDefined();
      expect(finalDoc?.version).toBe(3);
      expect(finalDoc?.getText()).toContain('incrementally updated');
    });
  });

  describe('File System Independence', () => {
    it('should work without physical file system access', async () => {
      // Mock file system operations to simulate no file access
      const originalRead = require('fs').readFileSync;
      vi.spyOn(require('fs'), 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      try {
        const virtualUri = 'memory://test.fish';
        const content = 'echo "hello world"';

        const doc = LspDocument.createTextDocumentItem(virtualUri, content);
        const analyzed = analyzer.analyze(doc);

        expect(analyzed).toBeDefined();
        expect(analyzed.document.getText()).toBe(content);

        // Should be able to get diagnostics even without file system
        const diagnostics = analyzer.getDiagnostics(virtualUri);
        expect(diagnostics).toBeDefined();
        expect(Array.isArray(diagnostics)).toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should handle WebSocket-like URIs', async () => {
      const wsUri = 'ws://localhost:8080/fish-lsp';
      const content = `
set -l greeting "Hello from WebSocket!"
echo $greeting
`.trim();

      const doc = LspDocument.createTextDocumentItem(wsUri, content);
      expect(doc.uri).toBe(wsUri);

      // Should analyze without issues
      const analyzed = analyzer.analyze(doc);
      expect(analyzed.document.uri).toBe(wsUri);

      // Should find symbols
      const symbols = analyzer.getDocumentSymbols(wsUri);
      expect(symbols).toBeDefined();
    });
  });

  describe('Docker Container Environment Simulation', () => {
    it('should work in containerized environment with no fish binary', async () => {
      // Mock exec operations that would normally call fish
      const mockExec = vi.fn().mockRejectedValue(new Error('fish: command not found'));
      vi.doMock('child_process', () => ({
        execFile: mockExec,
        execFileSync: mockExec,
        exec: mockExec,
        execSync: mockExec,
      }));

      const virtualUri = 'container://fish/test.fish';
      const content = `
function container_func
    set -l container_var "running in container"
    echo $container_var
end
`.trim();

      const doc = LspDocument.createTextDocumentItem(virtualUri, content);

      // Should still be able to analyze syntax
      const analyzed = analyzer.analyze(doc);
      expect(analyzed).toBeDefined();

      // Should extract function definitions
      const symbols = analyzer.getDocumentSymbols(virtualUri);
      expect(symbols).toBeDefined();
      expect(symbols.some(s => s.name === 'container_func')).toBe(true);
    });

    it('should provide basic language features without shell access', async () => {
      const { server } = await FishServer.createWebServer({
        connection: mockConnection,
      });

      const dockerUri = 'docker://container/workspace/script.fish';
      const fishScript = `
#!/usr/bin/fish

function deploy_app
    set -l app_name $argv[1]
    echo "Deploying $app_name"
    
    if test -z "$app_name"
        echo "Error: App name required"
        return 1
    end
    
    echo "Deployment complete"
end

deploy_app myapp
`.trim();

      // Open file in virtual Docker environment
      await server.didOpenTextDocument({
        textDocument: {
          uri: dockerUri,
          languageId: 'fish',
          version: 1,
          text: fishScript,
        },
      });

      // Should provide document symbols
      const symbols = await server.onDocumentSymbols({
        textDocument: { uri: dockerUri },
      });

      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols.some((s: any) => s.name === 'deploy_app')).toBe(true);

      // Should provide formatting
      const formatting = await server.onDocumentFormatting({
        textDocument: { uri: dockerUri },
        options: {
          tabSize: 4,
          insertSpaces: true,
        },
      });

      expect(formatting).toBeDefined();
      expect(Array.isArray(formatting)).toBe(true);
    });
  });

  describe('URI Scheme Edge Cases', () => {
    it('should handle URIs with query parameters', () => {
      const uriWithQuery = 'https://example.com/test.fish?version=1&temp=true';
      const content = 'echo "query test"';

      const doc = LspDocument.createTextDocumentItem(uriWithQuery, content);
      expect(doc.uri).toBe(uriWithQuery);
      expect(doc.getText()).toBe(content);
    });

    it('should handle URIs with fragments', () => {
      const uriWithFragment = 'vscode://file/test.fish#line42';
      const content = 'echo "fragment test"';

      const doc = LspDocument.createTextDocumentItem(uriWithFragment, content);
      expect(doc.uri).toBe(uriWithFragment);
    });

    it('should handle custom protocol URIs', () => {
      const customUri = 'fish-lsp://virtual/remote-file.fish';
      const content = `
function remote_function
    echo "This function exists only in memory"
end
`.trim();

      const doc = LspDocument.createTextDocumentItem(customUri, content);
      const analyzed = analyzer.analyze(doc);

      expect(analyzed.document.uri).toBe(customUri);

      const symbols = analyzer.getDocumentSymbols(customUri);
      expect(symbols.some(s => s.name === 'remote_function')).toBe(true);
    });
  });
});
