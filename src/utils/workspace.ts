import * as fastGlob from 'fast-glob';
import { basename } from 'path';
import { toLspDocument, uriToPath } from './translation';
import { config, workspaces } from '../cli';
import { SyncFileHelper } from './file-operations';
import { LspDocument } from 'src/document';

export class Workspace {
  constructor(public readonly path: string) { }

  contains(...checkUris: string[]) {
    for (const uri of checkUris) {
      const uriAsPath = uriToPath(uri);
      if (!uriAsPath.startsWith(this.path)) {
        return false;
      }
    }
    return true;
  }

  getAllFiles(): string[] {
    return fastGlob.sync(`${this.path}/**/*.fish`, {
      absolute: true,
      globstar: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      stats: false,
      dot: false,
    });
    // return fastGlob.sync(`${this.path}/**/*.fish`, {
    //   cwd: this.path,
    //   extglob: true,
    //   globstar: true,
    //   suppressErrors: true,
    //   absolute: true,
    //   onlyFiles: true,
    //   followSymbolicLinks: false,
    //   deep: Infinity,
    //   stats: false,
    //   dot: false
    // });
  }

  async getFilesWithName(...names: string[]): Promise<string[]> {
    const matchNames = names.map(name => name.endsWith('.fish') ? name.slice(0, -5) : name);
    const allFiles = await this.getAllFiles();
    return allFiles.filter(file => {
      const fileName = basename(uriToPath(file));
      return matchNames.some(n => fileName.startsWith(n));
    });
  }
  // async getFilesWithName(...names: string[]): Promise<string[]> {
  //   const matchNames = names.map(name => name.endsWith('.fish') ? name.slice(0, -5) : name)
  //   const allFiles = await this.getAllFiles();
  //   return allFiles.filter(file => matchNames.some(n => uriToPath(file).split('/')[-1]?.toString().startsWith(n)))
  // }

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

  urisToLspDocuments() {
    const docs: LspDocument[] = [];
    for (const file of this.getAllFiles()) {
      const content = SyncFileHelper.read(file);
      const doc = toLspDocument(file, content);
      docs.push(doc);
    }
    return docs;
  }
}

export function findCurrentWorkspace(uri: string) {
  const path = uriToPath(SyncFileHelper.expandEnvVars(uri));
  return workspaces.find(ws => ws.contains(path));
}
