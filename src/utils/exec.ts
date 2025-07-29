import { exec, execFile, execFileSync } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import { logger } from '../logger';
import { pathToUri, uriToPath } from './translation';

export const execAsync = promisify(exec);

export const execFileAsync = promisify(execFile);

/**
 * @async execEscapedComplete() - executes the fish command with
 *
 * @param {string} cmd - the current command to complete
 *
 * @returns {Promise<string[]>} - the array of completions, types will need to be added when
 *                                the fish completion command is implemented
 */
export async function execEscapedCommand(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
  const { stdout } = await execFileAsync('fish', ['-P', '--command', escapedCommand]);

  if (!stdout) return [''];

  return stdout.trim().split('\n');
}

export async function execCmd(cmd: string): Promise<string[]> {
  const { stdout, stderr } = await execAsync(cmd, { shell: 'fish' });

  if (stderr) return [''];

  return stdout
    .toString()
    .trim()
    .split('\n');
}

export async function execAsyncF(cmd: string) {
  const file = resolve(__dirname, '../../fish_files/exec.fish');
  logger.log({ func: 'execAsyncF', file, cmd });
  const child = await execFileAsync(file, [cmd]);
  return child.stdout.toString().trim();
}

/**
 * Wrapper for `execAsync()` a.k.a, `promisify(exec)`
 * Executes the `cmd` in a fish subprocess
 *
 * @param cmd - the string to wrap in `fish -c '${cmd}'`
 *
 * @returns  Promise<{stdout, stderr}>
 */
export async function execAsyncFish(cmd: string) {
  return await execAsync(`fish -c '${cmd}'`);
}

export function execFishNoExecute(filepath: string) {
  try {
    // execFileSync will throw on non-zero exit codes
    return execFileSync('fish', ['--no-execute', filepath], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'], // Only capture stderr
    }).toString();
  } catch (err: any) {
    // When fish finds syntax errors, it exits non-zero but still gives useful output in stderr
    if (err.stderr) {
      return err.stderr.toString();
    }
    // If something else went wrong, throw the error
    // throw err;
  }
}
//

export async function execCompletions(...cmd: string[]): Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['1', `${cmd.join(' ').trim()}`];
  const cmps = await execFileAsync(file, cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execSubCommandCompletions(...cmd: string[]): Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['2', cmd.join(' ')];
  const cmps = await execFileAsync(file, cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execCompleteLine(cmd: string): Promise<string[]> {
  const escapedCmd = cmd.replace(/(["'`\\])/g, '\\$1');
  const completeString = `fish -c "complete --do-complete='${escapedCmd}'"`;

  const child = await execAsync(completeString);

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteSpace(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
  const completeString = `fish -c "complete --do-complete='${escapedCommand} '"`;

  const child = await execAsync(completeString);

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteCmdArgs(cmd: string): Promise<string[]> {
  const exec = resolve(__dirname, '../../fish_files/get-command-options.fish');
  const args = execFile(exec, [cmd]);
  const results = args.toString().trim().split('\n');

  let i = 0;
  const fixedResults: string[] = [];
  while (i < results.length) {
    const line = results[i] as string;
    if (cmd === 'test') {
      fixedResults.push(line);
    } else if (!line.startsWith('-', 0)) {
      //fixedResults.slice(i-1, i).join(' ')
      fixedResults.push(fixedResults.pop() + ' ' + line.trim());
    } else {
      fixedResults.push(line);
    }
    i++;
  }
  return fixedResults;
}

export async function execCommandDocs(cmd: string): Promise<string> {
  const file = resolve(__dirname, '../../fish_files/get-documentation.fish');
  const docs = await execFileAsync(file, [cmd]);
  const out = docs.stdout;
  return out.toString().trim();
}

/**
 * runs: ../fish_files/get-type.fish <cmd>
 *
 * @param {string} cmd - command type from document to resolve
 * @returns {Promise<string>}
 *                     'command' -> cmd has man
 *                     'file' -> cmd is fish function
 *                     '' ->    cmd is neither
 */
export async function execCommandType(cmd: string): Promise<string> {
  const file = resolve(__dirname, '../../fish_files/get-type.fish');
  const cmdCheck = cmd.split(' ')[0]?.trim() as string;
  const docs = await execFileAsync(file, [cmdCheck]);
  if (docs.stderr) {
    return '';
  }
  return docs.stdout.toString().trim();
}

export interface CompletionArguments {
  command: string;
  args: Map<string, string>;
}

export async function documentCommandDescription(cmd: string): Promise<string> {
  const cmdDescription = await execAsync(`fish -c "__fish_describe_command ${cmd}" | head -n1`);
  return cmdDescription.stdout.trim() || cmd;
}

export async function execFindDependency(cmd: string): Promise<string> {
  const file = resolve(__dirname, '../../fish_files/get-dependency.fish');
  const docs = execFileSync(file, [cmd]);
  return docs.toString().trim();
}

export async function execExpandBraceExpansion(input: string): Promise<string> {
  const file = resolve(__dirname, '../../fish_files/expand_cartesian.fish');
  const result = await execFileAsync('fish', [file, input]);
  return result.stdout.toString().trimEnd();
}

export function execCommandLocations(cmd: string): {uri: string; path: string;}[] {
  const output = execFileSync('fish', ['--command', `type -ap ${cmd}`], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return output.toString().trim().split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line !== '\n' && line.includes('/'))
    .map(line => ({
      uri: pathToUri(line),
      path: uriToPath(line),
    })) || [];
}
