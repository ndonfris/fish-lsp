import { execFileAsync } from '../exec';
import { config } from '../../config';

type ShellCompleteOptions = {
  sanitizeCompletionPath?: boolean;
};

export function escapeCmd(cmd: string): string {
  return cmd
    .replace(/\\/g, '\\\\')  // Escape backslashes first!
    .replace(/'/g, "\\'")    // Then escape quotes
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"');
}

export async function shellComplete(cmd: string, options: ShellCompleteOptions = {}): Promise<[string, string][]> {
  // escape the `"`, and `'` characters.
  // const escapedCmd = cmd.replace(/(["'`\\])/g, '\\$1');
  // const escapedCmd = cmd.replace(/(["'])/g, '\\$1');
  const escapedCmd = escapeCmd(cmd).toString();

  const fishArgs = [
    ...options.sanitizeCompletionPath ? ['-C', 'set -g fish_complete_path'] : [],
    '-c',
    `complete --do-complete='${escapedCmd}'`,
  ];
  // Using the `--escape` flag will include extra backslashes in the output
  // for example, 'echo "$' -> ['\"$PATH', '\"$PWD', ...]
  // const completeString = `fish -c "complete --escape --do-complete='${escapedCmd}'"`;

  const child = await execFileAsync(config.fish_lsp_fish_path, fishArgs);

  return child.stdout.toString().trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(line => fixLine(line))
    .filter(([label, desc]) => label && !desc.startsWith('Abbreviation:'));
  // Filter out `label\tAbbreviation: ...` items added in
  // https://github.com/fish-shell/fish-shell/commit/4b2aba31eecf9a7675fd2a678e74dbcb936424a5
  // which are always always shown
}

function fixFirst(input: string | undefined): string {
  if (!input) return '';
  if (input.startsWith('"') || input.startsWith("'")) input = input.slice(1);
  if (input.endsWith('/')) input = input.slice(0, -1);
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
