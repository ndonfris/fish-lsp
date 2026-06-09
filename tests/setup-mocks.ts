import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as LSP from 'vscode-languageserver';

if (process.env.VITEST_SILENT === '1') {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}

function fail(message?: string): never {
  const err = new Error(message ?? 'Test failed');
  Error.captureStackTrace(err, fail);
  throw err;
}
vi.stubGlobal('fail', fail);

const treeSitterFishWasmPath = process.env.fish_lsp_tree_sitter_wasm_path
  || resolve(__dirname, '../node_modules/@esdmr/tree-sitter-fish/tree-sitter-fish.wasm');

// Use actual WASM files for tree-sitter functionality in tests
vi.mock('web-tree-sitter/tree-sitter.wasm', () => ({
  default: readFileSync(resolve(__dirname, '../node_modules/web-tree-sitter/tree-sitter.wasm')),
}));

vi.mock('@esdmr/tree-sitter-fish/tree-sitter-fish.wasm', () => ({
  default: readFileSync(treeSitterFishWasmPath),
}));

// Legacy mocks for backward compatibility (if needed)
vi.mock('@embedded_assets/tree-sitter-fish.wasm', () => ({
  default: readFileSync(treeSitterFishWasmPath),
}));

vi.mock('@embedded_assets/tree-sitter.wasm', () => ({
  default: readFileSync(resolve(__dirname, '../node_modules/web-tree-sitter/tree-sitter.wasm')),
}));

// Mock other assets
vi.mock('@embedded_assets/man/fish-lsp.1', () => ({
  default: readFileSync(resolve(__dirname, '../man/fish-lsp.1'), 'utf8'),
}));

// Use the actual build-time.json from the out directory
vi.mock('@embedded_assets/build-time.json', () => {
  try {
    return { default: JSON.parse(readFileSync(resolve(__dirname, '../out/build-time.json'), 'utf8')) };
  } catch (error) {
    // Fallback if build-time.json doesn't exist
    return { default: { buildTime: new Date().toISOString(), version: '1.0.0' } };
  }
});

// Mock path resolution functions to prevent incorrect file lookups in test environment
vi.mock('../src/utils/path-resolution', async () => {
  const actual = await vi.importActual('../src/utils/path-resolution') as any;
  return {
    ...actual,
    getFishBuildTimeFilePath: () => resolve(__dirname, '../out/build-time.json'),
    getProjectRootPath: () => resolve(__dirname, '..'),
    getTreeSitterWasmPath: () => treeSitterFishWasmPath,
  };
});

// Mock process-env fish execution to prevent temp file errors in test environment
vi.mock('../src/utils/process-env', async () => {
  const actual = await vi.importActual('../src/utils/process-env') as any;

  return {
    ...actual,
  };
});

vi.mock('../src/utils/startup', async (importOriginal) => ({
  // Partial mock: keep every real export (e.g. `formatAlignedColumns`,
  // `timeServerStartup`) and only override the connection factories below.
  // A full mock would drop those and break any test importing them directly.
  ...await importOriginal<typeof import('../src/utils/startup')>(),
  connection: {
    listen: vi.fn(),
    onInitialize: vi.fn(),
    onInitialized: vi.fn(),
    onShutdown: vi.fn(),
    onExit: vi.fn(),
    onDidOpenTextDocument: vi.fn(),
    onDidChangeTextDocument: vi.fn(),
    onDidCloseTextDocument: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    onWillSaveTextDocument: vi.fn(),
    onWillSaveTextDocumentWaitUntil: vi.fn(),
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
    onPrepareRename: vi.fn(),
    onDocumentFormatting: vi.fn(),
    onDocumentRangeFormatting: vi.fn(),
    onDocumentOnTypeFormatting: vi.fn(),
    onCodeAction: vi.fn(),
    onCodeActionResolve: vi.fn(),
    onCodeLens: vi.fn(),
    onCodeLensResolve: vi.fn(),
    onFoldingRanges: vi.fn(),
    onSelectionRanges: vi.fn(),
    onDocumentHighlight: vi.fn(),
    onDocumentLinks: vi.fn(),
    onDocumentLinkResolve: vi.fn(),
    onDocumentColor: vi.fn(),
    onColorPresentation: vi.fn(),
    onTypeDefinition: vi.fn(),
    onDeclaration: vi.fn(),
    onSignatureHelp: vi.fn(),
    onExecuteCommand: vi.fn(),
    languages: {
      inlayHint: {
        on: vi.fn(),
        resolve: vi.fn(),
      },
      semanticTokens: {
        on: vi.fn(),
        onDelta: vi.fn(),
        onRange: vi.fn(),
      },
      onLinkedEditingRange: vi.fn(),
    },
    onRequest: vi.fn(),
    onNotification: vi.fn(),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    sendDiagnostics: vi.fn(),
    sendProgress: vi.fn(),
    onProgress: vi.fn(),
    console: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      connection: {} as any,
    },
    window: {
      createWorkDoneProgress: vi.fn().mockResolvedValue({
        begin: vi.fn(),
        report: vi.fn(),
        done: vi.fn(),
      }),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showDocument: vi.fn(),
    },
    workspace: {
      onDidChangeWorkspaceFolders: vi.fn(),
      onDidCreateFiles: vi.fn(),
      onDidRenameFiles: vi.fn(),
      onDidDeleteFiles: vi.fn(),
      onWillCreateFiles: vi.fn(),
      onWillRenameFiles: vi.fn(),
      onWillDeleteFiles: vi.fn(),
      getConfiguration: vi.fn(),
      getWorkspaceFolders: vi.fn(),
      applyEdit: vi.fn(),
    },
    tracer: {
      log: vi.fn(),
      connection: {} as any,
    },
    telemetry: {
      logEvent: vi.fn(),
      connection: {} as any,
    },
    client: {
      register: vi.fn(),
      connection: {} as any,
    },
    dispose: vi.fn(),
    onDispose: vi.fn(),
  } as unknown as LSP.Connection,
  createBrowserConnection: vi.fn().mockImplementation(() => ({
    listen: vi.fn(),
    onInitialize: vi.fn(),
    onInitialized: vi.fn(),
    onShutdown: vi.fn(),
    onExit: vi.fn(),
    onDidOpenTextDocument: vi.fn(),
    onDidChangeTextDocument: vi.fn(),
    onDidCloseTextDocument: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    onWillSaveTextDocument: vi.fn(),
    onWillSaveTextDocumentWaitUntil: vi.fn(),
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
    onPrepareRename: vi.fn(),
    onDocumentFormatting: vi.fn(),
    onDocumentRangeFormatting: vi.fn(),
    onDocumentOnTypeFormatting: vi.fn(),
    onCodeAction: vi.fn(),
    onCodeActionResolve: vi.fn(),
    onCodeLens: vi.fn(),
    onCodeLensResolve: vi.fn(),
    onFoldingRanges: vi.fn(),
    onSelectionRanges: vi.fn(),
    onDocumentHighlight: vi.fn(),
    onDocumentLinks: vi.fn(),
    onDocumentLinkResolve: vi.fn(),
    onDocumentColor: vi.fn(),
    onColorPresentation: vi.fn(),
    onTypeDefinition: vi.fn(),
    onDeclaration: vi.fn(),
    onSignatureHelp: vi.fn(),
    onExecuteCommand: vi.fn(),
    languages: {
      inlayHint: {
        on: vi.fn(),
        resolve: vi.fn(),
      },
      semanticTokens: {
        on: vi.fn(),
        onDelta: vi.fn(),
        onRange: vi.fn(),
      },
      onLinkedEditingRange: vi.fn(),
    },
    onRequest: vi.fn(),
    onNotification: vi.fn(),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    sendDiagnostics: vi.fn(),
    sendProgress: vi.fn(),
    onProgress: vi.fn(),
    console: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      connection: {} as any,
    },
    window: {
      createWorkDoneProgress: vi.fn().mockResolvedValue({
        begin: vi.fn(),
        report: vi.fn(),
        done: vi.fn(),
      }),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showDocument: vi.fn(),
    },
    workspace: {
      onDidChangeWorkspaceFolders: vi.fn(),
      onDidCreateFiles: vi.fn(),
      onDidRenameFiles: vi.fn(),
      onDidDeleteFiles: vi.fn(),
      onWillCreateFiles: vi.fn(),
      onWillRenameFiles: vi.fn(),
      onWillDeleteFiles: vi.fn(),
      getConfiguration: vi.fn(),
      getWorkspaceFolders: vi.fn(),
      applyEdit: vi.fn(),
    },
    tracer: {
      log: vi.fn(),
      connection: {} as any,
    },
    telemetry: {
      logEvent: vi.fn(),
      connection: {} as any,
    },
    client: {
      register: vi.fn(),
      connection: {} as any,
    },
    dispose: vi.fn(),
    onDispose: vi.fn(),
  } as unknown as LSP.Connection)),
  setExternalConnection: vi.fn(),
}));
