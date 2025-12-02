import { spawn, exec, execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger';
import { pathToUri, uriToPath } from './translation';
import { config } from '../config';
import GetDocs from '../../fish_files/get-docs.fish';
import GetCommandOptions from '../../fish_files/get-command-options.fish';
import GetType from '../../fish_files/get-type.fish';
import GetTypeVerbose from '../../fish_files/get-type-verbose.fish';
import GetCartisianExpansion from '../../fish_files/expand_cartesian.fish';
import GetAutoloadedFilepath from '../../fish_files/get-autoloaded-filepath.fish';
import GetFishAutoloadedPaths from '../../fish_files/get-fish-autoloaded-paths.fish';
import GetDependency from '../../fish_files/get-dependency.fish';
import GetExec from '../../fish_files/exec.fish';
import GetCompletion from '../../fish_files/get-completion.fish';
import GetDocumentation from '../../fish_files/get-documentation.fish';

export type EmbeddedFishResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export function runEmbeddedFish(script: string, args: string[] = []): Promise<EmbeddedFishResult> {
  return new Promise((resolve, reject) => {
    // Use fish's psub (process substitution) to source from stdin and pass arguments correctly
    // This approach properly handles arguments with spaces, quotes, and special characters
    const argsEscaped = args.map(arg => {
      // Escape single quotes by replacing ' with '\''
      const escaped = arg.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    }).join(' ');

    const fishCommand = args.length > 0
      ? `source (command cat | psub) ${argsEscaped}`
      : 'source (command cat | psub)';

    const child = spawn('fish', ['-c', fishCommand], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => stdout += chunk);
    child.stderr.on('data', (chunk) => stderr += chunk);

    child.on('error', reject);

    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

export namespace ExecFishFiles {
  export function getCommandOptions(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetCommandOptions, args);
  }

  export function getDocs(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetDocs, args);
  }

  export function getType(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetType, args);
  }

  export function getTypeVerbose(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetTypeVerbose, args);
  }

  export function getCartisianExpansion(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetCartisianExpansion, args);
  }

  export function getAutoloadedFilepath(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetAutoloadedFilepath, args);
  }

  export function getFishAutoloadedPaths(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetFishAutoloadedPaths, args);
  }

  export function getDependency(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetDependency, args);
  }

  export function getDocumentation(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetDocumentation, args);
  }

  export function execFish(cmd: string): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetExec, [cmd]);
  }

  export function getCompletion(...args: string[]): Promise<EmbeddedFishResult> {
    return runEmbeddedFish(GetCompletion, args);
  }
}

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

export async function execAsyncF(cmd: string) {
  const result = await ExecFishFiles.execFish(cmd);
  logger.log({ func: 'execAsyncF', result, cmd });
  return result.stdout.toString().trim();
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
  const cmps = await ExecFishFiles.getCompletion(...cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execSubCommandCompletions(...cmd: string[]): Promise<string[]> {
  const cmpArgs = ['2', cmd.join(' ')];
  const cmps = await ExecFishFiles.getCompletion(...cmpArgs);
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
  const args = await ExecFishFiles.getCommandOptions(cmd);
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
  const result = await ExecFishFiles.getDocs(cmd);
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
  const result = await ExecFishFiles.getType(cmd);
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
  const file = await ExecFishFiles.getDependency(cmd);
  return file?.stdout?.toString().trim() || '';
}

export async function execExpandBraceExpansion(input: string): Promise<string> {
  const result = await ExecFishFiles.getCartisianExpansion(input);
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
