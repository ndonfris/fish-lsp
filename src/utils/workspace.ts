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
import { AsyncFileHelper, SyncFileHelper } from './file-operations';
import { AnalyzedDocument, Analyzer } from '../analyze';
import { workspaces } from './workspace-manager';

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
  const result: Set<string> = new Set();
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
  results.forEach((ws) => {
    // logger.log(`Initialized workspace '${ws.name}' @ ${idx}`, {
    //   name: ws.name,
    //   uri: ws.uri,
    //   path: ws.path,
    // });
    workspaces.addWorkspace(ws);
  });
  // currentWorkspace = new CurrentWorkspace(workspaces);
  return results;
}

export async function findCurrentWorkspace(uri: string): Promise<Workspace | undefined> {
  for (const ws of workspaces.orderedWorkspaces()) {
    if (ws.contains(uri)) {
      return ws;
    }
  }
  workspaces.updateCurrentFromUri(uri);
  return workspaces.current;
}

export async function updateWorkspaces(event: LSP.WorkspaceFoldersChangeEvent) {
  const { added, removed } = event;
  for (const folder of added) {
    const workspace = await Workspace.createFromUri(folder.uri);
    if (workspace) {
      if (workspaces.exists(workspace.uri)) {
        workspaces.current = workspace;
        return;
      }
      workspaces.current = workspace;
      workspaces.addWorkspace(workspace);
    }
  }
  for (const folder of removed) {
    const workspace = workspaces.findWorkspace(folder.uri);
    if (workspace) {
      workspaces.removeWorkspace(workspace);
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

export interface FishWorkspace extends LSP.WorkspaceFolder {
  name: string;
  uri: string;
  path: string;
  allUris: Set<string>;
  contains(...checkUris: string[]): boolean;
  urisToLspDocuments(): LspDocument[];
  filter(callbackfn: (lspDocument: LspDocument) => boolean): LspDocument[];
  forEach(callbackfn: (lspDocument: LspDocument) => void): void;
}

export class Workspace implements FishWorkspace {
  public name: string;
  public uri: string;
  public path: string;
  private analyzedUris: Set<string> = new Set();
  private unanalyzedUris: Set<string> = new Set();
  public uris: Set<string> = new Set();
  public symbols: Map<string, FishSymbol[]> = new Map();

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

  public static syncCreateFromUri(uri: string) {
    const workspace = FishUriWorkspace.create(uri);
    if (!workspace) return null;
    let foundUris: Set<string> = new Set<string>();
    if (!workspace.path.startsWith('/tmp')) {
      foundUris = syncGetFileUriSet(workspace.path);
    } else {
      foundUris = new Set<string>([workspace.uri]);
    }
    return new Workspace(workspace.name, workspace.uri, workspace.path, foundUris);
  }

  public constructor(name: string, uri: string, path: string, fileUris: Set<string>) {
    this.name = name;
    this.uri = uri;
    this.path = path;
    this.unanalyzedUris = new Set(fileUris);
    this.uris = new Set(fileUris);
  }

  public get allUris() {
    // for (const uri of Array.from(this.unanalyzedUris)) {
    //   this.uris.add(uri);
    // }
    // for (const uri of Array.from(this.analyzedUris)) {
    //   this.uris.add(uri);
    // }
    // logger.log('allUris', {
    //   allUris: this.uris.size,
    //   analyzedUris: this.analyzedUris.size,
    //   unanalyzedUris: this.unanalyzedUris.size,
    // })
    const newSet = new Set<string>();
    for (const uri of Array.from(this.unanalyzedUris)) {
      newSet.add(uri);
    }
    for (const uri of Array.from(this.analyzedUris)) {
      newSet.add(uri);
    }
    for (const uri of Array.from(this.uris)) {
      newSet.add(uri);
    }
    return newSet;
  }

  public get allAnalyzedUris() {
    // logger.log('allAnalyzedUris', {
    //   allUris: this.allUris.size,
    //   analyzedUris: this.analyzedUris.size,
    //   unanalyzedUris: this.unanalyzedUris.size,
    // });
    return Array.from(this.analyzedUris);
  }

  public get allUnanalyzedUris() {
    return Array.from(this.unanalyzedUris);
  }

  contains(...checkUris: string[]) {
    for (const uri of checkUris) {
      if (!this.allUris.has(uri)) {
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
    return uri.startsWith(this.uri) && !this.analyzedUris.has(uri);
  }

  addUri(uri: string) {
    if (this.analyzedUris.has(uri)) {
      this.unanalyzedUris.add(uri);
      return;
    }
    this.analyzedUris.add(uri);
  }

  add(...newUris: string[]) {
    for (const newUri of newUris) {
      this.unanalyzedUris.add(newUri);
      this.uris.add(newUri);
    }
  }

  get urisToAnalyze() {
    return Array.from(this.unanalyzedUris);
  }

  analyzedUri(uri: string) {
    this.unanalyzedUris.delete(uri);
    this.analyzedUris.add(uri);
    this.uris.add(uri);
  }

  unanalyzeUri(uri: string) {
    this.unanalyzedUris.add(uri);
    this.analyzedUris.delete(uri);
    this.uris.add(uri);
  }

  findMatchingFishIdentifiers(fishIdentifier: string) {
    const matches: string[] = [];
    const toMatch = `/${fishIdentifier}.fish`;
    for (const uri of Array.from(this.analyzedUris)) {
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
    return this.unanalyzedUris.size === 0 && this.allUris.size > 0;
  }

  async updateFiles() {
    const newUris = await getFileUriSet(this.path);
    const diff = new Set(Array.from(this.analyzedUris).filter(x => !this.analyzedUris.has(x)));
    if (diff.size === 0) {
      return false;
    }
    newUris.forEach(uri => this.analyzedUris.add(uri));
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
    const readPromises = Array.from(this.analyzedUris).map(async uri => {
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

  async unanalyzedUrisToLspDocuments(): Promise<LspDocument[]> {
    let uris = Array.from(this.unanalyzedUris);
    // fix size if too big
    if (uris.length > config.fish_lsp_max_background_files) {
      uris = uris.slice(0, config.fish_lsp_max_background_files);
    }
    // build promise array
    const readPromises = uris.map(async uri => {
      const path = uriToPath(uri);
      const content = await promises.readFile(path, 'utf8');
      const doc = LspDocument.createTextDocumentItem(uri, content);
      documents.open(doc);
      return doc;
    });
    const docs = await Promise.all(readPromises);
    return docs.filter((doc): doc is LspDocument => doc !== null);
  }

  documentsToAnalyze(): LspDocument[] {
    const docs: LspDocument[] = [];
    for (const uri of this.urisToAnalyze) {
      const path = uriToPath(uri);
      const content = readFileSync(path);
      const doc = toLspDocument(path, content.toString());
      docs.push(doc);
    }
    return docs;
  }

  async analyze(analyzer: Analyzer) {
    const startTime = performance.now();
    const docs = await this.unanalyzedUrisToLspDocuments();
    for (const doc of docs) {
      this.analyzedUri(doc.uri);
      if (!doc.shouldAnalyzeInBackground()) continue;
      try {
        analyzer.analyze(doc);
      } catch (err) {
        logger.log(`Error analyzing file ${doc.uri}: ${err}`);
      }
    }
    const endTime = performance.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    logger.log(`Analyzed ${docs.length} files in ${totalTime} seconds`);
    // return await Promise.all(this.urisToLspDocuments().map(async path => analyzer.analyzeAsync(path)));
    // docs.forEach(doc => {
    //   analyzer.analyze(doc);
    // })
    // const analyzePromises = docs.map(async doc => {
    //   if (!doc.shouldAnalyzeInBackground()) return;
    //   try {
    //     analyzer.analyze(doc);
    //   } catch (err) {
    //     logger.log(`Error analyzing file ${doc.uri}: ${err}`);
    //   }
    // });
    // const analyzeResults = Promise.all(analyzePromises);
  }


  async asyncForEach(callback: (doc: LspDocument, index?: number, array?: LspDocument[]) => void): Promise<void> {
    const docs = await this.asyncUrisToLspDocuments();
    docs.forEach((doc, index, array) => callback(doc, index, array));
  }

  async asyncFilter(callbackfn: (doc: LspDocument) => boolean): Promise<LspDocument[]> {
    const docs = await this.asyncUrisToLspDocuments();
    return docs.filter(callbackfn);
  }

  urisToLspDocuments(): LspDocument[] {
    const docs: LspDocument[] = [];
    for (const uri of Array.from(this.allUris)) {
      const path = uriToPath(uri);
      const content = readFileSync(path);
      const doc = toLspDocument(path, content.toString());
      docs.push(doc);
    }
    return docs;
  }

  get paths() {
    return Array.from(this.allUris).map(uri => uriToPath(uri));
  }

  getUris() {
    return Array.from(this.allUris || []);
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

  /**
   * Creates an async generator that yields LspDocuments for all files in the workspace
   * This allows for efficient streaming and processing of documents
   */
  async *asyncDocumentGenerator(): AsyncGenerator<LspDocument> {
    // Process files in batches for better memory management
    const BATCH_SIZE = 20;
    const uriArray = Array.from(this.allUris);

    for (let i = 0; i < uriArray.length; i += BATCH_SIZE) {
      // Create a batch of promises for parallel file reading
      const batch = uriArray.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async uri => {
        try {
          const path = uriToPath(uri);
          const content = await promises.readFile(path, 'utf8');
          return toLspDocument(path, content);
        } catch (err) {
          logger.log(`Error reading file ${uri}: ${err}`);
          return null;
        }
      });

      // Process all files in the batch concurrently
      const results = await Promise.all(batchPromises);

      // Yield each valid document
      for (const doc of results) {
        if (doc !== null) {
          yield doc;
        }
      }
    }
  }

  public needsAnalysis() {
    return this.unanalyzedUris.size > 0;
  }

  analyzeWorkspacePromise(analyzer: Analyzer): AnalyzeWorkspacePromise {
    const callbackfn = async (uri: string) => {
      const path = uriToPath(uri);
      const content = await AsyncFileHelper.readFile(path);
      const newUris = analyzer.collectAllSources(uri);
      for (const newUri of Array.from(newUris)) {
        if (!this.uris.has(newUri)) {
          this.unanalyzedUris.add(newUri);
        }
      }
      const doc = toLspDocument(path, content);
      this.analyzedUri(uri);
      const result = analyzer.analyze(doc);
      return {
        uri,
        content,
        doc,
        result,
      };
    };
    const promises: ReturnType<typeof callbackfn>[] = [];
    for (const uri of this.allUnanalyzedUris) {
      promises.push(callbackfn(uri));
    }
    return promises;
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
    let base = basename(root);
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

