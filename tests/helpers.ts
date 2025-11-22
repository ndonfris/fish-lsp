import { glob } from 'fast-glob';
import fs, { readFileSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { resolve } from 'path';
import { DocumentSymbol, Location, Range, SymbolKind, TextDocumentItem } from 'vscode-languageserver';
import * as LSP from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import * as Parser from 'web-tree-sitter';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import { vi } from 'vitest';
import { analyzer, Analyzer } from '../src/analyze';
import { documents, LspDocument } from '../src/document';
import { initializeParser } from '../src/parser';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { env } from '../src/utils/env-manager';
import { flattenNested } from '../src/utils/flatten';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { pathToUri } from '../src/utils/translation';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { testOpenDocument } from './document-test-helpers';

/**
 * Sets up mock for the startup module.
 * Call this BEFORE importing FishServer or any module that imports from startup.
 *
 * @example
 * ```typescript
 * import { setupStartupMock } from './helpers';
 *
 * // At the top of your test file, before other imports
 * setupStartupMock();
 *
 * // Now import FishServer
 * import FishServer from '../src/server';
 * ```
 */
export function setupStartupMock() {
  vi.mock('../src/utils/startup', () => ({
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
}

export const fail = () => {
  return (msg?: string) => {
    expect(true).toBe(false);
    return null;
  };
};

export function setLogger(
  beforeCallback: () => Promise<void> = async () => { },
  afterCallback: () => Promise<void> = async () => { },
) {
  const jestConsole = console;
  beforeEach(async () => {
    global.console = require('console');
    await beforeCallback();
  });
  afterEach(async () => {
    global.console = jestConsole;
    await afterCallback();
  });
}

/**
 * Create a mock LSP connection that can be reused across tests.
 * This provides all the necessary LSP.ServerCapabilities methods mocked with vi.fn()
 *
 * @returns A mocked LSP.Connection object with all handlers and capabilities
 */
export function createMockConnection(): LSP.Connection {
  return {
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
  } as unknown as LSP.Connection;
}

/**
 * Helper function to get references to mocked initialization functions
 * Use this AFTER you've set up vi.mock() for the modules in your test file.
 *
 * @example
 * ```typescript
 * import { getMockedInitializationFunctions } from './helpers';
 *
 * // In your test (after vi.mock calls)
 * const { initializeDocumentationCache } = await import('../src/utils/documentation-cache');
 *
 * await FishServer.create(mockConnection, mockParams);
 *
 * // Verify initialization was called
 * expect(initializeDocumentationCache).toHaveBeenCalled();
 * ```
 */
export async function getMockedInitializationFunctions() {
  const docCache = await import('../src/utils/documentation-cache');
  const workspace = await import('../src/utils/workspace');
  const completionCache = await import('../src/utils/completion/startup-cache');
  const pager = await import('../src/utils/completion/pager');
  const processEnv = await import('../src/utils/process-env');

  return {
    initializeDocumentationCache: docCache.initializeDocumentationCache,
    initializeDefaultFishWorkspaces: workspace.initializeDefaultFishWorkspaces,
    getWorkspacePathsFromInitializationParams: workspace.getWorkspacePathsFromInitializationParams,
    CompletionItemMapInitialize: completionCache.CompletionItemMap.initialize,
    initializeCompletionPager: pager.initializeCompletionPager,
    setupProcessEnvExecFile: processEnv.setupProcessEnvExecFile,
  };
}

/**
 * @param {string} fname - relative path to file, in tests folder
 * @param {boolean} inAutoloadPath - simulate the doc uri being in ~/.config/fish/functions/*.fish
 * @returns {LspDocument} - lsp document (from '../src/document.ts')
 */
export function resolveLspDocumentForHelperTestFile(fname: string, inAutoloadPath: boolean = true): LspDocument {
  // check which path type is fname -----------> absolute path  | relative path
  const filepath = fname.startsWith(homedir()) ? resolve(fname) : resolve(__dirname, fname);
  const file = readFileSync(filepath, 'utf8');
  const filename = inAutoloadPath ? `file://${homedir()}/.config/fish/functions/${fname.split('/').at(-1)}` : `file://${filepath}`;
  const doc = TextDocumentItem.create(filename, 'fish', 0, file);
  return new LspDocument(doc);
}

export async function resolveAbsPath(fname: string): Promise<string[]> {
  const file = readFileSync(resolve(fname), 'utf8');
  return file.split('\n');
}

export function positionStr(pos: Point) {
  return `{ row: ${pos.row.toString()}, column: ${pos.column.toString()} }`;
}

export async function parseFile(fname: string): Promise<Tree> {
  const text = await resolveAbsPath(fname);
  const parser = await initializeParser();
  const tree = parser.parse(text.join('\n'));
  return tree;
}

export function createFakeUriPath(path: string): string {
  if (path.startsWith('/')) {
    return `file://${path}`;
  }
  return `file://${homedir()}/.config/fish/${path}`;
}

export type TestLspDocument = {
  path: string;
  text: string | string[];
};

export function createTestWorkspace(
  analyzer: Analyzer,
  ...docs: TestLspDocument[]
) {
  const result: LspDocument[] = [];
  for (const doc of docs) {
    const newDoc = createFakeLspDocument(doc.path, ...Array.isArray(doc.text) ? doc.text : [doc.text]);
    analyzer.analyze(newDoc);
    result.push(newDoc);
  }
  return result;
}

export function createFakeLspDocument(name: string, ...text: string[]): LspDocument {
  const uri = createFakeUriPath(name);
  const doc = LspDocument.createTextDocumentItem(uri, text.join('\n'));
  // get the current workspace, if it exists, otherwise create a test workspace
  const workspace: Workspace = workspaceManager?.findContainingWorkspace(uri) || Workspace.syncCreateFromUri(uri)!;
  // Add the uri to the workspace if it isn't already there and it should be
  // This is to ensure that test workspaces group similar files together
  if (workspace.shouldContain(uri)) {
    workspace.add(uri);
  }
  // add the workspace to the `workspaces` array if it doesn't already exist
  // if (!workspaceManager.hasContainingWorkspace(uri)) {
  // }
  workspaceManager.add(workspace);
  testOpenDocument(doc);
  // update currentWorkspace.current with the new workspace
  // workspaceManager.setCurrent(workspace)
  return doc;
}

export function setupTestCallback(parser: Parser) {
  return function setupTestDocument(name: string, ...text: string[]): {
    doc: LspDocument;
    input: string;
    tree: Tree;
    root: SyntaxNode;
  } {
    const input = text.join('\n');
    const doc = createFakeLspDocument(name, input);
    const tree = parser.parse(input);
    const root = tree.rootNode;
    return { doc, tree, root, input };
  };
}

export function getAllTypesOfNestedArrays(doc: LspDocument, root: SyntaxNode) {
  const allNodes: SyntaxNode[] = getChildNodes(root);
  const allNamedNodes: SyntaxNode[] = getNamedChildNodes(root);
  const nodes: SyntaxNode[] = flattenNested(root);
  const flatNodes: SyntaxNode[] = flattenNested(root);
  const symbols: FishSymbol[] = processNestedTree(doc, root);
  const flatSymbols: FishSymbol[] = flattenNested(...symbols);

  return {
    allNodes,
    allNamedNodes,
    nodes,
    flatNodes,
    symbols,
    flatSymbols,
  };
}

export type PrintClientTreeOpts = { log: boolean; };

/**
 * Will print the client tree of document definition symbols
 */
export function printClientTree(
  opts: PrintClientTreeOpts = { log: true },
  ...symbols: FishSymbol[] | DocumentSymbol[]
): string[] {
  const result: string[] = [];

  function logAtLevel(indent = '', ...remainingSymbols: FishSymbol[] | DocumentSymbol[]): string[] {
    const newResult: string[] = [];
    remainingSymbols.forEach(n => {
      let kind = '';
      if (DocumentSymbol.is(n)) {
        kind = n.kind === SymbolKind.Function ? 'FUNCTION' : n.kind === SymbolKind.Variable ? 'VARIABLE' : n.kind === SymbolKind.Event ? 'EVENT' : n.kind.toString();
      }
      if (FishSymbol.is(n)) {
        kind = n.fishKind.toUpperCase();
      }
      if (opts.log && FishSymbol.is(n)) {
        console.log(`${indent}${n.name} --- ${kind} --- ${n.scope.scopeTag} --- ${n.scope.scopeNode.firstNamedChild?.text}`);
      } else if (opts.log && DocumentSymbol.is(n)) {
        console.log(`${indent}${n.name} --- ${kind} --- ${n.range.start.line}:${n.range.start.character} - ${n.range.end.line}:${n.range.end.character}`);
      }
      newResult.push(`${indent}${n.name}`);
      const children = n.children || [];
      newResult.push(...logAtLevel(indent + '    ', ...children));
    });
    return newResult;
  }
  result.push(...logAtLevel('', ...symbols));
  return result;
}

export function locationAsString(loc: Location): string[] {
  return [
    LspDocument.testUri(loc.uri),
    ...[loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character].map(s => s.toString()),
  ];
}

export function rangeAsString(range: Range): string {
  const result = [
    ...[range.start.line, range.start.character, range.end.line, range.end.character].map(s => s.toString()),
  ];
  return `[${result.join(', ')}]`;
}

export function fakeDocumentTrimUri(doc: LspDocument): string {
  if (['conf.d', 'functions', 'completions'].includes(doc.getAutoloadType())) {
    return [doc.getAutoloadType(), doc.getFileName()].join('/');
  }
  if ('config' === doc.getAutoloadType()) {
    return doc.getFileName();
  }
  return doc.getFileName();
}

export function printLocations(locations: Location[], opts: {
  verbose?: boolean;
  showText?: boolean;
  showLineText?: boolean;
  showIndex?: boolean;
  rangeVerbose?: boolean;
} = {
  verbose: false,
  showText: false,
  showLineText: false,
  rangeVerbose: false,
  showIndex: false,
}): void {
  locations.forEach((loc, idx) => {
    const doc = analyzer.started ? analyzer.getDocument(loc.uri) : undefined;
    const obj = {
      uri: LspDocument.testUri(loc.uri),
      range: rangeAsString(loc.range),
      startPos: opts.verbose || opts.rangeVerbose ? loc.range.start : undefined,
      endPos: opts.verbose || opts.rangeVerbose ? loc.range.end : undefined,
      text: opts.verbose || opts.showText ? analyzer.getTextAtLocation(loc) : undefined,
      lineText: opts.verbose || opts.showLineText ? doc?.getLine(loc.range) : undefined,
      index: opts.verbose || opts.showIndex ? idx.toString() : undefined,
    };
    const cleanObj = Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined),
    );
    console.log(cleanObj);
  });
}

/**
 * Call this function in a `beforeEach()`/`beforeAll()` block of a test suite, and
 * it will allow you to use fish-lsp's autoloaded fish variables in your tests.
 * ___
 * Example:
 * ___
 * ```typescript
 * import { fishLocations, FishLocations } from './helpers';
 * let locations: FishLocations;
 * describe('My test suite', () => {
 *   beforeAll(async () => {
 *     locations = await fishLocations();
 *   })
 *   it('does something', () => {
 *      expect(locations.paths.fish_config.dir).toBe('/home/user/.config/fish');
 *   });
 * })
 * ```
 * ___
 * @returns {Promise<FishLocations>} a promise that resolves to an object with uris and paths to common fish locations
 */
export async function fishLocations(): Promise<FishLocations> {
  await setupProcessEnvExecFile();

  const _fish_config_dir = env.getAsArray('__fish_config_dir').at(0)?.toString() || '';
  const _fish_config_config = path.join(_fish_config_dir, 'config.fish');
  const _fish_config_functions = path.join(_fish_config_dir, 'functions');
  const _fish_config_completions = path.join(_fish_config_dir, 'completions');
  const _fish_config_confd = path.join(_fish_config_dir, 'conf.d');

  const _fish_data_dir = env.getAsArray('__fish_data_dir').at(0)?.toString() || '';
  const _fish_data_config = path.join(_fish_data_dir, 'config.fish');
  const _fish_data_functions = path.join(_fish_data_dir, 'functions');
  const _fish_data_completions = path.join(_fish_data_dir, 'completions');
  const _fish_data_confd = path.join(_fish_data_dir, 'conf.d');

  const _fish_test_workspace_dir = path.join(__dirname, 'workspaces', 'workspace_1', 'fish').toString();
  const _fish_test_workspace_config = path.join(_fish_test_workspace_dir, 'config.fish');
  const _fish_test_workspace_functions = path.join(_fish_test_workspace_dir, 'functions');
  const _fish_test_workspace_completions = path.join(_fish_test_workspace_dir, 'completions');
  const _fish_test_workspace_confd = path.join(_fish_test_workspace_dir, 'conf.d');

  const _tmp_dir = path.join('tmp', 'fish_lsp_workspace');
  const _tmp_config = path.join(_tmp_dir, 'config.fish');
  const _tmp_functions = path.join(_tmp_dir, 'functions');
  const _tmp_completions = path.join(_tmp_dir, 'completions');
  const _tmp_confd = path.join(_tmp_dir, 'conf.d');

  function createFishLocationGroup(dir: string, config: string, functions: string, completions: string, confd: string) {
    return { dir, config, functions, completions, confd };
  }
  function createFishLocationGroupFromUri(dir: string, config: string, functions: string, completions: string, confd: string) {
    return { dir: createFakeUriPath(dir), config: createFakeUriPath(config), functions: createFakeUriPath(functions), completions: createFakeUriPath(completions), confd: createFakeUriPath(confd) };
  }
  return {
    paths: {
      fish_config: createFishLocationGroup(_fish_config_dir, _fish_config_config, _fish_config_functions, _fish_config_completions, _fish_config_confd),
      fish_data: createFishLocationGroup(_fish_data_dir, _fish_data_config, _fish_data_functions, _fish_data_completions, _fish_data_confd),
      test_workspace: createFishLocationGroup(_fish_test_workspace_dir, _fish_test_workspace_config, _fish_test_workspace_functions, _fish_test_workspace_completions, _fish_test_workspace_confd),
      tmp: createFishLocationGroup(_tmp_dir, _tmp_config, _tmp_functions, _tmp_completions, _tmp_confd),
    },
    uris: {
      fish_config: createFishLocationGroupFromUri(_fish_config_dir, _fish_config_config, _fish_config_functions, _fish_config_completions, _fish_config_confd),
      fish_data: createFishLocationGroupFromUri(_fish_data_dir, _fish_data_config, _fish_data_functions, _fish_data_completions, _fish_data_confd),
      test_workspace: createFishLocationGroupFromUri(_fish_test_workspace_dir, _fish_test_workspace_config, _fish_test_workspace_functions, _fish_test_workspace_completions, _fish_test_workspace_confd),
      tmp: createFishLocationGroupFromUri(_tmp_dir, _tmp_config, _tmp_functions, _tmp_completions, _tmp_confd),
    },
  } as const;
}

export type FishLocations = {
  /**
   * The paths to the fish directories/files
   */
  paths: {
    /**
     * __fish_config_dir
     */
    fish_config: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * __fish_data_dir
     */
    fish_data: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * test_workspace
     */
    test_workspace: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * /tmp/fish_lsp_workspace
     */
    tmp: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
  };
  /**
   * The URIs to the fish directories/files
   */
  uris: {
    /**
     * __fish_config_dir
     */
    fish_config: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * __fish_data_dir
     */
    fish_data: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * test_workspace
     */
    test_workspace: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
    /**
     * /tmp/fish_lsp_workspace
     */
    tmp: {
      dir: string;
      config: string;
      functions: string;
      completions: string;
      confd: string;
    };
  };
};

type FishTestWorkspaceLocation = {
  uri: string;
  path: string;
  documents: LspDocument[];
};

export function getAllFilesInDir(dir: string): {
  uri: string;
  path: string;
  functions: FishTestWorkspaceLocation;
  completions: FishTestWorkspaceLocation;
  confd: FishTestWorkspaceLocation;
  config: FishTestWorkspaceLocation;
  allDocuments: LspDocument[];
  allFiles: string[];
  allUris: string[];
} {
  const resultObj = {
    uri: pathToUri(dir),
    path: dir,
    functions: {
      uri: pathToUri(path.join(dir, 'functions')),
      path: path.join(dir, 'functions'),
      documents: [] as LspDocument[],
    },
    completions: {
      uri: pathToUri(path.join(dir, 'completions')),
      path: path.join(dir, 'completions'),
      documents: [] as LspDocument[],
    },
    confd: {
      uri: pathToUri(path.join(dir, 'conf.d')),
      path: path.join(dir, 'conf.d'),
      documents: [] as LspDocument[],
    },
    config: {
      uri: pathToUri(path.join(dir, 'config.fish')),
      path: path.join(dir, 'config.fish'),
      documents: [] as LspDocument[],
    },
    allDocuments: [] as LspDocument[],
    allFiles: [] as string[],
    allUris: [] as string[],
  };
  glob.sync('**/*.fish', { cwd: dir, absolute: true }).forEach(file => {
    const fileUri = pathToUri(file);
    const doc = LspDocument.createFromUri(fileUri);
    if (dir.endsWith('functions')) {
      resultObj.functions.documents.push(doc);
    } else if (dir.endsWith('completions')) {
      resultObj.completions.documents.push(doc);
    } else if (dir.endsWith('conf.d')) {
      resultObj.confd.documents.push(doc);
    } else if (file.endsWith('config.fish')) {
      resultObj.config.documents.push(doc);
    }
    resultObj.allDocuments.push(doc);
    resultObj.allFiles.push(file);
    resultObj.allUris.push(fileUri);
  });
  return resultObj;
}

export namespace TestWorkspaces {

  export const workspace1Path = path.join(__dirname, 'workspaces', 'workspace_1', 'fish');
  // export const workspace2Path = path.join(__dirname, 'workspaces', 'workspace_2');
  export const workspace3Path = path.join(__dirname, 'workspaces', 'workspace_3', 'fish');

  export const workspace1 = getAllFilesInDir(workspace1Path);
  // export const workspace2 = getAllFilesInDir(workspace2Path);
  export const workspace3 = getAllFilesInDir(workspace3Path);

  export function truncatedUri(doc: LspDocument, opts: {
    maxLength: number;
    showWorkspace: boolean;
  } = {
    maxLength: 80,
    showWorkspace: !doc.uri.includes('/fish/'),
  }): string {
    const endSearchStr = opts?.showWorkspace ? '/workspace_' : '/fish/';

    const start = doc.uri.slice(0, URI.parse(doc.uri).scheme.length + 3);
    const middle = '...';
    const end = doc.uri.slice(doc.uri.lastIndexOf(endSearchStr));
    let result = [
      start,
      middle,
      end,
    ].join('');

    if (opts?.maxLength < result.length) {
      result = [
        start,
        end,
      ].join('').toString();
    }
    return result;
  }
}

