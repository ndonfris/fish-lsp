// import * as fs from 'fs';
import * as os from 'os';
import { setLogger } from './helpers';
import { FishUriWorkspace, getWorkspacePathsFromInitializationParams, initializeDefaultFishWorkspaces } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { Config, config, ConfigSchema } from '../src/config';
import { uriToPath } from '../src/utils/translation';
import * as LSP from 'vscode-languageserver';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { TestFile, TestWorkspace } from './test-workspace-utils';
// import { Logger } from '../src/logger';
// import { SyncFileHelper } from '../src/utils/file-operations';

// Mock the entire fs module
// jest.mock('fs');

describe('setup workspace', () => {
  setLogger();
  beforeAll(async () => {
    await setupProcessEnvExecFile();
  });

  // resetting the config object before each test
  beforeEach(() => {
    // Create a fresh default config
    const defaultConfig = ConfigSchema.parse({});

    // Reset all properties of the imported config object
    // Reset all properties of the imported config object with proper typing
    (Object.keys(config) as Array<keyof Config>).forEach(key => {
      delete config[key];
    });

    // Copy default values into the config object
    Object.assign(config, defaultConfig);
  });

  afterEach(() => {
    config.fish_lsp_all_indexed_paths = [];
    Object.assign(config, ConfigSchema.parse({}));
    workspaceManager.clear();
  });

  describe('getWorkspacePathsFromInitializationParams', () => {
    it('prioritizes workspaceFolders over deprecated root fields', () => {
      const params = {
        workspaceFolders: [{ uri: 'file:///tmp/workspace-folder', name: 'workspace-folder' }],
        rootUri: 'file:///tmp/root-uri',
        rootPath: '/tmp/root-path',
      } as unknown as LSP.InitializeParams;

      const uris = getWorkspacePathsFromInitializationParams(params);
      expect(uris).toEqual(['/tmp/workspace-folder']);
    });

    it('falls back to rootUri when workspaceFolders is missing', () => {
      const params = {
        rootUri: 'file:///tmp/root-uri',
        rootPath: '/tmp/root-path',
      } as unknown as LSP.InitializeParams;

      const uris = getWorkspacePathsFromInitializationParams(params);
      expect(uris).toEqual(['/tmp/root-uri']);
    });

    it('falls back to rootUri when workspaceFolders is empty', () => {
      const params = {
        workspaceFolders: [],
        rootUri: 'file:///tmp/root-uri',
        rootPath: '/tmp/root-path',
      } as unknown as LSP.InitializeParams;

      const uris = getWorkspacePathsFromInitializationParams(params);
      expect(uris).toEqual(['/tmp/root-uri']);
    });

    it('falls back to rootPath when rootUri is unavailable', () => {
      const params = {
        workspaceFolders: [],
        rootUri: null,
        rootPath: '/tmp/root-path',
      } as unknown as LSP.InitializeParams;

      const uris = getWorkspacePathsFromInitializationParams(params);
      expect(uris).toEqual(['/tmp/root-path']);
    });
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
      expect(workspaceUri).toBeTruthy();
      expect(workspacePath).toBeTruthy();
      // console.log(`workspaceUri: ${workspaceUri}`);
      // console.log(`workspacePath: ${workspacePath}`);

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
        const fishWorkspace = FishUriWorkspace.create(inputUri)!;
        if (!fishWorkspace) assert.fail();
        const { name, uri, path } = fishWorkspace;
        expect(name).toBeTruthy();
        expect(uri).toBeTruthy();
        expect(path).toBeTruthy();
        // console.log({ inputUri, name, uri, path });
      }
    });
  });

  describe('fisher workspace w/ $fish_lsp_single_workspace_support \'true\'', () => {
    // Create real on-disk workspaces under tests/workspaces so that
    // FishUriWorkspace.create() observes them as actual directories. The
    // `bends.fish` case in particular needs a real directory because
    // trimFishFilePath treats nonexistent `.fish`-suffixed paths as files.
    const fisherTemplate = TestWorkspace.create({ name: 'fisher-template' })
      .addFiles(TestFile.confd('init', 'echo loaded'))
      .initialize();
    const fzfFish = TestWorkspace.create({ name: 'fzf.fish' })
      .addFiles(TestFile.function('fzf', 'function fzf\nend'))
      .initialize();
    const bendsFish = TestWorkspace.create({ name: 'bends.fish' })
      .addFiles(TestFile.function('bend', 'function bend\nend'))
      .initialize();

    it('conf.d/fisher-template', async () => {
      const cases: Array<{ input: string; expectedUri: string; }> = [
        { input: `${fisherTemplate.uri}/conf.d`, expectedUri: fisherTemplate.uri },
        { input: fisherTemplate.uri, expectedUri: fisherTemplate.uri },
        { input: `${fzfFish.uri}/functions`, expectedUri: fzfFish.uri },
        { input: bendsFish.uri, expectedUri: bendsFish.uri },
      ];
      for (const { input, expectedUri } of cases) {
        const workspace = FishUriWorkspace.create(input);
        expect(workspace).toBeDefined();
        expect(workspace!.uri).toBe(expectedUri);
      }
    });
  });

  describe('`config.fish_lsp_single_workspace_support` updating during startup', () => {
    it(`file://${os.homedir()}/.config/fish \`false -> false\``, async () => {
      config.fish_lsp_single_workspace_support = false;
      const uri = `file://${os.homedir()}/.config/fish`;
      const workspaces = await initializeDefaultFishWorkspaces(uri);
      expect(workspaces.length).toBe(2);
      expect(config.fish_lsp_single_workspace_support).toBe(false);
    });

    it(`file://${os.homedir()}/.config/fish \`false -> false\``, async () => {
      config.fish_lsp_single_workspace_support = true;
      config.fish_lsp_all_indexed_paths = [`${os.homedir()}/.config/fish`];
      const uri = `file://${os.homedir()}/.config/fish`;
      const workspaces = await initializeDefaultFishWorkspaces(uri);
      workspaces.forEach((ws, i) => {
        console.log(`(${i}) workspace`, ws.uri);
      });
      expect(workspaces.length).toBe(1);
      expect(config.fish_lsp_single_workspace_support).toBe(true);
    });

    it('no startup URIs + single-workspace support should not index fish_lsp_all_indexed_paths', async () => {
      config.fish_lsp_single_workspace_support = true;
      config.fish_lsp_all_indexed_paths = [
        `${os.homedir()}/.config/fish`,
        '/usr/share/fish',
      ];

      const workspaces = await initializeDefaultFishWorkspaces();
      expect(workspaces.length).toBe(0);
    });

    // it('/tmp/foo.fish \`true -> false\`', async () => {
    //   config.fish_lsp_single_workspace_support = true;
    //   const uri = 'file:///tmp';
    //   const workspaces = await initializeDefaultFishWorkspaces(uri);
    //   expect(workspaces.length).toBe(3);
    //   expect(config.fish_lsp_single_workspace_support).toBe(false);
    // });
  });

  describe('/tmp testing of workspaces', () => {
    it('`config.fish_lsp_single_workspace_suppport=true` /tmp/foo.fish', async () => {
      config.fish_lsp_single_workspace_support = true;
      const uri = 'file:///tmp/foo.fish';

      console.log('/tmp/foo.fish', { config });
      const workspaces = await initializeDefaultFishWorkspaces(uri);

      expect(workspaces.length).toBe(1);
      expect(workspaces.map(w => w.uri).includes('file:///tmp/foo.fish')).toBeTruthy();
    });

    it('`config.fish_lsp_single_workspace_suppport=false` /tmp/foo.fish', async () => {
      config.fish_lsp_single_workspace_support = false;
      const uri = 'file:///tmp/foo.fish';

      console.log('/tmp/foo.fish', { config });
      const workspaces = await initializeDefaultFishWorkspaces(uri);

      expect(workspaces.length).toBe(3);
      expect(workspaces.map(w => w.uri).includes('file:///tmp/foo.fish')).toBeTruthy();
    });
  });
});
