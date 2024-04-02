import { homedir } from 'os';
import * as fastGlob from 'fast-glob';
import { Analyzer } from '../analyze';
import { createReadStream, readFileSync } from 'fs';
import { pathToUri, toLspDocument, uriToPath } from './translation';
import { LspDocument } from '../document';
import { FishDocumentSymbol } from '../document-symbol';

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
  const defaultSpaces = [
    await Workspace.create('/usr/share/fish'),
    await Workspace.create(`${homedir()}/.config/fish`),
  ];
  return defaultSpaces;
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
    return !this.path.startsWith('/usr/share/fish');
  }

  isLoadable() {
    return ['/usr/share/fish', `${homedir()}/.config/fish`].includes(this.path);
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
