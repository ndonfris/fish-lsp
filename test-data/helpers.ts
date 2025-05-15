import { readFileSync } from 'fs';
import * as path from 'path';
import { resolve } from 'path';
import { initializeParser } from '../src/parser';
import * as Parser from 'web-tree-sitter';
import { Point, SyntaxNode, Tree } from 'web-tree-sitter';
import { TextDocumentItem, Location } from 'vscode-languageserver';
import { LspDocument } from '../src/document';
import { homedir } from 'os';
import { Workspace } from '../src/utils/workspace';
import { workspaces } from '../src/utils/workspace-manager';
import { flattenNested } from '../src/utils/flatten';
import { getChildNodes, getNamedChildNodes } from '../src/utils/tree-sitter';
import { FishSymbol, processNestedTree } from '../src/parsing/symbol';
import { Analyzer } from '../src/analyze';
import { env } from '../src/utils/env-manager';
import { setupProcessEnvExecFile } from '../src/utils/process-env';

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
 * @param {string} fname - relative path to file, in test-data folder
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
  const workspace: Workspace = workspaces?.findWorkspace(uri) || Workspace.createTestWorkspaceFromUri(uri);
  // Add the uri to the workspace if it isn't already there and it should be
  // This is to ensure that test workspaces group similar files together
  if (workspace.shouldContain(uri)) {
    workspace.add(uri);
  }
  // add the workspace to the `workspaces` array if it doesn't already exist
  if (!workspaces.workspaces.find(ws => ws.uri === workspace.uri)) {
    workspaces.addWorkspace(workspace);
  }
  // update currentWorkspace.current with the new workspace
  workspaces.current = workspace;
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
  ...symbols: FishSymbol[]
): string[] {
  const result: string[] = [];

  function logAtLevel(indent = '', ...remainingSymbols: FishSymbol[]) {
    const newResult: string[] = [];
    remainingSymbols.forEach(n => {
      if (opts.log) {
        console.log(`${indent}${n.name} --- ${n.fishKind} --- ${n.scope.scopeTag} --- ${n.scope.scopeNode.firstNamedChild?.text}`);
      }
      newResult.push(`${indent}${n.name}`);
      newResult.push(...logAtLevel(indent + '    ', ...n.children));
    });
    return newResult;
  }
  result.push(...logAtLevel('', ...symbols));
  return result;
}

export function locationAsString(loc: Location): string[] {
  return [
    loc.uri,
    ...[loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character].map(s => s.toString()),
  ];
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
