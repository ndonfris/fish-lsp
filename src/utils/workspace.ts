import * as fastGlob from 'fast-glob';
import { readFileSync, promises } from 'fs';
import { pathToUri, toLspDocument, uriToPath } from './translation';
import { LspDocument } from '../document';
import { FishDocumentSymbol } from '../document-symbol';
import { config } from '../config';
import { logger } from '../logger';
import { basename, dirname, join } from 'path';
import { autoloadedFishVariableNames } from './process-env';
import * as LSP from 'vscode-languageserver';

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

export async function initializeDefaultFishWorkspaces(...uris: string[]): Promise<Workspace[]> {
  const configWorkspaces = FishUriWorkspace.initializeEnvWorkspaces();
  // Create an array of promises by mapping over workspacePaths
  const workspacePromises = [
    ...configWorkspaces.map(({ name, uri, path }) => Workspace.create(name, uri, path)),
    ...uris.filter(u => u.trim() !== '').map(u => Workspace.createFromUri(u)),
  ];

  // Wait for all promises to resolve
  const defaultSpaces = await Promise.all(workspacePromises);
  const results = defaultSpaces.filter((ws): ws is Workspace => ws !== null);
  workspaces.push(...results);
  return results;
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
  public symbols: Map<string, FishDocumentSymbol[]> = new Map();

  public static async create(name: string, uri: string, path: string) {
    const foundUris = await getFileUriSet(path);
    return new Workspace(name, uri, path, foundUris);
  }

  public static async createFromUri(uri: string) {
    const workspace = FishUriWorkspace.create(uri);
    if (!workspace) return null;
    const foundUris = await getFileUriSet(workspace.path);
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
      const uriAsPath = uriToPath(uri);
      if (!uriAsPath.startsWith(this.path)) {
        return false;
      }
      //if (!this.uris.has(uri)) return false
    }
    return true;
  }

  add(...newUris: string[]) {
    for (const newUri of newUris) {
      this.uris.add(newUri);
    }
  }

  findMatchingFishIdentifiers(fishIdentifier: string) {
    const matches: string[] = [];
    const toMatch = `/${fishIdentifier}.fish`;
    for (const uri of this.uris) {
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

  async updateFiles() {
    const newUris = await getFileUriSet(this.path);
    const diff = new Set([...this.uris].filter(x => !this.uris.has(x)));
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

  async asyncUrisToLspDocuments(): Promise<LspDocument[]> {
    const readPromises = Array.from(this.uris).map(async uri => {
      try {
        const path = uriToPath(uri);
        const content = await promises.readFile(path, 'utf8');
        return toLspDocument(path, content);
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
    for (const uri of this.uris) {
      const path = uriToPath(uri);
      const content = readFileSync(path);
      const doc = toLspDocument(path, content.toString());
      docs.push(doc);
    }
    return docs;
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

  /**
   * Removes file path component from a fish file URI unless it's config.fish
   */
  export function trimFishFilePath(uri: string): string | undefined {
    const path = uriToPath(uri);
    if (!path) return undefined;

    const base = basename(path);
    if (base === CONFIG_FILE) return path;
    return base.endsWith('.fish') ? dirname(path) : path;
  }

  /**
   * Gets the workspace root directory from a URI
   */
  export function getWorkspaceRootFromUri(uri: string): string | undefined {
    const path = uriToPath(uri);
    if (!path) return undefined;

    let current = path;
    const base = basename(current);

    // If path is a fish directory or config.fish, return parent
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
      if (FISH_DIRS.some(dir => isFishWorkspacePath(join(current, dir))) ||
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
    const specialName = autoloadedFishVariableNames.find(loadedName => process.env[loadedName] === root);
    if (specialName) return specialName;
    // if (root === '/usr/share/fish') return '__fish_data_dir';

    // For other paths, return the workspace root's basename
    return basename(root);
  }

  /**
   * Checks if a path indicates a fish workspace
   */
  export function isFishWorkspacePath(path: string): boolean {
    return config.fish_lsp_all_indexed_paths.includes(path) ||
      FISH_DIRS.includes(basename(path)) || basename(path) === CONFIG_FILE;
  }

  /**
   * Determines if a URI is within a fish workspace
   */
  export function isInFishWorkspace(uri: string): boolean {
    return getWorkspaceRootFromUri(uri) !== undefined;
  }

  export function initializeEnvWorkspaces(): FishUriWorkspace[] {
    return config.fish_lsp_all_indexed_paths
      .map(path => create(path))
      .filter((ws): ws is FishUriWorkspace => ws !== null);
  }

  /**
   * Creates a FishUriWorkspace from a URI
   * @returns null if the URI is not in a fish workspace, otherwise the workspace
   */
  export function create(uri: string): FishUriWorkspace | null {
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
