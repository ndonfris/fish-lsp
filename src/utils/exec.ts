import { exec, execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger';
import { pathToUri, uriToPath } from './translation';
import { vfs } from '../virtual-fs';
import { config } from '../config';

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
  const { stdout } = await execFileAsync(config.fish_lsp_fish_path, ['-P', '--command', escapedCommand]);

  if (!stdout) return [''];

  return stdout.trim().split('\n');
}

export async function execCmd(cmd: string): Promise<string[]> {
  const { stdout, stderr } = await execAsync(cmd, { shell: config.fish_lsp_fish_path });

  if (stderr) return [''];

  return stdout
    .toString()
    .trim()
    .split('\n');
}

export async function execEmbeddedFishFile(file: string, ...args: string[]) {
  const fishFile = vfs.find(file);
  if (!fishFile) {
    throw new Error(`Embedded fish file not found: ${file}`);
  }
  const fishScript = vfs.fishFiles.find(f => f.file.endsWith(file));
  if (!fishScript) {
    throw new Error(`Fish script execution not available for: ${file}`);
  }
  return await fishScript.execAsync(...args);
}

export async function execAsyncF(cmd: string) {
  const file = await execEmbeddedFishFile('exec.fish', cmd);
  logger.log({ func: 'execAsyncF', file, cmd });
  return file.stdout.toString().trim();
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
  return await execAsync(`${config.fish_lsp_fish_path} -c '${cmd}'`);
}

export function execFishNoExecute(filepath: string) {
  try {
    // execFileSync will throw on non-zero exit codes
    return execFileSync(config.fish_lsp_fish_path, ['--no-execute', filepath], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'], // Only capture stderr
    }).toString();
  } catch (err: any) {
    // When fish finds syntax errors, it exits non-zero but still gives useful output in stderr
    if (err.stderr) {
      return err.stderr.toString();
    }
  }
}

export async function execCompletions(...cmd: string[]): Promise<string[]> {
  //   const file = getFishFilePath('get-completion.fish');
  const cmpArgs = ['1', `${cmd.join(' ').trim()}`];
  const cmps = await execEmbeddedFishFile('get-completion.fish', ...cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execSubCommandCompletions(...cmd: string[]): Promise<string[]> {
  const cmpArgs = ['2', cmd.join(' ')];
  const cmps = await execEmbeddedFishFile('get-completion.fish', ...cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execCompleteLine(cmd: string): Promise<string[]> {
  const escapedCmd = cmd.replace(/(["'`\\])/g, '\\$1');
  const completeString = `${config.fish_lsp_fish_path} -c "complete --do-complete='${escapedCmd}'"`;

  const child = await execAsync(completeString);

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteSpace(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
  const completeString = `${config.fish_lsp_fish_path} -c "complete --do-complete='${escapedCommand} '"`;

  const child = await execAsync(completeString);

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteCmdArgs(cmd: string): Promise<string[]> {
  const args = await execEmbeddedFishFile('get-command-options.fish', cmd);
  const results = args?.stdout.toString().trim().split('\n') || [];

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
  const result = await execEmbeddedFishFile('get-documentation.fish', cmd);
  const out = result.stdout || '';
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
  const result = await execEmbeddedFishFile('get-type.fish', cmd);
  if (result?.stderr) {
    return '';
  }
  return result?.stdout?.toString().trim() || '';
}

export interface CompletionArguments {
  command: string;
  args: Map<string, string>;
}

export async function documentCommandDescription(cmd: string): Promise<string> {
  const cmdDescription = await execAsync(`${config.fish_lsp_fish_path} -c "__fish_describe_command ${cmd}" | head -n1`);
  return cmdDescription.stdout.trim() || cmd;
}

export async function execFindDependency(cmd: string): Promise<string> {
  const file = await execEmbeddedFishFile('find_dependency.fish', cmd);
  return file?.stdout?.toString().trim() || '';
}

export async function execExpandBraceExpansion(input: string): Promise<string> {
  const result = await execEmbeddedFishFile('expand_cartesian.fish', input);
  return result?.stdout?.toString().trimEnd() || '';
}

export function execCommandLocations(cmd: string): { uri: string; path: string; }[] {
  const output = execFileSync(config.fish_lsp_fish_path, ['--command', `type -ap ${cmd}`], {
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
