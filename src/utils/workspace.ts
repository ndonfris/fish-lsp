import * as fastGlob from 'fast-glob';
import { readFileSync, promises } from 'fs';
import { pathToUri, toLspDocument, uriToPath } from './translation';
import { LspDocument, documents } from '../document';
import { FishSymbol } from '../parsing/symbol';
import { config } from '../config';
import { logger } from '../logger';
import { basename, dirname, join } from 'path';
import * as LSP from 'vscode-languageserver';
import { env } from './env-manager';
import { SyncFileHelper } from './file-operations';

/**
 * Extracts the unique workspace paths from the initialization parameters.
 * @param params - The initialization parameters
 * @returns The unique workspace paths given in the initialization parameters
 */
export function getWorkspacePathsFromInitializationParams(params: LSP.InitializeParams): string[] {
  const result: string[] = [];

  const { rootUri, rootPath, workspaceFolders } = params;
  logger.log('getWorkspacePathsFromInitializationParams(params)', { rootUri, rootPath, workspaceFolders });

  // consider removing rootUri and rootPath since they are deprecated

  if (rootUri) {
    result.push(uriToPath(rootUri));
  }
  if (rootPath) {
    result.push(rootPath);
  }
  if (workspaceFolders) {
    result.push(...workspaceFolders.map(folder => uriToPath(folder.uri)));
  }

  return Array.from(new Set(result));
}

async function getFileUriSet(path: string) {
  const stream = fastGlob.stream('**/*.fish', { cwd: path, absolute: true });
  const result: Set<string> = new Set();
  for await (const entry of stream) {
    const absPath = entry.toString();
    const uri = pathToUri(absPath);
    result.add(uri);
  }
  return result;
}

/**
 * global array of workspaces used for analyzing and grouping symbols
 * ___
 * You can add workspaces to this array by directly pushing into it.
 * ___
 * ```typescript
 * const newWorkspace = await Workspace.create('name', 'uri', 'path');
 * workspaces.push(newWorkspace);
 * ```
 * ___
 * `initializeDefaultFishWorkspaces()` will store all new workspaces into this array
 */
export const workspaces: Workspace[] = [];

/**
 * Initializes the default fish workspaces. Does not control the currentWorkspace, only sets it up.
 *
 * UPDATES the `config.fish_lsp_single_workspace_support` if user sets it to true, and no workspaces are found (`/tmp` workspace will cause this).
 *
 * @param uris - The uris to initialize the workspaces with, if any
 * @returns The workspaces that were initialized, or an empty array if none were found (unlikely)
 */
export async function initializeDefaultFishWorkspaces(...uris: string[]): Promise<Workspace[]> {
  /** Compute the newWorkaces from the uris, before building if the configWorkspaces */
  const newWorkspaces = uris.map(uri => {
    return FishUriWorkspace.create(uri);
  }).filter((ws): ws is FishUriWorkspace => ws !== null);

  /** fix single workspace support if no workspaces were found */
  // if (newWorkspaces.length === 0 && config.fish_lsp_single_workspace_support) {
  //   logger.log('No new workspaces found');
  //   config.fish_lsp_single_workspace_support = false;
  // }

  const configWorkspaces = FishUriWorkspace.initializeEnvWorkspaces();

  /** don't add duplicates to the workspaces */
  const toAddWorkspaces = newWorkspaces.filter(ws =>
    !configWorkspaces.some(configWs => configWs.uri === ws.uri),
  );

  // merge both arrays but keep the unique uris in the order they were passed in
  const allWorkspaces = [
    ...configWorkspaces,
    ...toAddWorkspaces,
  ].filter((workspace, index, self) =>
    index === self.findIndex(w => w.uri === workspace.uri),
  ).map(({ name, uri, path }) => Workspace.create(name, uri, path));

  // Wait for all promises to resolve
  const defaultSpaces = await Promise.all(allWorkspaces);
  const results = defaultSpaces.filter((ws): ws is Workspace => ws !== null);
  results.forEach((ws, idx) => {
    logger.log(`Initialized workspace '${ws.name}' @ ${idx}`, {
      name: ws.name,
      uri: ws.uri,
      path: ws.path,
    });
    workspaces.push(ws);
  });
  currentWorkspace = new CurrentWorkspace(workspaces);
  return results;
}

export async function findCurrentWorkspace(uri: string): Promise<Workspace | null> {
  for (const ws of workspaces) {
    if (ws.uri === uri || ws.contains(uri)) {
      currentWorkspace.current = ws;
      return ws;
    }
  }
  currentWorkspace.current = await Workspace.createFromUri(uri);
  return currentWorkspace.current;
}

export async function updateWorkspaces(event: LSP.WorkspaceFoldersChangeEvent) {
  const { added, removed } = event;
  for (const folder of added) {
    const workspace = await Workspace.createFromUri(folder.uri);
    if (workspace) {
      if (currentWorkspace.workspaceExists(workspace.uri)) {
        currentWorkspace.current = workspace;
        return;
      }
      currentWorkspace.current = workspace;
      workspaces.push(workspace);
    }
  }
  for (const folder of removed) {
    const workspace = workspaces.find(ws => ws.uri === folder.uri);
    if (workspace) {
      workspaces.splice(workspaces.indexOf(workspace), 1);
    }
  }
}

export async function getRelevantDocs(workspaces: Workspace[]): Promise<LspDocument[]> {
  const docs: LspDocument[] = [];
  for await (const ws of workspaces) {
    const workspaceDocs = await ws.asyncFilter((doc: LspDocument) => doc.shouldAnalyzeInBackground());
    docs.push(...workspaceDocs);
  }
  return docs;
}

export class CurrentWorkspace {
  private _current: Workspace | null = null;
  constructor(private all: Workspace[] = []) { }

  static create() {
    return new CurrentWorkspace();
  }

  set current(ws: Workspace | null) {
    if (ws && !this.all.includes(ws)) {
      this.all.push(ws);
    }
    this._current = ws;
  }

  get current(): Workspace | null {
    if (this._current) return this._current;
    return null;
  }

  updateCurrent(doc: LspDocument) {
    for (const ws of this.all) {
      if (ws.contains(doc.uri)) {
        this._current = ws;
        return;
      }
    }
  }

  updateWorkspace(workspace: Workspace) {
    for (const ws of this.all) {
      if (ws.contains(workspace.uri)) {
        this.current = workspace;
        return;
      }
    }
    this.current = workspace;
  }

  findWorkspace(uri: string) {
    return this.all.find(ws => ws.contains(uri) || ws.uri === uri || uri.startsWith(ws.uri));
  }

  workspaceExists(uri: string) {
    return this.findWorkspace(uri) !== undefined;
  }

  removeWorkspace(uri: string) {
    const workspace = this.findWorkspace(uri);
    if (workspace) {
      const index = this.all.indexOf(workspace);
      this.all.splice(index, 1);
      workspaces.splice(workspaces.indexOf(workspace), 1);
    }
  }

  async updateCurrentWorkspace(uri: string) {
    if (this.workspaceExists(uri)) {
      this._current = this.findWorkspace(uri)!;
      return;
    }
    const workspace = await Workspace.createFromUri(uri);
    if (workspace) {
      this._current = workspace;
      workspaces.push(workspace);
    }
  }

  get workspaces() {
    return this.all;
  }

  hasWorkspaces() {
    return this.all.length > 0;
  }

  addNewWorkspace(workspace: Workspace) {
    this.current = workspace;
  }
}

export interface FishWorkspace extends LSP.WorkspaceFolder {
  name: string;
  uri: string;
  path: string;
  uris: Set<string>;
  contains(...checkUris: string[]): boolean;
  urisToLspDocuments(): LspDocument[];
  filter(callbackfn: (lspDocument: LspDocument) => boolean): LspDocument[];
  forEach(callbackfn: (lspDocument: LspDocument) => void): void;
}

export class Workspace implements FishWorkspace {
  public name: string;
  public uri: string;
  public path: string;
  public uris: Set<string>;
  public symbols: Map<string, FishSymbol[]> = new Map();
  private entireWorkspaceAnalyzed = false;

  public static async create(name: string, uri: string, path: string) {
    let foundUris: Set<string> = new Set<string>();
    if (!path.startsWith('/tmp')) {
      foundUris = await getFileUriSet(path);
    } else {
      foundUris = new Set<string>([uri]);
    }
    return new Workspace(name, uri, path, foundUris);
  }

  public static createTestWorkspaceFromUri(uri: string) {
    const workspace = FishUriWorkspace.create(uri);
    if (!workspace) return undefined as never;
    const newUris = new Set<string>();
    newUris.add(uri);
    return new Workspace(workspace.name, workspace.uri, workspace.path, newUris);
  }

  public static async createFromUri(uri: string) {
    const workspace = FishUriWorkspace.create(uri);
    if (!workspace) return null;
    let foundUris: Set<string> = new Set<string>();
    if (!workspace.path.startsWith('/tmp')) {
      foundUris = await getFileUriSet(workspace.path);
    } else {
      foundUris = new Set<string>([workspace.uri]);
    }
    return new Workspace(workspace.name, workspace.uri, workspace.path, foundUris);
  }

  public constructor(name: string, uri: string, path: string, fileUris: Set<string>) {
    this.name = name;
    this.uri = uri;
    this.path = path;
    this.uris = fileUris;
  }

  contains(...checkUris: string[]) {
    for (const uri of checkUris) {
      if (!this.uris.has(uri)) {
        return false;
      }
    }
    return true;
  }

  /**
   * mostly for testing, (i.e., when writing at test that doesn't actually put any *.fish uri into memory)
   * @param uri - the uri to check if the the workspace should contain
   * @returns true if the uri is inside the workspace (inside meaning the uri starts with the workspace uri)
   */
  shouldContain(uri: string) {
    return uri.startsWith(this.uri) && !this.uris.has(uri);
  }

  addUri(uri: string) {
    this.uris.add(uri);
  }

  add(...newUris: string[]) {
    for (const newUri of newUris) {
      this.uris.add(newUri);
    }
  }

  findMatchingFishIdentifiers(fishIdentifier: string) {
    const matches: string[] = [];
    const toMatch = `/${fishIdentifier}.fish`;
    for (const uri of Array.from(this.uris)) {
      if (uri.endsWith(toMatch)) {
        matches.push(uri);
      }
    }
    return matches;
  }

  /**
   * An immutable workspace would be '/usr/share/fish', since we don't want to
   * modify the system files.
   *
   * A mutable workspace would be '~/.config/fish'
   */
  isMutable() {
    return config.fish_lsp_modifiable_paths.includes(this.path);
  }

  isLoadable() {
    return config.fish_lsp_all_indexed_paths.includes(this.path);
  }

  isAnalyzed() {
    return this.entireWorkspaceAnalyzed;
  }

  removeAnalyzed() {
    this.entireWorkspaceAnalyzed = false;
  }

  setAnalyzed() {
    this.entireWorkspaceAnalyzed = true;
  }

  async updateFiles() {
    const newUris = await getFileUriSet(this.path);
    const diff = new Set(Array.from(this.uris).filter(x => !this.uris.has(x)));
    if (diff.size === 0) {
      return false;
    }
    newUris.forEach(uri => this.uris.add(uri));
    return true;
  }

  hasCompletionUri(fishIdentifier: string) {
    const matchingUris = this.findMatchingFishIdentifiers(fishIdentifier);
    return matchingUris.some(uri => uri.endsWith(`/completions/${fishIdentifier}.fish`));
  }

  hasFunctionUri(fishIdentifier: string) {
    const matchingUris = this.findMatchingFishIdentifiers(fishIdentifier);
    return matchingUris.some(uri => uri.endsWith(`/functions/${fishIdentifier}.fish`));
  }

  hasCompletionAndFunction(fishIdentifier: string) {
    return this.hasFunctionUri(fishIdentifier) && this.hasCompletionUri(fishIdentifier);
  }

  getCompletionUri(fishIdentifier: string) {
    const matchingUris = this.findMatchingFishIdentifiers(fishIdentifier);
    return matchingUris.find(uri => uri.endsWith(`/completions/${fishIdentifier}.fish`));
  }

  async asyncUrisToLspDocuments(): Promise<LspDocument[]> {
    const readPromises = Array.from(this.uris).map(async uri => {
      try {
        const path = uriToPath(uri);
        const content = await promises.readFile(path, 'utf8');
        const doc = LspDocument.createTextDocumentItem(uri, content);
        documents.open(doc);
        return doc;
      } catch (err) {
        logger.log(`Error reading file ${uri}: ${err}`);
        return null;
      }
    });

    const docs = await Promise.all(readPromises);
    return docs.filter((doc): doc is LspDocument => doc !== null);
  }

  async asyncForEach(callback: (doc: LspDocument) => void): Promise<void> {
    const docs = await this.asyncUrisToLspDocuments();
    docs.forEach(callback);
  }

  async asyncFilter(callbackfn: (doc: LspDocument) => boolean): Promise<LspDocument[]> {
    const docs = await this.asyncUrisToLspDocuments();
    return docs.filter(callbackfn);
  }

  urisToLspDocuments(): LspDocument[] {
    const docs: LspDocument[] = [];
    for (const uri of Array.from(this.uris)) {
      const path = uriToPath(uri);
      const content = readFileSync(path);
      const doc = toLspDocument(path, content.toString());
      docs.push(doc);
    }
    return docs;
  }

  getUris() {
    return Array.from(this.uris || []);
  }

  forEach(callback: (lspDocument: LspDocument) => void) {
    for (const doc of this.urisToLspDocuments()) {
      callback(doc);
    }
  }

  filter(callbackfn: (lspDocument: LspDocument) => boolean): LspDocument[] {
    const result: LspDocument[] = [];
    for (const doc of this.urisToLspDocuments()) {
      if (callbackfn(doc)) {
        result.push(doc);
      }
    }
    return result;
  }

  equals(other: FishWorkspace | null) {
    if (!other) return false;
    return this.name === other.name && this.uri === other.uri && this.path === other.path;
  }
}

export interface FishUriWorkspace {
  name: string;
  uri: string;
  path: string;
}

export namespace FishUriWorkspace {

  /** special location names */
  const FISH_DIRS = ['functions', 'completions', 'conf.d'];
  const CONFIG_FILE = 'config.fish';

  export function isTmpWorkspace(uri: string) {
    const path = uriToPath(uri);
    return path.startsWith('/tmp');
  }

  /**
   * Removes file path component from a fish file URI unless it's config.fish
   */
  export function trimFishFilePath(uri: string): string | undefined {
    const path = uriToPath(uri);
    if (!path) return undefined;

    const base = basename(path);
    if (base === CONFIG_FILE || path.startsWith('/tmp')) return path;
    return !SyncFileHelper.isDirectory(path) && base.endsWith('.fish') ? dirname(path) : path;
  }

  /**
   * Gets the workspace root directory from a URI
   */
  export function getWorkspaceRootFromUri(uri: string): string | undefined {
    const path = uriToPath(uri);
    if (!path) return undefined;

    let current = path;
    const base = basename(current);

    if (current.startsWith('/tmp')) {
      return current;
    }

    // check if the path is a fish workspace
    // (i.e., `~/.config/fish`, `/usr/share/fish`, `~/some_plugin`)
    if (SyncFileHelper.isDirectory(current) && isFishWorkspacePath(current)) {
      return current;
    }

    // If path is a fish directory or config.fish, return parent
    // Check if the parent is a fish directory or the current is config.fish
    // (i.e., `~/.config/fish/{functions,conf.d,completions}`, `~/.config/fish/config.fish`)
    if (FISH_DIRS.includes(base) || base === CONFIG_FILE) {
      return dirname(current);
    }

    // If a single workspace is supported is true, return the path
    // if (config.fish_lsp_single_workspace_support) {
    //   const indexedPath = config.fish_lsp_all_indexed_paths.find(p => path.startsWith(p));
    //   if (indexedPath) return indexedPath;
    //   return path;
    // }

    // Walk up looking for fish workspace indicators
    while (current !== dirname(current)) {
      // Check for fish dirs in current directory
      for (const dir of FISH_DIRS) {
        if (basename(current) === dir) {
          return dirname(current);
        }
      }

      // Check for config.fish or fish dirs as children
      if (
        FISH_DIRS.some(dir => isFishWorkspacePath(join(current, dir))) ||
        isFishWorkspacePath(join(current, CONFIG_FILE))) {
        return current;
      }

      current = dirname(current);
    }

    // Check if we're in a configured path
    return config.fish_lsp_all_indexed_paths.find(p => path.startsWith(p));
  }

  /**
   * Gets a human-readable name for the workspace root
   */
  export function getWorkspaceName(uri: string): string {
    const root = getWorkspaceRootFromUri(uri);
    if (!root) return '';

    // Special cases for system directories
    if (root.endsWith('/.config/fish')) return '__fish_config_dir';
    // const specialName = autoloadedFishVariableNames.find(loadedName => process.env[loadedName] === root);
    const specialName = env.getAutoloadedKeys()
      .find(k => env.getAsArray(k).includes(root));

    if (specialName) return specialName;
    // if (root === '/usr/share/fish') return '__fish_data_dir';

    // For other paths, return the workspace root's basename
    return basename(root);
  }

  /**
   * Checks if a path indicates a fish workspace
   */
  export function isFishWorkspacePath(path: string): boolean {
    if (SyncFileHelper.isDirectory(path) &&
      (SyncFileHelper.exists(`${path}/functions`) ||
        SyncFileHelper.exists(`${path}/completions`) ||
        SyncFileHelper.exists(`${path}/conf.d`)
      )
    ) {
      return SyncFileHelper.isDirectory(path);
    }
    if (basename(path) === CONFIG_FILE) {
      return true;
    }
    return config.fish_lsp_all_indexed_paths.includes(path);
  }

  /**
   * Determines if a URI is within a fish workspace
   */
  export function isInFishWorkspace(uri: string): boolean {
    return getWorkspaceRootFromUri(uri) !== undefined;
  }

  export function initializeEnvWorkspaces(): FishUriWorkspace[] {
    // if (config.fish_lsp_single_workspace_support) return [];
    return config.fish_lsp_all_indexed_paths
      .map(path => create(path))
      .filter((ws): ws is FishUriWorkspace => ws !== null);
  }

  /**
   * Creates a FishUriWorkspace from a URI
   * @returns null if the URI is not in a fish workspace, otherwise the workspace
   */
  export function create(uri: string): FishUriWorkspace | null {
    // skip workspaces for tmp
    if (isTmpWorkspace(uri)) {
      // workaround -- disable single workspace support if there is no workspace
      // config.fish_lsp_single_workspace_support = false;
      // return null;
      return {
        name: uriToPath(uri),
        uri,
        path: uriToPath(uri),
      };
    }

    if (!isInFishWorkspace(uri)) return null;

    const trimmedUri = trimFishFilePath(uri);
    if (!trimmedUri) return null;

    const rootPath = getWorkspaceRootFromUri(trimmedUri);
    const workspaceName = getWorkspaceName(trimmedUri);

    if (!rootPath || !workspaceName) return null;

    return {
      name: workspaceName,
      uri: pathToUri(rootPath),
      path: rootPath,
    };
  }
}
export let currentWorkspace: CurrentWorkspace = CurrentWorkspace.create();

