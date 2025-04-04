import * as fastGlob from 'fast-glob';
import { readFileSync, promises } from 'fs';
import { pathToUri, toLspDocument, uriToPath } from './translation';
import { LspDocument } from '../document';
import { FishDocumentSymbol } from '../document-symbol';
import { config } from '../config';
import { logger } from '../logger';

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

export async function initializeDefaultFishWorkspaces(): Promise<Workspace[]> {
  const configWorkspaces = config.fish_lsp_all_indexed_paths;
  // Create an array of promises by mapping over workspacePaths
  const workspacePromises = configWorkspaces.map(path => Workspace.create(path));

  // Wait for all promises to resolve
  const defaultSpaces = await Promise.all(workspacePromises);
  return defaultSpaces;
}

export async function getRelevantDocs(workspaces: Workspace[]): Promise<LspDocument[]> {
  const docs: LspDocument[] = [];
  for await (const ws of workspaces) {
    const workspaceDocs = await ws.asyncFilter((doc: LspDocument) => doc.shouldAnalyzeInBackground());
    docs.push(...workspaceDocs);
  }
  return docs;
}

export interface FishWorkspace {
  path: string;
  uris: Set<string>;
  contains(...checkUris: string[]): boolean;
  urisToLspDocuments(): LspDocument[];
  filter(callbackfn: (lspDocument: LspDocument) => boolean): LspDocument[];
  forEach(callbackfn: (lspDocument: LspDocument) => void): void;
}

export class Workspace implements FishWorkspace {
  public path: string;
  public uris: Set<string>;
  public symbols: Map<string, FishDocumentSymbol[]> = new Map();

  public static async create(path: string) {
    const foundUris = await getFileUriSet(path);
    return new Workspace(path, foundUris);
  }

  public constructor(path: string, fileUris: Set<string>) {
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
