import * as fastGlob from 'fast-glob';
import fs from 'fs';
import path, { basename, dirname, join } from 'path';
import * as LSP from 'vscode-languageserver';
import { DocumentUri } from 'vscode-languageserver';
import { AnalyzedDocument, analyzer } from '../analyze';
import { config } from '../config';
import { LspDocument } from '../document';
import { logger } from '../logger';
import { FishSymbol } from '../parsing/symbol';
import { env } from './env-manager';
import { SyncFileHelper } from './file-operations';
import { pathToUri, uriToPath } from './translation';
import { workspaceManager } from './workspace-manager';

export type AnalyzedWorkspace = {
  uri: string;
  content: string;
  doc: LspDocument;
  result: AnalyzedDocument;
}[];

export type AnalyzeWorkspacePromise = Promise<{
  uri: string;
  content: string;
  doc: LspDocument;
  result: AnalyzedDocument;
}>[];

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

export async function getFileUriSet(path: string) {
  const stream = fastGlob.stream('**/*.fish', { cwd: path, absolute: true });
  const result: Set<DocumentUri> = new Set();
  for await (const entry of stream) {
    const absPath = entry.toString();
    const uri = pathToUri(absPath);
    result.add(uri);
  }
  return result;
}

export function syncGetFileUriSet(path: string) {
  const result: Set<string> = new Set();
  const entries = fastGlob.sync('**/*.fish', { cwd: path, absolute: true });
  for (const entry of entries) {
    const absPath = entry.toString();
    const uri = pathToUri(absPath);
    result.add(uri);
  }
  return result;
}

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

  const tmpConfigWorkspaces = FishUriWorkspace.initializeEnvWorkspaces();
  const configWorkspaces = tmpConfigWorkspaces.filter(ws =>
    !newWorkspaces.some(newWs => newWs.uri === ws.uri),
  );

  // merge both arrays but keep the unique uris in the order they were passed in
  const allWorkspaces = [
    ...newWorkspaces,
    ...configWorkspaces,
  ].filter((workspace, index, self) =>
    index === self.findIndex(w => w.uri === workspace.uri),
  ).map(({ name, uri, path }) => Workspace.create(name, uri, path));

  // Wait for all promises to resolve
  const defaultSpaces = await Promise.all(allWorkspaces);
  const results = defaultSpaces.filter((ws): ws is Workspace => ws !== null);
  results.forEach((ws, idx) => {
    logger.info(`Initialized workspace '${ws.name}' @ ${idx}`, {
      name: ws.name,
      uri: ws.uri,
      path: ws.path,
    });
    workspaceManager.add(ws);
  });
  return results;
}

export type WorkspaceUri = string;

export interface FishWorkspace extends LSP.WorkspaceFolder {
  name: string;
  uri: WorkspaceUri;
  path: string;
  uris: UriTracker;
  allUris: Set<string>;
  contains(...checkUris: string[]): boolean;
  allDocuments(): LspDocument[];
}

export class Workspace implements FishWorkspace {
  public name: string;
  public uri: WorkspaceUri;
  public path: string;
  public uris = new UriTracker();
  public symbols: Map<string, FishSymbol[]> = new Map();

  public static async create(name: string, uri: DocumentUri | WorkspaceUri, path: string) {
    const isDirectory = SyncFileHelper.isDirectory(path);
    let foundUris: Set<string> = new Set<string>();
    if (isDirectory) {
      if (!path.startsWith('/tmp')) {
        foundUris = await getFileUriSet(path);
      }
    } else {
      foundUris = new Set<string>([uri]);
    }
    return new Workspace(name, uri, path, foundUris);
  }

  public static syncCreateFromUri(uri: string) {
    const path = uriToPath(uri);
    try {
      const isDirectory = SyncFileHelper.isDirectory(path);
      const workspace = FishUriWorkspace.create(uri);
      if (!workspace) return null;
      let foundUris: Set<string> = new Set<string>();
      if (isDirectory || SyncFileHelper.isDirectory(workspace.path)) {
        if (!workspace.path.startsWith('/tmp')) {
          foundUris = syncGetFileUriSet(workspace.path);
        }
      } else {
        foundUris = new Set<string>([workspace.uri]);
      }
      return new Workspace(workspace.name, workspace.uri, workspace.path, foundUris);
    } catch (e) {
      logger.error('syncCreateFromUri', { uri, error: e });
      return null;
    }
  }

  public constructor(name: string, uri: WorkspaceUri, path: string, fileUris: Set<DocumentUri>) {
    this.name = name;
    this.uri = uri;
    this.path = path;
    this.uris = UriTracker.create(...Array.from(fileUris));
  }

  public get allUris(): Set<DocumentUri> {
    return this.uris.allAsSet();
  }

  contains(...checkUris: DocumentUri[]): boolean {
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
  shouldContain(uri: DocumentUri) {
    return uri.startsWith(this.uri) && !this.uris.allAsSet().has(uri);
  }

  addUri(uri: DocumentUri) {
    this.uris.add(uri);
  }

  add(...newUris: DocumentUri[]) {
    this.uris.add(...newUris);
  }

  addPending(...newUris: DocumentUri[]) {
    this.uris.addPending(newUris);
  }

  findMatchingFishIdentifiers(fishIdentifier: string) {
    const matches: string[] = [];
    const toMatch = `/${fishIdentifier}.fish`;
    for (const uri of Array.from(this.uris.allAsSet())) {
      if (uri.endsWith(toMatch)) {
        matches.push(uri);
      }
    }
    return matches;
  }

  findDocument(callbackfn: (doc: LspDocument) => boolean): LspDocument | undefined {
    for (const uri of this.uris.all) {
      const doc = analyzer.getDocument(uri);
      if (doc && callbackfn(doc)) {
        return doc;
      }
    }
    return undefined;
  }

  /**
   * An immutable workspace would be '/usr/share/fish', since we don't want to
   * modify the system files.
   *
   * A mutable workspace would be '~/.config/fish'
   */
  isMutable() {
    return config.fish_lsp_modifiable_paths.includes(this.path) || SyncFileHelper.isWriteable(this.path);
  }

  isLoadable() {
    return config.fish_lsp_all_indexed_paths.includes(this.path);
  }

  isAnalyzed() {
    return this.uris.pendingCount === 0 && this.allUris.size > 0;
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

  pendingDocuments(): LspDocument[] {
    const docs: LspDocument[] = [];
    for (const uri of this.uris.pending) {
      const path = uriToPath(uri);
      const doc = SyncFileHelper.loadDocumentSync(path);
      if (!doc) {
        logger.error('pendingDocuments', { uri, path });
        continue;
      }
      docs.push(doc);
    }
    return docs;
  }

  allDocuments(): LspDocument[] {
    const docs: LspDocument[] = [];
    for (const uri of this.uris.all) {
      const analyzedDoc = analyzer.getDocument(uri);
      if (analyzedDoc) {
        docs.push(analyzedDoc);
        continue;
      }
      const path = uriToPath(uri);
      const doc = SyncFileHelper.loadDocumentSync(path);
      if (!doc) {
        logger.error('allDocuments', { uri, path });
        continue;
      }
      docs.push(doc);
    }
    return docs;
  }

  get paths(): string[] {
    return Array.from(this.allUris).map(uri => uriToPath(uri));
  }

  getUris(): DocumentUri[] {
    return Array.from(this.allUris || []);
  }

  equals(other: FishWorkspace | null) {
    if (!other) return false;
    return this.name === other.name && this.uri === other.uri && this.path === other.path;
  }

  public needsAnalysis() {
    return this.uris.pendingCount > 0;
  }

  setAllPending() {
    for (const uri of this.uris.all) {
      this.uris.markPending(uri);
    }
  }

  toTreeString() {
    const tree: string[] = [];
    const buildTree = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach((entry, index) => {
        const isLast = index === entries.length - 1;
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
        tree.push(currentPrefix + entry.name);

        if (entry.isDirectory()) {
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          buildTree(path.join(dir, entry.name), nextPrefix);
        }
      });
    };

    tree.push(this.name + '/');
    buildTree(this.path, '');
    return tree.join('\n');
  }

  showAllTreeSitterParseTrees() {
    const docs = this.allDocuments();
    if (docs.length === 0) {
      logger.warning('No documents found in workspace', { name: this.name, uri: this.uri });
      return;
    }
    docs.forEach(doc => {
      doc.showTree();
    });
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
    // if (root.endsWith('/.config/fish')) return '__fish_config_dir';
    // const specialName = autoloadedFishVariableNames.find(loadedName => process.env[loadedName] === root);
    const specialName = env.findAutolaodedKey(root);

    // env.getAutoloadedKeys().forEach((key) => {
    //   logger.log(key, env.getAsArray(key));
    // })
    logger.debug('getWorkspaceName', { root, specialName });

    if (specialName) return specialName;

    // get the base of the path, if it is a fish workspace (ends in `fish`)
    // return the entire path name as the name of the workspace
    const base = basename(root);
    if (base === 'fish') return root;

    // For other paths, return the workspace root's basename
    return base;
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
      .map(path => create(pathToUri(path)))
      .filter((ws): ws is FishUriWorkspace => ws !== null);
  }

  /**
   * Creates a FishUriWorkspace from a URI
   * @returns null if the URI is not in a fish workspace, otherwise the workspace
   */
  export function create(uri: string): FishUriWorkspace | null {
    // skip workspaces for tmp
    if (isTmpWorkspace(uri)) {
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

/**
 * Minimal tracker for URI analysis status within a workspace
 */
export class UriTracker {
  private _indexed = new Set<string>();
  private _pending = new Set<string>();

  static create(...uris: string[]) {
    const tracker = new UriTracker();
    for (const uri of uris) {
      tracker.add(uri);
    }
    return tracker;
  }

  /**
   * Add URIs to pending if not already indexed
   */
  add(...uris: string[]) {
    for (const uri of uris) {
      if (!this._indexed.has(uri)) {
        this._pending.add(uri);
      }
    }
    return this;
  }

  /**
   * Add URIs to pending analysis
   */
  addPending(uris: string[]) {
    for (const uri of uris) {
      if (!this._indexed.has(uri)) {
        this._pending.add(uri);
      }
    }
    return this;
  }

  /**
   * Mark URI as indexed (analyzed)
   */
  markIndexed(uri: string): void {
    this._pending.delete(uri);
    this._indexed.add(uri);
  }

  /**
   * Mark URI as pending analysis
   */
  markPending(uri: string): void {
    this._indexed.delete(uri);
    this._pending.add(uri);
  }

  /**
   * Get all URIs (both indexed and pending)
   */
  get all(): string[] {
    return [...this._indexed, ...this._pending];
  }

  allAsSet(): Set<string> {
    return new Set<string>([...this._indexed, ...this._pending]);
  }

  /**
   * Get all indexed URIs
   */
  get indexed(): string[] {
    return Array.from(this._indexed);
  }

  /**
   * Get all pending URIs
   */
  get pending(): string[] {
    return Array.from(this._pending);
  }

  /**
   * Get pending URIs count
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Get indexed URIs count
   */
  get indexedCount(): number {
    return this._indexed.size;
  }

  /**
   * Check if URI is indexed
   */
  isIndexed(uri: string): boolean {
    return this._indexed.has(uri);
  }

  has(uri: string): boolean {
    return this._indexed.has(uri) || this._pending.has(uri);
  }
}
