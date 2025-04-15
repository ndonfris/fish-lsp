import { execAsync } from '../exec';

export function escapeCmd(cmd: string): string {
  return cmd
    .replace(/\\/g, '\\\\')  // Escape backslashes first!
    .replace(/\$/g, '\\$')   // Then escape $
    .replace(/'/g, "\\'")    // Then escape quotes
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"');
}

export async function shellComplete(cmd: string): Promise<[string, string][]> {
  // escape the `"`, and `'` characters.
  // const escapedCmd = cmd.replace(/(["'`\\])/g, '\\$1');
  // const escapedCmd = cmd.replace(/(["'])/g, '\\$1');
  const escapedCmd = escapeCmd(cmd).toString();

  // const completeString = `fish -c "complete --do-complete='${escapedCmd}'"`;
  const completeString = `fish -c "complete --do-complete='${escapedCmd}'"`;
  // Using the `--escape` flag will include extra backslashes in the output
  // for example, 'echo "$' -> ['\"$PATH', '\"$PWD', ...]
  // const completeString = `fish -c "complete --escape --do-complete='${escapedCmd}'"`;

  const child = await execAsync(completeString);

  if (child.stderr) {
    return [];
  }

  return child.stdout.toString().trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(line => {
      const [first, ...rest] = line.split('\t');
      // Remove surrounding quotes from the first item
      // const unquotedFirst = first.replace(/^(['"])(.*)\1$/, '$2');
      return [first, rest.join('\t') || ''] as [string, string];
    });
}
