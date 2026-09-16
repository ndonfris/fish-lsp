import { execFileAsync } from '../utils/exec';
import { config } from '../config';

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

export function escapeCmd(cmd: string): string {
  return cmd
    .replace(/\\/g, '\\\\')  // Escape backslashes first!
    .replace(/'/g, "\\'")    // Then escape quotes
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"');
}

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
  const escapedCmd = escapeCmd(cmd).toString();

  const excludeDirs = options.excludeCompletionDirs?.filter(Boolean) ?? [];
  const fishArgs = [
    ...excludeDirs.length > 0 ? ['-C', excludeCompletionDirsCommand(excludeDirs)] : [],
    '-c',
    `complete --do-complete='${escapedCmd}'`,
  ];
  // Using the `--escape` flag will include extra backslashes in the output
  // for example, 'echo "$' -> ['\"$PATH', '\"$PWD', ...]

  const child = await execFileAsync(config.fish_lsp_fish_path, fishArgs);

  return child.stdout.toString().trim()
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

const splitRawLine = (line: string): [string, string] => {
  const [first, ...rest] = line.split('\t');
  return [first || '', rest.join(' ')] as [string, string];
};
