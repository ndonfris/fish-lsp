import { setLogger } from './helpers';
import { LspDocument } from '../src/document';
import { FishUriWorkspace, Workspace } from '../src/utils/workspace';
import { config } from '../src/config';
import { uriToPath, pathToUri } from '../src/utils/translation';
import * as LSP from 'vscode-languageserver';
import { basename, dirname, join } from 'path';
import { autoloadedFishVariableNames, setupProcessEnvExecFile } from '../src/utils/process-env';

describe('setup workspace', () => {
  setLogger();
  beforeAll(async () => {
    await setupProcessEnvExecFile();
  });

  describe('fisher workspace', () => {
    it('conf.d/fisher-template', () => {
      const params = {
        rootUri: 'file:///home/ndonfris/repos/fisher-template/conf.d',
        rootPath: '/home/ndonfris/repos/fisher-template/conf.d',
        workspaceFolders: [
          {
            uri: 'file:///home/ndonfris/repos/fisher-template/conf.d',
            name: 'conf.d',
          },
        ],
      } as LSP.InitializeParams;

      const workspaceUri = uriToPath(params.rootUri!);
      const workspacePath = uriToPath(params.rootPath!);
      console.log(`workspaceUri: ${workspaceUri}`);
      console.log(`workspacePath: ${workspacePath}`);

      const uris = [
        'file:///home/user/repos/fisher-template/conf.d',
        'file:///home/user/repos/fisher-template/functions',
        'file:///home/user/repos/fisher-template/completions',
        'file:///home/user/repos/fisher-template/config.fish',
        'file:///usr/share/fish/config.fish',
        'file:///usr/share/fish/completions/file.fish',
        'file:///usr/share/fish/functions/file.fish',
        'file:///usr/share/fish/conf.d/file.fish',
        'file:///home/user/.config/fish/conf.d/file.fish',
        'file:///home/user/.config/fish/config.fish',
        'file:///home/user/.config/fish/functions/file.fish',
        'file:///home/user/.config/fish/conf.d/file.fish',
        'file:///home/user/some/random/folder/script.fish',
      ];
      for (const inputUri of uris) {
        const fishWorkspace = FishUriWorkspace.create(inputUri);
        if (!fishWorkspace) fail();
        const { name, uri, path } = fishWorkspace;
        console.log({ inputUri, name, uri, path });
      }
    });
  });
});

// export interface FishUriWorkspace {
//   name: string;
//   uri: string;
// }
//
// export namespace FishUriWorkspace {
//
//   /** special location names */
//   const FISH_DIRS = ['functions', 'completions', 'conf.d'];
//   const CONFIG_FILE = 'config.fish';
//
//   /**
//    * Removes file path component from a fish file URI unless it's config.fish
//    */
//   function trimFishFilePath(uri: string): string | undefined {
//     const path = uriToPath(uri);
//     if (!path) return undefined;
//
//     const base = basename(path);
//     if (base === CONFIG_FILE) return path;
//     return base.endsWith('.fish') ? dirname(path) : path;
//   }
//
//   /**
//    * Gets the workspace root directory from a URI
//    */
//   function getWorkspaceRootFromUri(uri: string): string | undefined {
//     const path = uriToPath(uri);
//     if (!path) return undefined;
//
//     let current = path;
//     const base = basename(current);
//
//     // If path is a fish directory or config.fish, return parent
//     if (FISH_DIRS.includes(base) || base === CONFIG_FILE) {
//       return dirname(current);
//     }
//
//     // Walk up looking for fish workspace indicators
//     while (current !== dirname(current)) {
//       // Check for fish dirs in current directory
//       for (const dir of FISH_DIRS) {
//         if (basename(current) === dir) {
//           return dirname(current);
//         }
//       }
//
//       // Check for config.fish or fish dirs as children
//       if (FISH_DIRS.some(dir => isFishWorkspacePath(join(current, dir))) ||
//         isFishWorkspacePath(join(current, CONFIG_FILE))) {
//         return current;
//       }
//
//       current = dirname(current);
//     }
//
//     // Check if we're in a configured path
//     return config.fish_lsp_all_indexed_paths.find(p => path.startsWith(p));
//   }
//
//   /**
//    * Gets a human-readable name for the workspace root
//    */
//   function getWorkspaceName(uri: string): string {
//     const root = getWorkspaceRootFromUri(uri);
//     if (!root) return '';
//
//     // Special cases for system directories
//     if (root.endsWith('/.config/fish')) return '__fish_config_dir';
//     const specialName = autoloadedFishVariableNames.find(loadedName => process.env[loadedName] === root);
//     if (specialName) return specialName;
//     // if (root === '/usr/share/fish') return '__fish_data_dir';
//
//     // For other paths, return the workspace root's basename
//     return basename(root);
//   }
//
//   /**
//    * Checks if a path indicates a fish workspace
//    */
//   function isFishWorkspacePath(path: string): boolean {
//     return config.fish_lsp_all_indexed_paths.includes(path) ||
//       FISH_DIRS.includes(basename(path)) || basename(path) === CONFIG_FILE;
//   }
//
//   /**
//    * Determines if a URI is within a fish workspace
//    */
//   function isInFishWorkspace(uri: string): boolean {
//     return getWorkspaceRootFromUri(uri) !== undefined;
//   }
//
//   /**
//    * Creates a FishUriWorkspace from a URI
//    * @returns null if the URI is not in a fish workspace, otherwise the workspace
//    */
//   export function create(uri: string): FishUriWorkspace | null {
//
//     if (!isInFishWorkspace(uri)) return null;
//
//     const trimmedUri = trimFishFilePath(uri)
//     if (!trimmedUri) return null;
//
//     const rootUri = getWorkspaceRootFromUri(trimmedUri)
//     const workspaceName = getWorkspaceName(trimmedUri)
//
//     if (!rootUri || !workspaceName) return null;
//
//     return {
//       name: workspaceName,
//       uri: rootUri,
//     };
//   }
// }
