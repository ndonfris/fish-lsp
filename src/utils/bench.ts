import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type FileEntry = [ word: string, details: string ];

export async function autoloadedWorkspaceVariables() {
  function parseFile(fileContent: string) {
    fileContent.split('\n').map(line => {
      const [word, details] = line.split('\t');
      return [word, details ?? ''] as FileEntry;
    }).forEach(([variable, details]) => {
      process.env[variable] = details;
    });
  }

  const res: [ string, string ][] = [];

  try {
    const file = resolve(__dirname, '../../fish_files/get-fish-autoloaded-paths.fish');
    const { stdout } = await execFileAsync('fish', [file]);

    parseFile(stdout.toString());
  } catch (error) {
    process.stderr.write('[ERROR] retrieving autoloaded fish env variables failure\n');
  }

  return res;
}
