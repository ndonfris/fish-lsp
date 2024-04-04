import { exec, execFile, execFileSync } from 'child_process';
import { promises } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import { URI } from 'vscode-uri';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export async function execEscapedCommand(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
  const { stdout } = await execFileAsync('fish', ['-P', '--command', escapedCommand]);

  if (!stdout) {
    return [''];
  }

  return stdout.trim().split('\n');
}

export async function execCmd(cmd: string): Promise<string[]> {
  const { stdout } = await execFileAsync('fish', [cmd])
  if (!stdout) return ['']

  // const { stdout } = await execAsync(cmd, {
  //   shell: '/usr/bin/fish',
  //   encoding: 'buffer',
  //   maxBuffer: 1024 * 1024 * 8,
  //   env: {
  //     PATH: process.env.PATH,
  //     USER: process.env.USER,
  //     HOME: process.env.HOME,
  //   },
  // });
  return stdout
    .toString()
    .trim()
    .split('\n');
}

export async function execPrintLsp(line: string) {
  const file = resolve(__dirname, '../../fish_files/printflsp.fish');
  const child = await execFileAsync(file, [line]);
  if (child.stderr) {
    return child.stdout.trim();
  }
  return child.stdout.trim();
}
export async function execFormatter(path: string) {
  const child = await execEscapedCommand(`fish_indent ${path}`);
  return child.join('\n');
}

// Potential inlay hint
export async function execInlayHintType(...cmd: string[]): Promise<string> {
  const child = await execEscapedCommand(`type -t ${cmd.join(' ')} 2>/dev/null`);
  return child.join(' ');
}

export async function execCompletions(...cmd: string[]) : Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['1', `${cmd.join(' ').trim()}`];
  const cmps = await execFileAsync(file, cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execSubCommandCompletions(...cmd: string[]) : Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-completion.fish');
  const cmpArgs = ['2', cmd.join(' ')];
  const cmps = await execFileAsync(file, cmpArgs);
  return cmps.stdout.trim().split('\n');
}

export async function execCompleteLine(cmd: string): Promise<string[]> {
  const escapedCommand = cmd.replace(/(["'$`\\/])/g, '\\$1');
  const completeString = `complete --do-complete='${escapedCommand}'`;

  const child = await execCmd(completeString);
  return child || [];
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
  if (docs.stderr) return '';
  return docs.stdout.toString().trim();
}

export interface CompletionArguments {
  command: string;
  args: Map<string, string>;
}

export async function documentCommandDescription(cmd: string) : Promise<string> {
  const cmdDescription = await execAsync(`fish -c "__fish_describe_command ${cmd}" | head -n1`);
  return cmdDescription.stdout.trim() || cmd;
}

export async function execFindDependency(cmd: string): Promise<string> {
  const file = resolve(__dirname, '../../fish_files/get-dependency.fish');
  const docs = execFileSync(file, [cmd]);
  return docs.toString().trim();
}

export async function execFindSubcommand(cmd: string[]): Promise<string[]> {
  const file = resolve(__dirname, '../../fish_files/get-current-subcommand.fish');
  const docs = execFileSync(file, cmd);
  return docs.toString().trim()
    .split('\n')
    .map(subcmd => subcmd.split('\t', 1))
    .filter(subcmd => subcmd.length === 2)
    .map(subcmd => subcmd[0]!.trim());
}

export async function execComplete(...cmd: string[]): Promise<string[]> {
  const exec = resolve(__dirname, '../../fish_files/get-command-options.fish');
  const args = execFileSync(exec, cmd);
  const results = args.toString().trim().split('\n');

  let i = 0;
  const fixedResults: string[] = [];
  while (i < results.length) {
    const line: string = results[i]?.toString() || '';
    if (cmd[0] === 'test') {
      fixedResults.push(line);
    } else if (!line.startsWith('-', 0)) {
      //fixedResults.slice(i-1, i).join(' ')
      fixedResults.push(fixedResults.pop() + ' ' + line.trim());
    } else {
      fixedResults.push(line);
    }
    i++;
  }
  return fixedResults || [];
}

// open the uri and read the file
export async function execOpenFile(uri: string): Promise<string> {
  const fileUri = URI.parse(uri).fsPath;
  const file = await promises.readFile(fileUri.toString(), 'utf8');
  return file.toString();
}