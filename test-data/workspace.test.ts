import { performance } from 'perf_hooks';
import * as fastGlob from 'fast-glob';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Workspace, findCurrentWorkspace } from '../src/utils/workspace';
import { pathToUri } from '../src/utils/translation';
import { config, workspaces } from '../src/cli';
import { setLogger } from './helpers';
import { execAsyncFish } from '../src/utils/exec';
import { SyncFileHelper } from '../src/utils/file-operations';

setLogger();

// Mock the config object
jest.mock('../src/cli', () => ({
  config: {
    fish_lsp_modifiable_paths: [],
    fish_lsp_all_indexed_paths: [],
  },
}));

class FishWorkspaceTestEnvironment {
  private tempDir: string;
  private fishConfigDir: string;
  workspace: Workspace;

  constructor() {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-workspace-test-'));
    this.fishConfigDir = path.join(this.tempDir, '.config', 'fish');
    this.createMockFishStructure();
    this.workspace = new Workspace(this.fishConfigDir);

    // Update the mocked config
    config.fish_lsp_modifiable_paths = [this.fishConfigDir];
    config.fish_lsp_all_indexed_paths = [this.fishConfigDir];
  }

  private createMockFishStructure() {
    const dirs = [
      path.join(this.fishConfigDir, 'functions'),
      path.join(this.fishConfigDir, 'completions'),
      path.join(this.fishConfigDir, 'conf.d'),
    ];

    dirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));

    // Create some mock fish files
    fs.writeFileSync(path.join(this.fishConfigDir, 'config.fish'), 'set -g EDITOR vim');
    fs.writeFileSync(path.join(this.fishConfigDir, 'functions', 'fish_prompt.fish'), 'function fish_prompt\n    echo "$ "\nend');
    fs.writeFileSync(path.join(this.fishConfigDir, 'completions', 'git.fish'), 'complete -c git -a "status"');
    fs.writeFileSync(path.join(this.fishConfigDir, 'conf.d', '000-env.fish'), 'set -gx PATH $HOME/.local/bin $PATH');
  }

  cleanup() {
    fs.rmSync(this.tempDir, { recursive: true, force: true });
  }
}

describe('Fish Mocked Workspace Tests', () => {
  let testEnv: FishWorkspaceTestEnvironment;

  beforeEach(() => {
    testEnv = new FishWorkspaceTestEnvironment();
    workspaces.push(testEnv.workspace);
  });

  afterEach(() => {
    workspaces.pop();
    testEnv.cleanup();
  });

  it('should find all fish files', async () => {
    const files = await testEnv.workspace.getAllFiles();
    expect(files.length).toBe(4); // config.fish, fish_prompt.fish, git.fish, 000-env.fish
  });

  it('should identify files in the workspace', () => {
    const isInWorkspace = testEnv.workspace.contains(
      pathToUri(path.join(testEnv.workspace.path, 'functions', 'fish_prompt.fish')),
    );
    expect(isInWorkspace).toBe(true);
  });

  it('should get files with specific names', async () => {
    const files = await testEnv.workspace.getFilesWithName('fish_prompt', 'git.fish');
    expect(files.length).toBe(2);
    expect(files.some(f => f.includes('fish_prompt.fish'))).toBe(true);
    expect(files.some(f => f.includes('git.fish'))).toBe(true);
  });

  it('should identify the workspace as mutable', () => {
    expect(testEnv.workspace.isMutable()).toBe(true);
  });

  it('should identify the workspace as loadable', () => {
    expect(testEnv.workspace.isLoadable()).toBe(true);
  });

  it('should find the current workspace', () => {
    const foundWorkspace = findCurrentWorkspace(
      pathToUri(path.join(testEnv.workspace.path, 'functions', 'fish_prompt.fish')),
    );
    expect(foundWorkspace).toBeDefined();
    expect(foundWorkspace?.path).toBe(testEnv.workspace.path);
  });

  it('should find files with partial name matches', async () => {
    const files = await testEnv.workspace.getFilesWithName('fish_', 'git');
    expect(files.length).toBe(2);
    expect(files.some(f => f.includes('fish_prompt.fish'))).toBe(true);
    expect(files.some(f => f.includes('git.fish'))).toBe(true);
  });

  it('should not contain files outside the workspace', () => {
    const outsideFile = pathToUri(path.join(os.tmpdir(), 'outside.fish'));
    expect(testEnv.workspace.contains(outsideFile)).toBe(false);
  });

  it('should find files in nested directories', async () => {
    const nestedDir = path.join(testEnv.workspace.path, 'nested', 'dir');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'nested.fish'), 'nested content');
    const files = await testEnv.workspace.getAllFiles();
    expect(files.some(f => f.includes('nested/dir/nested.fish'))).toBe(true);
  });

  it('should normalize workspace paths', () => {
    const nonNormalizedPath = path.join(testEnv.workspace.path, '..', path.basename(testEnv.workspace.path));
    const workspace = new Workspace(nonNormalizedPath);
    expect(workspace.path).toBe(testEnv.workspace.path);
  });
});

async function getTwoWorkspaces(): Promise<Workspace[]> {
  const share = await execAsyncFish('echo $__fish_data_dir');
  const user = await execAsyncFish('echo $__fish_config_dir');
  return [
    share.stdout.trim() || '',
    user.stdout.trim() || `${os.homedir()}/.config/fish/`,
  ].filter(wsPath => wsPath.trim() !== '')
    .map(wsPath => new Workspace(wsPath));
}

describe('Fish Actual Workspace Tests', () => {
  beforeAll(async () => {
    config.fish_lsp_all_indexed_paths = (await getTwoWorkspaces()).map(ws => ws.path);
  });

  let mockWorkspaces: Workspace[] = [];
  beforeEach(async () => mockWorkspaces = await getTwoWorkspaces());
  afterEach(() => mockWorkspaces = []);

  it('default workspace sizes and', async () => {
    const workspaceHelper = async (ws: Workspace) => {
      const path = ws.path;
      const files = await ws.getAllFiles();
      return { path, files };
    };

    for (const ws of mockWorkspaces) {
      const { path, files } = await workspaceHelper(ws);
      // console.log({ path, length: files.length });
      expect(path).toBeTruthy();
      expect(files.length).toBeGreaterThan(1);
    }
  });

  it('should find known fish files in actual workspaces', async () => {
    for (const ws of mockWorkspaces) {
      const files = await ws.getAllFiles();
      expect(files.some(f => f.includes('config.fish'))).toBe(true);
      // Add more known files that should exist in a typical fish setup
    }
  });

  it('should find known fish files in actual workspaces', async () => {
    for (const ws of mockWorkspaces) {
      expect(ws.isLoadable()).toBe(true);
    }
  });

  it('test workspace background', async () => {
    const max_files = 1000;
    const amount = 0;
    for (const workspace of mockWorkspaces) {
      if (amount >= max_files) {
        break;
      }
      for (const file of workspace.getAllFiles()) {
        if (amount >= max_files) {
          break;
        }
        // NEED TO ANALYZE
        const document = SyncFileHelper.toLspDocument(file, 'fish', 1);
        console.log(document);
      }
    }
  });
});
