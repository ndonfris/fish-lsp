import { Connection } from 'vscode-languageserver';
import { exec } from 'child_process';
import { execAsyncFish } from './utils/exec';
import { promisify } from 'util';
import { appendFileSync } from 'fs';
export const execAsync = promisify(exec);

export type ExecResultKind = 'error' | 'info';

export type ExecResultWrapper = {
  message: string;
  kind: ExecResultKind;
};

export async function execLineInBuffer(line: string): Promise<ExecResultWrapper> {
  // Here you would execute the current line in the parent shell environment
  // For example, you could use Node.js's child_process to execute the command
  // exec(line, (error: any, stdout: any, stderr: any) => {
  //   if (error) {
  //     connection.window.showErrorMessage(buildOutput(line, "error:", error));
  //     return;
  //   }
  //   if (stderr) {
  //     connection.window.showErrorMessage(line, 'stderr:', stderr);
  //     return;
  //   }
  //   connection.window.showInformationMessage(line, "stdout:", stdout);
  // });

  const { stderr, stdout } = await execAsync(`fish -c '${line}'`);
  if (stderr) {
    return { message: buildOutput(line, 'stderr:', stderr), kind: 'error' };
  }
  if (stdout) {
    return { message: buildOutput(line, 'stdout:', stdout), kind: 'info' };
  }

  return {
    message: [
      `${fishLspPromptIcon} ${line}`,
      '-'.repeat(50),
      'EMPTY RESULT',
    ].join('\n'),
    kind: 'info',
  };
}

export const fishLspPromptIcon = '><(((°>';

export function buildOutput(line: string, outputMessage: 'error:' | 'stderr:' | 'stdout:', output: string) {
  const tokens = line.trim().split(' ');
  let promptLine = `${fishLspPromptIcon} `;
  let currentLen = promptLine.length;
  for (const token of tokens) {
    if (1 + token.length + currentLen > 49) {
      const newToken = `\\\n        ${token} `;
      promptLine += newToken;
      currentLen = newToken.slice(newToken.indexOf('\n')).length;
    } else {
      const newToken = token + ' ';
      promptLine += newToken;
      currentLen += newToken.length + 1;
    }
  }

  return [
    promptLine,
    '-'.repeat(50),
    `${outputMessage} ${output}`,
  ].join('\n');
}

export async function execEntireBuffer(bufferName: string): Promise<ExecResultWrapper> {
  const { stdout, stderr } = await execAsync(`fish ${bufferName}`);
  const statusOutput = (await execAsync(`fish -c 'fish ${bufferName} 1> /dev/null; echo "\\$status: $status"'`)).stdout;
  const headerOutput = [
    `${fishLspPromptIcon} executing file:`,
    `${' '.repeat(fishLspPromptIcon.length)} ${bufferName}`,
  ].join('\n');

  const longestLineLen = findLongestLine(headerOutput, stdout, stderr, '-'.repeat(50)).length;
  let output = '';
  if (stdout) output += `${stdout}`;
  if (stdout && stderr) output += `\nerror:\n${stderr}`;
  else if (!stdout && stderr) output += `error:\n${stderr}`;
  let messageType: ExecResultKind = 'info';

  if (stderr) messageType = 'error';

  if (statusOutput) output += `${'-'.repeat(longestLineLen)}\n${statusOutput}`;

  return {
    message: [
      headerOutput,
      '-'.repeat(longestLineLen),
      output,
    ].join('\n'),
    kind: messageType,
  };
}

export async function sourceFishBuffer(bufferName: string) {
  const { stdout, stderr } = await execAsync(`fish -c 'source ${bufferName}'`);
  const statusOutput = (await execAsync(`fish -c 'source ${bufferName} 1> /dev/null; echo "\\$status: $status"'`)).stdout;
  const message = [
    `${fishLspPromptIcon} sourcing file:`,
    `${' '.repeat(fishLspPromptIcon.length)} ${bufferName}`,
  ].join('\n');

  const longestLineLen = findLongestLine(message, stdout, stderr, statusOutput, '-'.repeat(50)).length;
  const outputArr: string[] = [];
  if (statusOutput) outputArr.push(statusOutput);
  if (stdout) outputArr.push(stdout);
  if (stderr) outputArr.push(stderr);

  const output = outputArr.join('-'.repeat(50) + '\n');

  return [
    message,
    '-'.repeat(longestLineLen),
    output,
  ].join('\n');
}

export async function FishThemeDump() {
  return (await execAsyncFish('fish_config theme dump; or true')).stdout.split('\n');
}

export async function showCurrentTheme(buffName: string) {
  const output = (await execAsyncFish('fish_config theme demo; or true')).stdout.split('\n');
  // Append the longest line to the file
  for (const line of output) {
    appendFileSync(buffName, `${line}\n`, 'utf8');
  }
  return {
    message: `${fishLspPromptIcon} appended theme variables to end of file`,
    kind: 'info',
  };
}

export type ThemeOptions = {
  asVariables: boolean;
};
const defaultThemeOptions: ThemeOptions = {
  asVariables: false,

};

export async function executeThemeDump(buffName: string, options: ThemeOptions = defaultThemeOptions): Promise<ExecResultWrapper> {
  const output = (await execAsyncFish('fish_config theme dump; or true')).stdout.split('\n');
  // Append the longest line to the file
  if (options.asVariables) {
    appendFileSync(buffName, '# created by fish-lsp');
  }
  for (const line of output) {
    if (options.asVariables) {
      appendFileSync(buffName, `set -gx ${line}\n`, 'utf8');
    } else {
      appendFileSync(buffName, `${line}\n`, 'utf8');
    }
  }
  return {
    message: `${fishLspPromptIcon} appended theme variables to end of file`,
    kind: 'info',
  };
}

/**
 * Function to find the longest line in a string.
 * @param input - The input string with lines separated by newline characters.
 * @returns The longest line in the input string.
 */
function findLongestLine(...inputs: string[]): string {
  const input = inputs.join('\n');
  // Split the input string by newline characters into an array of lines
  const lines: string[] = input.split('\n');

  // Initialize a variable to keep track of the longest line
  let longestLine: string = '';

  // Iterate over each line
  for (const line of lines) {
    // If the current line is longer than the longestLine found so far, update longestLine
    if (line.length > longestLine.length) {
      longestLine = line;
    }
  }

  // Return the longest line found
  return longestLine;
}

export function useMessageKind(connection: Connection, result: ExecResultWrapper) {
  switch (result.kind) {
    case 'info':
      connection.window.showInformationMessage(result.message);
      return;
    case 'error':
      connection.window.showErrorMessage(result.message);
      return;
    default:
      return;
  }
}
