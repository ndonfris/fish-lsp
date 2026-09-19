import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../src/config';
import { FishCompletionWorker } from '../src/completions/fish-worker';
import { refreshShellCompletions, shellCommandNameList, shellComplete, stopShellCompletions } from '../src/completions/shell';

/** labels from a fresh `fish -c`, given `cmd` as data like `shellComplete()` */
function labelsFromFreshFish(cmd: string): string[] {
  const stdout = execFileSync(config.fish_lsp_fish_path, ['-c', 'complete --do-complete="$argv[1]"', '--', cmd], { encoding: 'utf8' });
  return stdout.trim().split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.split('\t'))
    .filter(([label, ...desc]) => label && !desc.join(' ').startsWith('Abbreviation:'))
    .map(([label]) => label!);
}

/** `complete --do-complete` output from a fresh fish, given `line` as data */
function freshFishOutput(line: string, initCommand: string): string {
  return execFileSync(config.fish_lsp_fish_path, ['-C', initCommand, '-c', 'complete --do-complete="$argv[1]"', '--', line], { encoding: 'utf8' });
}

describe('fish completion worker', () => {
  const workers: FishCompletionWorker[] = [];
  const worker = (initCommand?: string, timeoutMs?: number) => {
    const w = new FishCompletionWorker(config.fish_lsp_fish_path, initCommand, timeoutMs);
    workers.push(w);
    return w;
  };

  afterAll(() => {
    workers.forEach(w => w.kill());
    stopShellCompletions();
  });

  it.each([
    'git ',
    'git commit --',
    'set -',
    ' ',
    '',
    'ech',
    'echo "$HOM',
    'echo \\"$HOM',
    "echo '$",
    'echo `pw',
    "it's ",
    'cd ~/',
    'printf "%s\\n" $PA',
    'echo \\\n$',
    'echo "$HOME$',
  ])('shellComplete(%j) lists what a fresh `fish -c` did', async (cmd) => {
    const labels = (await shellComplete(cmd, { raw: true })).map(([label]) => label);
    expect(labels).toEqual(labelsFromFreshFish(cmd));
  });

  it('drops a variable a completion left behind, also when fish adds a `/` to it', async () => {
    // completing `fishlspleftover` sets globals, like `git`'s `$__fish_git_*`; an
    // empty one completes as `$HOME$name/`, since the word expands to a directory
    const w = worker([
      'function fishlspleftover; end',
      "complete -c fishlspleftover -f -a '(set -g __fishlsp_left_empty; set -g __fishlsp_left_full x; echo arg)'",
    ].join('; '));
    await w.complete('fishlspleftover ');
    const labels = (await w.complete('echo "$HOME$__fishlsp_left')).split('\n').filter(Boolean);
    expect(labels).toEqual([]);
  });

  it('keeps paths whose name ends like a variable (`file$x`, `foo$bar/`)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fish-lsp-worker-dollar-'));
    try {
      writeFileSync(join(dir, 'file$x'), '');
      mkdirSync(join(dir, 'foo$bar'));
      const labels = (await worker().complete(`cat ${dir}/f`)).split('\n').filter(Boolean);
      expect(labels.sort()).toEqual([`${dir}/file$x`, `${dir}/foo$bar/`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores whatever the config printed before the first request', async () => {
    const w = worker('echo printed by config.fish; printf "no newline"');
    expect(await w.complete('fishlspnoise')).toBe('');
  });

  it('answers requests sent together in order', async () => {
    const w = worker();
    const lines = ['set -', 'git ', 'string ', 'set -', 'fish-lsp '];
    const answers = await Promise.all(lines.map(line => w.complete(line)));
    for (const [i, line] of lines.entries()) {
      expect(answers[i]).toBe(await w.complete(line));
    }
    expect(answers[0]).toContain('--erase');
    expect(answers[1]).not.toContain('--erase');
  });

  it('completes a line holding newlines, backslashes and surrounding spaces as it is', async () => {
    // each argument fish sees, escaped, as the completions of `fishlspecho`
    const init = [
      'function fishlspecho; end',
      "complete -c fishlspecho -f -a '(commandline -cpo | string escape; commandline -ct | string escape)'",
    ].join('; ');
    const w = worker(init);
    for (const line of ['fishlspecho a\\nb ', 'fishlspecho \\\n  x', 'fishlspecho  "x y" ', 'fishlspecho \'it\\\'s\' ']) {
      const answer = await w.complete(line);
      expect(answer).not.toBe('');
      expect(answer).toBe(freshFishOutput(line, init));
    }
  });

  it('never lets a completion that reads stdin take the next request', async () => {
    const w = worker([
      'function fishlspcat; end',
      "complete -c fishlspcat -f -a '(cat)'",
    ].join('; '), 500);
    // only one request is in the pipe at a time: `cat` finds nothing, and the
    // request queued behind it is never answered with another one's output
    const [cat, set] = await Promise.allSettled([w.complete('fishlspcat '), w.complete('set -')]);
    expect(cat).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('timed out') }) });
    expect(set.status).toBe('rejected');
    // `shellComplete()` answers it from a fresh fish instead
    expect((await shellComplete('set -')).map(([label]) => label)).toContain('--erase');
  });

  it('gives up on a request that takes too long, and on the worker', async () => {
    const w = worker([
      'function fishlspslow; end',
      "complete -c fishlspslow -f -a '(sleep 3; echo late)'",
    ].join('; '), 500);
    await expect(w.complete('fishlspslow ')).rejects.toThrow('timed out');
    expect(w.isClosed).toBe(true);
    await expect(w.complete('set -')).rejects.toThrow();
  });

  it('keeps answering through `shellComplete()` after its worker is stopped', async () => {
    expect((await shellComplete('set -')).map(([label]) => label)).toContain('--erase');
    stopShellCompletions();
    expect((await shellComplete('set -')).map(([label]) => label)).toContain('--erase');
  });

  it('serves the command name list from its cache, and refreshes it after a save', async () => {
    const first = shellCommandNameList();
    expect(shellCommandNameList()).toBe(first);
    const names = await first;
    expect(names.map(([name]) => name)).toContain('set');

    refreshShellCompletions();
    const refreshed = shellCommandNameList();
    expect(refreshed).not.toBe(first);
    expect((await refreshed).map(([name]) => name)).toContain('set');
  });

  it('uses saved definitions when completion is requested before the new worker is ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fish-lsp-refresh-'));
    const original = process.env.XDG_CONFIG_HOME;
    mkdirSync(join(dir, 'fish'));
    const configFile = join(dir, 'fish', 'config.fish');
    writeFileSync(configFile, 'sleep 0.2; function fishlsp_review_old; end\n');
    stopShellCompletions();
    process.env.XDG_CONFIG_HOME = dir;
    try {
      expect((await shellCommandNameList()).map(([name]) => name)).toContain('fishlsp_review_old');
      writeFileSync(configFile, 'sleep 0.2; function fishlsp_review_new; end\n');
      refreshShellCompletions();
      const refreshed = shellCommandNameList();
      const names = (await refreshed).map(([name]) => name);
      expect(names).toContain('fishlsp_review_new');
      expect(names).not.toContain('fishlsp_review_old');
      expect(shellCommandNameList()).toBe(refreshed);
    } finally {
      stopShellCompletions();
      if (original === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = original;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
