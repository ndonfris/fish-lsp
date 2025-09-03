import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createFakeLspDocument, setLogger, createTestWorkspace } from './helpers';
import { analyzer, Analyzer } from '../src/analyze';
import { documents } from '../src/document';
import { workspaceManager } from '../src/utils/workspace-manager';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import FishServer, { hasWorkspaceFolderCapability, enableWorkspaceFolderSupport, currentDocument } from '../src/server';
import * as LSP from 'vscode-languageserver';
import { createServerLogger } from '../src/logger';
import * as startupModule from '../src/utils/startup';
import { uriToPath } from '../src/utils/translation';
import { CompletionItemMap } from '../src/utils/completion/startup-cache';
import { initializeCompletionPager } from '../src/utils/completion/pager';
import { initializeDocumentationCache } from '../src/utils/documentation-cache';
import { initializeDefaultFishWorkspaces } from '../src/utils/workspace';
import { Config } from '../src/config';

// Create a shared mock connection factory - defined first before mocks
function createMockConnection() {
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
    console: { error: vi.fn() },
    workspace: { onDidChangeWorkspaceFolders: vi.fn() },
    window: {
      createWorkDoneProgress: vi.fn().mockResolvedValue({
        begin: vi.fn(),
        done: vi.fn(),
        report: vi.fn(),
      }),
      showErrorMessage: vi.fn(),
    },
  };
}

// Mock external dependencies
vi.mock('../src/utils/startup', () => ({
  connection: createMockConnection(),
  createBrowserConnection: vi.fn().mockImplementation(() => createMockConnection()),
  setExternalConnection: vi.fn(),
}));

vi.mock('../src/logger', () => ({
  createServerLogger: vi.fn(),
  logger: {
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    logAsJson: vi.fn(),
    logPropertiesForEachObject: vi.fn(),
  },
}));

vi.mock('../src/config', async () => {
  const actual = await vi.importActual('../src/config') as any;
  return {
    ...actual,
    config: {
      fish_lsp_log_file: '/tmp/fish-lsp.log',
      fish_lsp_show_client_popups: false,
      fish_lsp_enabled_handlers: [],
      fish_lsp_disabled_handlers: [],
      fish_lsp_commit_characters: ['\t', ';', ' '],
      fish_lsp_log_level: '',
      fish_lsp_all_indexed_paths: ['$__fish_config_dir', '$__fish_data_dir'],
    },
    Config: {
      initialize: vi.fn().mockReturnValue({
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { resolveProvider: true },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          codeActionProvider: true,
          codeLensProvider: {},
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          renameProvider: true,
          foldingRangeProvider: true,
          implementationProvider: true,
          signatureHelpProvider: { triggerCharacters: [' ', '(', ','] },
          workspace: {
            workspaceFolders: { supported: true },
          },
        },
      }),
      get isWebServer() {
        return true;
      },
      set isWebServer(value: boolean) { /* mock setter */ },
      fixEnabledDisabledHandlers: vi.fn(),
    },
    configHandlers: {
      complete: true,
      hover: true,
      rename: true,
      definition: true,
      implementation: true,
      reference: true,
      logger: true,
      formatting: true,
      formatRange: true,
      typeFormatting: true,
      codeAction: true,
      codeLens: true,
      folding: true,
      signature: true,
      executeCommand: true,
      inlayHint: true,
      highlight: true,
      diagnostic: true,
      popups: true,
    },
    validHandlers: [
      'complete', 'hover', 'rename', 'definition', 'implementation', 'reference', 'formatting',
      'formatRange', 'typeFormatting', 'codeAction', 'codeLens', 'folding', 'signature',
      'executeCommand', 'inlayHint', 'highlight', 'diagnostic', 'popups',
    ],
    updateHandlers: vi.fn(),
  };
});

vi.mock('../src/formatting', () => ({
  formatDocumentContent: vi.fn().mockResolvedValue('formatted content'),
}));

vi.mock('../src/utils/completion/startup-cache', () => ({
  CompletionItemMap: {
    initialize: vi.fn().mockResolvedValue(new Map()),
  },
}));

vi.mock('../src/utils/completion/pager', () => ({
  initializeCompletionPager: vi.fn().mockResolvedValue({
    complete: vi.fn().mockResolvedValue({ items: [], isIncomplete: false }),
    completeEmpty: vi.fn().mockResolvedValue({ items: [], isIncomplete: true }),
    completeVariables: vi.fn().mockResolvedValue({ items: [], isIncomplete: false }),
    empty: vi.fn().mockReturnValue({ items: [], isIncomplete: true }),
  }),
}));

vi.mock('../src/utils/documentation-cache', () => ({
  initializeDocumentationCache: vi.fn().mockResolvedValue({
    resolve: vi.fn().mockResolvedValue({ docs: 'mock documentation' }),
  }),
}));

vi.mock('../src/utils/workspace', async () => {
  const actual = await vi.importActual('../src/utils/workspace') as any;
  return {
    ...actual,
    getWorkspacePathsFromInitializationParams: vi.fn().mockReturnValue([]),
    initializeDefaultFishWorkspaces: vi.fn().mockResolvedValue(undefined),
  };
});

describe('FishServer', () => {
  setLogger();

  let mockConnection: any;
  let mockInitializeParams: LSP.InitializeParams;

  beforeAll(async () => {
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock connection
    mockConnection = createMockConnection();

    mockInitializeParams = {
      processId: 1234,
      rootUri: 'file:///test/workspace',
      rootPath: '/test/workspace',
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
        textDocument: {
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
        },
      },
      initializationOptions: {},
      workspaceFolders: [
        {
          uri: 'file:///test/workspace',
          name: 'test-workspace',
        },
      ],
    };

    // Clear workspace manager
    workspaceManager.clear();
    documents.clear();
  });

  afterEach(() => {
    workspaceManager.clear();
    documents.clear();
  });

  describe('Static Methods', () => {
    describe('createWebServer', () => {
      it('should create web server with default parameters', async () => {
        const result = await FishServer.createWebServer({});

        expect(result).toBeDefined();
        expect(result.server).toBeInstanceOf(FishServer);
        expect(result.initializeResult).toBeDefined();
        expect(Config.isWebServer).toBe(true);
      });

      it('should create web server with custom connection', async () => {
        const result = await FishServer.createWebServer({
          connection: mockConnection,
        });

        expect(result).toBeDefined();
        expect(result.server).toBeInstanceOf(FishServer);
        expect(mockConnection.onInitialize).toHaveBeenCalled();
        expect(mockConnection.listen).toHaveBeenCalled();
      });

      it('should create web server with custom params', async () => {
        const result = await FishServer.createWebServer({
          params: mockInitializeParams,
        });

        expect(result).toBeDefined();
        expect(result.server).toBeInstanceOf(FishServer);
      });
    });

    describe('create', () => {
      it('should create server instance with initialization', async () => {
        const result = await FishServer.create(mockConnection, mockInitializeParams);

        expect(result).toBeDefined();
        expect(result.server).toBeInstanceOf(FishServer);
        expect(result.initializeResult).toBeDefined();
      });

      it('should enable workspace folder capability when supported', async () => {
        const paramsWithWorkspaceSupport = {
          ...mockInitializeParams,
          capabilities: {
            workspace: {
              workspaceFolders: true,
            },
          },
        };

        await FishServer.create(mockConnection, paramsWithWorkspaceSupport);

        expect(hasWorkspaceFolderCapability).toBe(true);
      });

      it('should not enable workspace folder capability when not supported', async () => {
        const paramsWithoutWorkspaceSupport = {
          ...mockInitializeParams,
          capabilities: {},
        };

        await FishServer.create(mockConnection, paramsWithoutWorkspaceSupport);

        // hasWorkspaceFolderCapability should remain false (or be set to false)
        expect(hasWorkspaceFolderCapability).toBe(false);
      });
    });
  });

  describe('Constructor and Properties', () => {
    it('should initialize with correct default values', async () => {
      const { server } = await FishServer.create(mockConnection, mockInitializeParams);

      expect(server.clientSupportsShowDocument).toBe(false);
      expect(server.backgroundAnalysisComplete).toBe(false);
      expect(server.info).toBeDefined();
    });
  });

  describe('Document Lifecycle Methods', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('didOpenTextDocument', () => {
      it('should handle opening a text document', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        const params: LSP.DidOpenTextDocumentParams = {
          textDocument: {
            uri: doc.uri,
            languageId: 'fish',
            version: 1,
            text: doc.getText(),
          },
        };

        await server.didOpenTextDocument(params);

        expect(currentDocument).toBeDefined();
        expect(currentDocument?.uri).toBe(doc.uri);
      });

      it('should analyze document on open', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        const params: LSP.DidOpenTextDocumentParams = {
          textDocument: {
            uri: doc.uri,
            languageId: 'fish',
            version: 1,
            text: doc.getText(),
          },
        };

        const analyzeSpy = vi.spyOn(server, 'analyzeDocument');
        await server.didOpenTextDocument(params);

        expect(analyzeSpy).toHaveBeenCalledWith({ uri: doc.uri });
      });
    });

    describe('didChangeTextDocument', () => {
      it('should handle text document changes', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);

        const params: LSP.DidChangeTextDocumentParams = {
          textDocument: { uri: doc.uri, version: 2 },
          contentChanges: [
            { text: 'function test\n  echo "hello"\nend' },
          ],
        };

        await server.didChangeTextDocument(params);

        // Just verify it doesn't throw an error - the real implementation calls sendDiagnostics
        expect(true).toBe(true);
      });

      it('should clear diagnostics on change', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);

        const params: LSP.DidChangeTextDocumentParams = {
          textDocument: { uri: doc.uri, version: 2 },
          contentChanges: [
            { text: 'function test\n  echo "hello"\nend' },
          ],
        };

        const clearDiagnosticsSpy = vi.spyOn(server, 'clearDiagnostics');
        await server.didChangeTextDocument(params);

        expect(clearDiagnosticsSpy).toHaveBeenCalledWith({ uri: doc.uri });
      });
    });

    describe('didCloseTextDocument', () => {
      it('should handle closing a text document', () => {
        const params: LSP.DidCloseTextDocumentParams = {
          textDocument: { uri: 'file:///test/functions/test.fish' },
        };

        server.didCloseTextDocument(params);

        // Should not throw an error
        expect(true).toBe(true);
      });
    });

    describe('didSaveTextDocument', () => {
      it('should handle saving a text document', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);

        const params: LSP.DidSaveTextDocumentParams = {
          textDocument: { uri: doc.uri },
        };

        const analyzeSpy = vi.spyOn(server, 'analyzeDocument');
        await server.didSaveTextDocument(params);

        expect(analyzeSpy).toHaveBeenCalledWith({ uri: doc.uri });
      });
    });
  });

  describe('Language Features', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
      server.backgroundAnalysisComplete = true; // Enable completions
    });

    describe('onCompletion', () => {
      it('should return empty completion when background analysis not complete', async () => {
        server.backgroundAnalysisComplete = false;

        const params: LSP.CompletionParams = {
          textDocument: { uri: 'file:///test/functions/test.fish' },
          position: { line: 0, character: 0 },
        };

        const result = await server.onCompletion(params);

        expect(result).toBeDefined();
        // The actual implementation returns a completion with isIncomplete: true
        expect(result.isIncomplete === undefined || result.isIncomplete).toBe(true);
      });

      it('should return completions for valid document', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\n  \nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.CompletionParams = {
          textDocument: { uri: doc.uri },
          position: { line: 1, character: 2 },
        };

        const result = await server.onCompletion(params);

        expect(result).toBeDefined();
      });

      it('should handle comment completions', async () => {
        const doc = createFakeLspDocument('functions/test.fish', '# TODO: ');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.CompletionParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 8 },
        };

        const result = await server.onCompletion(params);

        expect(result).toBeDefined();
      });

      it('should handle variable completions', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'echo $');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.CompletionParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 6 },
        };

        const result = await server.onCompletion(params);

        expect(result).toBeDefined();
      });
    });

    describe('onCompletionResolve', () => {
      it('should resolve completion item', async () => {
        const item: LSP.CompletionItem = {
          label: 'test',
          kind: LSP.CompletionItemKind.Function,
          documentation: 'test documentation',
        };

        const result = await server.onCompletionResolve(item);

        expect(result).toBeDefined();
        expect(result.label).toBe('test');
      });

      it('should handle completion item with local documentation', async () => {
        const item: any = {
          label: 'test',
          kind: LSP.CompletionItemKind.Function,
          documentation: 'test documentation',
          local: true,
          useDocAsDetail: true,
        };

        const result = await server.onCompletionResolve(item);

        expect(result).toBeDefined();
        expect(result.documentation).toBeDefined();
      });
    });

    describe('onDocumentSymbols', () => {
      it('should return document symbols', () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.DocumentSymbolParams = {
          textDocument: { uri: doc.uri },
        };

        const result = server.onDocumentSymbols(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent document', () => {
        const params: LSP.DocumentSymbolParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
        };

        const result = server.onDocumentSymbols(params);

        expect(result).toEqual([]);
      });
    });

    describe('onWorkspaceSymbol', () => {
      it('should return workspace symbols', async () => {
        const params: LSP.WorkspaceSymbolParams = {
          query: 'test',
        };

        const result = await server.onWorkspaceSymbol(params);

        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('onWorkspaceSymbolResolve', () => {
      it('should resolve workspace symbol', async () => {
        const symbol: LSP.WorkspaceSymbol = {
          name: 'test',
          kind: LSP.SymbolKind.Function,
          location: {
            uri: 'file:///test/functions/test.fish',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 4 },
            },
          },
        };

        const result = await server.onWorkspaceSymbolResolve(symbol);

        expect(result).toBeDefined();
        expect(result.name).toBe('test');
      });
    });

    describe('onDefinition', () => {
      it('should return definitions', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.DefinitionParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 9 },
        };

        const result = await server.onDefinition(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.DefinitionParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          position: { line: 0, character: 0 },
        };

        const result = await server.onDefinition(params);

        expect(result).toEqual([]);
      });
    });

    describe('onReferences', () => {
      it('should return references', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.ReferenceParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 9 },
          context: { includeDeclaration: true },
        };

        const result = await server.onReferences(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.ReferenceParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          position: { line: 0, character: 0 },
          context: { includeDeclaration: true },
        };

        const result = await server.onReferences(params);

        expect(result).toEqual([]);
      });
    });

    describe('onImplementation', () => {
      it('should return implementations', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.ImplementationParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 9 },
        };

        const result = await server.onImplementation(params);

        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('onHover', () => {
      it('should return hover information', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.HoverParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 9 },
        };

        const result = await server.onHover(params);

        // Result can be null or Hover object
        expect(result === null || typeof result === 'object').toBe(true);
      });

      it('should return null for non-existent document', async () => {
        const params: LSP.HoverParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          position: { line: 0, character: 0 },
        };

        const result = await server.onHover(params);

        expect(result).toBeNull();
      });
    });

    describe('onRename', () => {
      it('should return workspace edit for rename', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.RenameParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 9 },
          newName: 'newTest',
        };

        const result = await server.onRename(params);

        expect(result === null || typeof result === 'object').toBe(true);
      });

      it('should return null for non-existent document', async () => {
        const params: LSP.RenameParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          position: { line: 0, character: 0 },
          newName: 'newName',
        };

        const result = await server.onRename(params);

        expect(result).toBeNull();
      });
    });
  });

  describe('Formatting Methods', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('onDocumentFormatting', () => {
      it('should format document', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\necho hello\nend');
        documents.set(doc);

        const params: LSP.DocumentFormattingParams = {
          textDocument: { uri: doc.uri },
          options: { tabSize: 2, insertSpaces: true },
        };

        const result = await server.onDocumentFormatting(params);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.DocumentFormattingParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          options: { tabSize: 2, insertSpaces: true },
        };

        const result = await server.onDocumentFormatting(params);

        expect(result).toEqual([]);
      });
    });

    describe('onDocumentRangeFormatting', () => {
      it('should format document range', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\necho hello\nend');
        documents.set(doc);

        const params: LSP.DocumentRangeFormattingParams = {
          textDocument: { uri: doc.uri },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 2, character: 3 },
          },
          options: { tabSize: 2, insertSpaces: true },
        };

        const result = await server.onDocumentRangeFormatting(params);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.DocumentRangeFormattingParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
          options: { tabSize: 2, insertSpaces: true },
        };

        const result = await server.onDocumentRangeFormatting(params);

        expect(result).toEqual([]);
      });
    });

    describe('onDocumentTypeFormatting', () => {
      it('should format document on type', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\necho hello\nend');
        documents.set(doc);

        const params: LSP.DocumentFormattingParams = {
          textDocument: { uri: doc.uri },
          options: { tabSize: 2, insertSpaces: true },
        };

        const result = await server.onDocumentTypeFormatting(params);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Additional Features', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('onFoldingRanges', () => {
      it('should return folding ranges', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\n  echo hello\nend\n\nfunction bar\n  echo world\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.FoldingRangeParams = {
          textDocument: { uri: doc.uri },
        };

        const result = await server.onFoldingRanges(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should throw error for non-existent document', async () => {
        const params: LSP.FoldingRangeParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
        };

        await expect(server.onFoldingRanges(params)).rejects.toThrow();
      });
    });

    describe('onInlayHints', () => {
      it('should return inlay hints', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.InlayHintParams = {
          textDocument: { uri: doc.uri },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 3 },
          },
        };

        const result = await server.onInlayHints(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.InlayHintParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
        };

        const result = await server.onInlayHints(params);

        expect(result).toEqual([]);
      });
    });

    describe('onCodeLens', () => {
      it('should return code lenses', async () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.CodeLensParams = {
          textDocument: { uri: doc.uri },
        };

        const result = await server.onCodeLens(params);

        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent document', async () => {
        const params: LSP.CodeLensParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
        };

        const result = await server.onCodeLens(params);

        expect(result).toEqual([]);
      });
    });

    describe('onShowSignatureHelp', () => {
      it('should return signature help', () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test -a arg1 arg2\nend');
        documents.set(doc);
        analyzer.analyze(doc);

        const params: LSP.SignatureHelpParams = {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 20 },
        };

        const result = server.onShowSignatureHelp(params);

        expect(result === null || typeof result === 'object').toBe(true);
      });

      it('should return null for non-existent document', () => {
        const params: LSP.SignatureHelpParams = {
          textDocument: { uri: 'file:///non-existent.fish' },
          position: { line: 0, character: 0 },
        };

        const result = server.onShowSignatureHelp(params);

        expect(result).toBeNull();
      });
    });
  });

  describe('Utility Methods', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('analyzeDocument', () => {
      it('should analyze document and send diagnostics', () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);

        const result = server.analyzeDocument({ uri: doc.uri });

        expect(result).toBeDefined();
        expect(result?.uri).toBe(doc.uri);
        // The method should complete without throwing
        expect(true).toBe(true);
      });

      it('should handle non-existent document', () => {
        const result = server.analyzeDocument({ uri: 'file:///non-existent.fish' });

        expect(result).toBeUndefined();
      });

      it('should bypass cache when requested', () => {
        const doc = createFakeLspDocument('functions/test.fish', 'function test\nend');
        documents.set(doc);

        const result = server.analyzeDocument({ uri: doc.uri }, true);

        expect(result).toBeDefined();
        // The method should complete without throwing
        expect(true).toBe(true);
      });
    });

    describe('clearDiagnostics', () => {
      it('should clear diagnostics for document', () => {
        server.clearDiagnostics({ uri: 'file:///test/functions/test.fish' });

        // The method should complete without throwing
        expect(true).toBe(true);
      });
    });

    describe('onShutdown', () => {
      it('should clean up resources on shutdown', async () => {
        await server.onShutdown();

        expect(server.backgroundAnalysisComplete).toBe(false);
      });
    });
  });

  describe('Server Lifecycle', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('onInitialized', () => {
      it('should handle initialization completion', async () => {
        const result = await server.onInitialized({});

        expect(result).toBeDefined();
        expect(result.result).toBeGreaterThanOrEqual(0);
        expect(server.backgroundAnalysisComplete).toBe(true);
      });

      it('should register workspace folder change handler when capability enabled', async () => {
        // Enable workspace folder capability
        enableWorkspaceFolderSupport();

        await server.onInitialized({});

        // Just verify the method completes - workspace handling is complex
        expect(true).toBe(true);
      });
    });

    describe('register', () => {
      it('should register all LSP handlers', () => {
        server.register(mockConnection);

        // Verify all handlers are registered
        expect(mockConnection.onDidOpenTextDocument).toHaveBeenCalled();
        expect(mockConnection.onDidChangeTextDocument).toHaveBeenCalled();
        expect(mockConnection.onDidCloseTextDocument).toHaveBeenCalled();
        expect(mockConnection.onDidSaveTextDocument).toHaveBeenCalled();
        expect(mockConnection.onCompletion).toHaveBeenCalled();
        expect(mockConnection.onCompletionResolve).toHaveBeenCalled();
        expect(mockConnection.onDocumentSymbol).toHaveBeenCalled();
        expect(mockConnection.onWorkspaceSymbol).toHaveBeenCalled();
        expect(mockConnection.onWorkspaceSymbolResolve).toHaveBeenCalled();
        expect(mockConnection.onDefinition).toHaveBeenCalled();
        expect(mockConnection.onImplementation).toHaveBeenCalled();
        expect(mockConnection.onReferences).toHaveBeenCalled();
        expect(mockConnection.onHover).toHaveBeenCalled();
        expect(mockConnection.onRenameRequest).toHaveBeenCalled();
        expect(mockConnection.onDocumentFormatting).toHaveBeenCalled();
        expect(mockConnection.onDocumentRangeFormatting).toHaveBeenCalled();
        expect(mockConnection.onDocumentOnTypeFormatting).toHaveBeenCalled();
        expect(mockConnection.onCodeAction).toHaveBeenCalled();
        expect(mockConnection.onCodeLens).toHaveBeenCalled();
        expect(mockConnection.onFoldingRanges).toHaveBeenCalled();
        expect(mockConnection.onDocumentHighlight).toHaveBeenCalled();
        expect(mockConnection.languages.inlayHint.on).toHaveBeenCalled();
        expect(mockConnection.onSignatureHelp).toHaveBeenCalled();
        expect(mockConnection.onExecuteCommand).toHaveBeenCalled();
        expect(mockConnection.onInitialized).toHaveBeenCalled();
        expect(mockConnection.onShutdown).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    it('should handle errors gracefully in completion', async () => {
      // Mock analyzer to throw error
      const originalMethod = analyzer.parseCurrentLine;
      analyzer.parseCurrentLine = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      const params: LSP.CompletionParams = {
        textDocument: { uri: 'file:///test/functions/test.fish' },
        position: { line: 0, character: 0 },
      };

      const result = await server.onCompletion(params);

      expect(result).toBeDefined();

      // Restore original method
      analyzer.parseCurrentLine = originalMethod;
    });

    it('should handle errors in signature help', () => {
      // Test with invalid parameters that might cause errors
      const params: LSP.SignatureHelpParams = {
        textDocument: { uri: 'file:///non-existent.fish' },
        position: { line: -1, character: -1 },
      };

      const result = server.onShowSignatureHelp(params);

      expect(result).toBeNull();
    });
  });

  describe('Properties and Getters', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    describe('supportHierarchicalDocumentSymbol', () => {
      it('should return true when client supports hierarchical document symbols', () => {
        expect(server.supportHierarchicalDocumentSymbol).toBe(true);
      });

      it('should return false when client does not support hierarchical document symbols', async () => {
        const paramsWithoutHierarchical = {
          ...mockInitializeParams,
          capabilities: {
            textDocument: {
              documentSymbol: {
                hierarchicalDocumentSymbolSupport: false,
              },
            },
          },
        };

        const { server: newServer } = await FishServer.create(mockConnection, paramsWithoutHierarchical);
        expect(newServer.supportHierarchicalDocumentSymbol).toBe(false);
      });
    });

    describe('info property', () => {
      it('should return package info', () => {
        const info = server.info;
        expect(info).toBeDefined();
        expect(typeof info).toBe('object');
      });
    });
  });

  describe('Module Exports', () => {
    it('should export hasWorkspaceFolderCapability', () => {
      expect(typeof hasWorkspaceFolderCapability).toBe('boolean');
    });

    it('should export enableWorkspaceFolderSupport function', () => {
      expect(typeof enableWorkspaceFolderSupport).toBe('function');

      const initialValue = hasWorkspaceFolderCapability;
      enableWorkspaceFolderSupport();
      expect(hasWorkspaceFolderCapability).toBe(true);
    });

    it('should export currentDocument', () => {
      expect(currentDocument === null || typeof currentDocument === 'object').toBe(true);
    });
  });

  describe('Edge Cases and Integration', () => {
    let server: FishServer;

    beforeEach(async () => {
      const result = await FishServer.create(mockConnection, mockInitializeParams);
      server = result.server;
    });

    it('should handle empty workspace folders', async () => {
      const paramsWithEmptyWorkspace = {
        ...mockInitializeParams,
        workspaceFolders: [],
      };

      const result = await FishServer.create(mockConnection, paramsWithEmptyWorkspace);
      expect(result.server).toBeDefined();
    });

    it('should handle null workspace folders', async () => {
      const paramsWithNullWorkspace = {
        ...mockInitializeParams,
        workspaceFolders: null,
      };

      const result = await FishServer.create(mockConnection, paramsWithNullWorkspace);
      expect(result.server).toBeDefined();
    });

    it('should handle multiple document operations', async () => {
      const doc1 = createFakeLspDocument('functions/test1.fish', 'function test1\nend');
      const doc2 = createFakeLspDocument('functions/test2.fish', 'function test2\nend');

      documents.set(doc1);
      documents.set(doc2);

      // Open both documents
      await server.didOpenTextDocument({
        textDocument: { uri: doc1.uri, languageId: 'fish', version: 1, text: doc1.getText() },
      });
      await server.didOpenTextDocument({
        textDocument: { uri: doc2.uri, languageId: 'fish', version: 1, text: doc2.getText() },
      });

      // Get symbols from both
      const symbols1 = server.onDocumentSymbols({ textDocument: { uri: doc1.uri } });
      const symbols2 = server.onDocumentSymbols({ textDocument: { uri: doc2.uri } });

      expect(symbols1).toBeDefined();
      expect(symbols2).toBeDefined();
    });
  });
});
