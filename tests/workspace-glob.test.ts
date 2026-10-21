import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { config } from '../src/config';
import { getFileUriSet, syncGetFileUriSet } from '../src/utils/workspace';
import { uriToPath } from '../src/utils/translation';
import { setLogger } from './helpers';

setLogger();

/**
 * Workspace indexing globs `**\/*.fish` under each workspace root. These pin down which files
 * `fish_lsp_max_workspace_depth` and `fish_lsp_ignore_paths` let through, so swapping the
 * globbing library can't silently change what gets indexed.
 */
describe('workspace globbing for `**/*.fish`', () => {
  const ROOT = mkdtempSync(join(tmpdir(), 'fish-lsp-workspace-glob-'));
  const files: Record<string, string> = {
    'top.fish': 'echo top',
    'empty.fish': '',
    'a/1.fish': 'echo 1',
    'a/b/2.fish': 'echo 2',
    'a/b/c/3.fish': 'echo 3',
    'a/b/c/d/4.fish': 'echo 4',
    'dirlike.fish/in.fish': 'echo dirlike',
    '.hidden/h.fish': 'echo hidden',
    'node_modules/x/n.fish': 'echo node_modules',
    'docker/d.fish': 'echo docker',
    '.git/hooks/g.fish': 'echo git',
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(ROOT, file, '..'), { recursive: true });
    writeFileSync(join(ROOT, file), content);
  }
  /** a symlink cycle: `a/b/loop -> ROOT` */
  symlinkSync(ROOT, join(ROOT, 'a', 'b', 'loop'));

  const originalDepth = config.fish_lsp_max_workspace_depth;
  const originalIgnore = config.fish_lsp_ignore_paths;

  beforeEach(() => {
    config.fish_lsp_ignore_paths = ['**/.git/**', '**/node_modules/**', '**/containerized/**', '**/docker/**'];
  });

  afterAll(() => {
    config.fish_lsp_max_workspace_depth = originalDepth;
    config.fish_lsp_ignore_paths = originalIgnore;
    rmSync(ROOT, { recursive: true, force: true });
  });

  const toRelative = (uris: Set<string>) =>
    Array.from(uris).map(uri => relative(ROOT, uriToPath(uri))).sort();

  // depth 1 is the workspace root itself; `empty.fish` is skipped because it has no content
  const expectedAtDepth: Record<number, string[]> = {
    1: ['top.fish'],
    2: ['a/1.fish', 'dirlike.fish/in.fish', 'top.fish'],
    3: ['a/1.fish', 'a/b/2.fish', 'dirlike.fish/in.fish', 'top.fish'],
  };

  for (const [depth, expected] of Object.entries(expectedAtDepth)) {
    it(`fish_lsp_max_workspace_depth=${depth}`, async () => {
      config.fish_lsp_max_workspace_depth = Number(depth);
      expect(toRelative(syncGetFileUriSet(ROOT))).toEqual(expected);
      expect(toRelative(await getFileUriSet(ROOT))).toEqual(expected);
    });
  }

  it('depth 4 reaches `a/b/c/3.fish` and enters the symlink cycle once, without duplicates', async () => {
    config.fish_lsp_max_workspace_depth = 4;
    const result = toRelative(syncGetFileUriSet(ROOT));
    expect(result).toContain('a/b/c/3.fish');
    expect(result).not.toContain('a/b/c/d/4.fish');
    expect(result.filter(file => file.startsWith('a/b/loop/a/b/loop/'))).toEqual([]);
    expect(toRelative(await getFileUriSet(ROOT))).toEqual(result);
  });

  it('never returns ignored, hidden, or empty files', () => {
    config.fish_lsp_max_workspace_depth = 10;
    const result = toRelative(syncGetFileUriSet(ROOT));
    for (const file of ['empty.fish', '.hidden/h.fish', 'node_modules/x/n.fish', 'docker/d.fish', '.git/hooks/g.fish']) {
      expect(result).not.toContain(file);
    }
  });

  it('honors a user-supplied ignore path', () => {
    config.fish_lsp_max_workspace_depth = 3;
    config.fish_lsp_ignore_paths = ['**/a/**'];
    expect(toRelative(syncGetFileUriSet(ROOT))).toEqual(['dirlike.fish/in.fish', 'docker/d.fish', 'node_modules/x/n.fish', 'top.fish']);
  });

  it('returns an empty set for a missing workspace root', async () => {
    expect(syncGetFileUriSet(join(ROOT, 'missing')).size).toBe(0);
    expect((await getFileUriSet(join(ROOT, 'missing'))).size).toBe(0);
  });
});
