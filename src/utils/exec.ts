import { exec, execFile, execFileSync } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import { logger } from '../logger';
import { _processEnv } from './process-env';

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
  const { stdout } = await execFileAsync('fish', ['-P', '--command', escapedCommand], {
    env: _processEnv,
  });

  if (!stdout) return [''];

  return stdout.trim().split('\n');
}

export async function execCmd(cmd: string): Promise<string[]> {
  const { stdout, stderr } = await execAsync(cmd, { shell: 'fish',
    env: _processEnv,
  });

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
  return await execAsync(`fish -c '${cmd}'`, {
    env: _processEnv,
  });
}

/**
 * Subshell print alias for inlay hints -- too slow for running on large documents
 * and/or workspaces
 */
export async function execPrintLsp(line: string) {
  const file = resolve(__dirname, '../../fish_files/printflsp.fish');
  const child = await execFileAsync(file, [line]);
  if (child.stderr) {
    return child.stdout.trim();
  }
  return child.stdout.trim();
}

export function execFishNoExecute(filepath: string) {
  try {
    // execFileSync will throw on non-zero exit codes
    return execFileSync('fish', ['--no-execute', filepath], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'], // Only capture stderr
      env: _processEnv,
    }).toString();
  } catch (err: any) {
    // When fish finds syntax errors, it exits non-zero but still gives useful output in stderr
    if (err.stderr) {
      return err.stderr.toString();
    }
    // If something else went wrong, throw the error
    throw err;
  }
}
//
// Similar to the above execPrintLsp
// export async function execInlayHintType(...cmd: string[]): Promise<string> {
//   const child = await execEscapedCommand(`type -t ${cmd.join(' ')} 2>/dev/null`);
//   return child.join(' ');
// }

export async function execCompletions(...cmd: string[]): Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['1', `${cmd.join(' ').trim()}`];
  const cmps = await execFileAsync(file, cmpArgs, {
    env: _processEnv,
  });
  return cmps.stdout.trim().split('\n');
}

export async function execSubCommandCompletions(...cmd: string[]): Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['2', cmd.join(' ')];
  const cmps = await execFileAsync(file, cmpArgs, {
    env: _processEnv,
  });
  return cmps.stdout.trim().split('\n');
}

export async function execCompleteLine(cmd: string): Promise<string[]> {
  // const escapedCommand = cmd.replace(/(["'$`\\/])/g, '\\$1').trimStart();
  // const completeString = `complete --do-complete='${escapedCommand}'`;
  //
  // const child = await execAsyncF(completeString);
  // return child.trim().split('\n') || []
  const escapedCmd = cmd.replace(/(["'`\\])/g, '\\$1');
  const completeString = `fish -c "complete --do-complete='${escapedCmd}'"`;
  // Using the `--escape` flag will include extra backslashes in the output
  // for example, 'echo "$' -> ['\"$PATH', '\"$PWD', ...]
  // const completeString = `fish -c "complete --escape --do-complete='${escapedCmd}'"`;

  const child = await execAsync(completeString, {
    env: _processEnv,
  });

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteSpace(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
  const completeString = `fish -c "complete --do-complete='${escapedCommand} '"`;

  const child = await execAsync(completeString, {
    env: _processEnv,
  });

  if (child.stderr) {
    return [''];
  }

  return child.stdout.trim().split('\n');
}

export async function execCompleteCmdArgs(cmd: string): Promise<string[]> {
  const exec = resolve(__dirname, '../../fish_files/get-command-options.fish');
  const args = execFile(exec, [cmd], {
    env: _processEnv,
  });
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
  const docs = await execFileAsync(file, [cmd], {
    env: _processEnv,
  });
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
  const docs = await execFileAsync(file, [cmdCheck], {
    env: _processEnv,
  });
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

// open the uri and read the file
// export async function execOpenFile(uri: string): Promise<string> {
//   const fileUri = URI.parse(uri).fsPath;
//   const file = await promises.readFile(fileUri.toString(), 'utf8');
//   return file.toString();
// }
