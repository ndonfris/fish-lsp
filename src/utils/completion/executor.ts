import { resolve } from 'path';
import { execFile } from 'child_process'
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const completionFile = resolve(__dirname, '../../../fish_files/get-completion-rewrite.fish');

export async function execSubshellCompletions(input: string): Promise<string> {
  const {stdout, stderr} = await execFileAsync('fish', [completionFile, input])
  if (stderr) {
    return ''
  }
  return stdout.trimEnd()
}

// console.log(completionFile);
