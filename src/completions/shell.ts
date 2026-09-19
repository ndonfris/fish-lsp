import { execFileAsync } from '../utils/exec';
import { config } from '../config';
import { logger } from '../logger';
import { completeInWorker, refreshFishCompletionWorkers, startFishCompletionWorker, stopFishCompletionWorkers } from './fish-worker';

export type ShellCompleteOptions = {
  /**
   * Directories removed from `$fish_complete_path` before completing. Used when the
   * document being edited is itself an autoloadable `completions/<cmd>.fish` file,
   * so fish never autoloads the (possibly half-written) copy on disk.
   */
  excludeCompletionDirs?: string[];
  /**
   * Keep fish's raw labels (no stripping of a leading quote).
   */
  raw?: boolean;
};

/** quote a literal for a fish single-quoted string */
function fishQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Builds the `-C` init command that erases every entry of `dirs` (with or without a
 * trailing `/`) from `$fish_complete_path`. `contains -i` compares literally, so
 * paths containing glob characters are handled correctly.
 */
export function excludeCompletionDirsCommand(dirs: string[]): string {
  const variants = [...new Set(dirs.flatMap(dir => {
    const trimmed = dir.replace(/\/+$/, '');
    return [trimmed, `${trimmed}/`];
  }))];
  return variants
    .map(dir => `while set -l i (contains -i -- ${fishQuote(dir)} $fish_complete_path); set -e fish_complete_path[$i]; end`)
    .join('; ');
}

export async function shellComplete(cmd: string, options: ShellCompleteOptions = {}): Promise<[string, string][]> {
  const excludeDirs = options.excludeCompletionDirs?.filter(Boolean) ?? [];
  // a worker never unloads a completion file, so excluding its directory has to
  // happen before the worker's fish starts: one worker per set of excluded dirs
  const initCommand = excludeDirs.length > 0 ? excludeCompletionDirsCommand(excludeDirs) : undefined;

  const stdout = await completeInWorker(cmd, initCommand).catch((error) => {
    logger.debug('fish completion worker unavailable, spawning fish for this request', error);
    return completeOnce(cmd, initCommand);
  });

  return stdout.trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(line => options.raw ? splitRawLine(line) : fixLine(line))
    .filter(([label, desc]) => label && !desc.startsWith('Abbreviation:'));
  // Filter out `label\tAbbreviation: ...` items added in
  // https://github.com/fish-shell/fish-shell/commit/4b2aba31eecf9a7675fd2a678e74dbcb936424a5
  // which are always always shown
}

function fixFirst(input: string | undefined): string {
  if (!input) return '';
  if (input.startsWith('"') || input.startsWith("'")) input = input.slice(1);
  // Fish decorates directory-valued variables too; keep their bare expansion
  // labels while retaining `/` on actual filesystem candidates.
  if (/^\$+\w+\/$/.test(input)) input = input.slice(0, -1);
  return input;
}

function fixLast(input: string[] | undefined): string {
  if (!input) return '';
  return input.join('\t');
}

const fixLine = (line: string): [string, string] => {
  const [first, ...rest] = line.split('\t');
  return [fixFirst(first), fixLast(rest)] as [string, string];
};

/**
 * a fresh fish for one request, when no worker can answer. `cmd` is passed as data,
 * so fish completes exactly the typed text: `cat "foo b` is one word inside `"`.
 */
async function completeOnce(cmd: string, initCommand?: string): Promise<string> {
  const fishArgs = [
    ...initCommand ? ['-C', initCommand] : [],
    '-c',
    'complete --do-complete="$argv[1]"',
    '--',
    cmd,
  ];
  // Using the `--escape` flag will include extra backslashes in the output
  // for example, 'echo "$' -> ['\"$PATH', '\"$PWD', ...]
  const child = await execFileAsync(config.fish_lsp_fish_path, fishArgs);
  return child.stdout.toString();
}

/** how long a listing of every command name is served before it is refreshed */
const COMMAND_NAMES_TTL_MS = 30_000;

const commandNamesCache = new Map<string, { at: number; names: Promise<[string, string][]>; }>();

/**
 * Every command name fish knows (`complete --do-complete ' '`, thousands of them).
 * They only change with `$PATH` or the functions, so the last listing is served
 * while an older-than-`COMMAND_NAMES_TTL_MS` one is refreshed in the background.
 */
export function shellCommandNameList(excludeCompletionDirs: string[] = []): Promise<[string, string][]> {
  const key = excludeCompletionDirs.join('\0');
  const cached = commandNamesCache.get(key);
  if (cached && Date.now() - cached.at < COMMAND_NAMES_TTL_MS) return cached.names;

  const names = shellComplete(' ', { raw: true, excludeCompletionDirs });
  if (!cached) {
    const entry = { at: Date.now(), names };
    commandNamesCache.set(key, entry);
    names.catch(() => {
      if (commandNamesCache.get(key) === entry) commandNamesCache.delete(key);
    });
    return names;
  }
  // one refresh at a time; the stale listing is still served
  cached.at = Date.now();
  names.then(
    (fresh) => {
      if (commandNamesCache.get(key) === cached) {
        commandNamesCache.set(key, { at: Date.now(), names: Promise.resolve(fresh) });
      }
    },
    (error) => logger.debug('refreshing the command name list failed', error),
  );
  return cached.names;
}

/** starts a completion worker and lists the command names, before the first request needs them */
export function warmShellCompletions(): void {
  startFishCompletionWorker();
  shellCommandNameList().catch(() => { /* retried by the first request */ });
}

/** after a save: the config, a function or a completion file may have changed */
export function refreshShellCompletions(): void {
  refreshFishCompletionWorkers();
  commandNamesCache.clear();
}

export function stopShellCompletions(): void {
  stopFishCompletionWorkers();
  commandNamesCache.clear();
}

const splitRawLine = (line: string): [string, string] => {
  const [first, ...rest] = line.split('\t');
  return [first || '', rest.join(' ')] as [string, string];
};
