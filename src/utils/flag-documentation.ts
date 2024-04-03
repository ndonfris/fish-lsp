import { CompletionItem, FormattingOptions } from 'vscode-languageserver';
import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver-protocol/node';
import { SyntaxNode } from 'web-tree-sitter';
import { hasPossibleSubCommand } from './builtins';
import { execCommandDocs, execCommandType, CompletionArguments, execCompleteSpace, execCompleteCmdArgs, documentCommandDescription, execComplete, execFindSubcommand, execSubCommandCompletions, execCompleteLine } from './exec';
import { findParentCommand } from './node-types';
import { getChildNodes, getNodeText } from './tree-sitter';

const findFirstFlagIndex = (cmdline: string[]) => {
  for (let i = 0; i < cmdline.length; i++) {
    const arg = cmdline[i] as string;
    if (arg.startsWith('-')) {
      return i;
    }
  }
  return -1;
};
const findFlagStopToken = (inputArray: string[]) => {
  for (let i = 0; i < inputArray.length; i++) {
    const arg = inputArray[i];
    if (arg === '--') {
      return i;
    }
  }
  return -1;
};

const ensureEndOfArgs = (inputArray: string[]) => {
  const stopToken = findFlagStopToken(inputArray);
  return stopToken === -1 ? inputArray : inputArray.slice(0, stopToken);
};

const removeStrings = (input: string) => {
  let output = input.replace(/^\s+/, '');
  output = output.replace(/^if\s+/, '');
  output = output.replace(/^else {2}if\s+/, '');
  output = output.replace(/"(.+)"/, '');
  output = output.replace(/'(.+)'/, '');
  return output;
};

const tokenizeInput = (input: string) => {
  const removed = removeStrings(input);
  const tokenized = ensureEndOfArgs(removed.split(/\s/));
  return tokenized.filter(t => t.length > 0);
};

const generateShellCommandToComplete = (cmdline: string[]) => {
  const firstFlag = findFirstFlagIndex(cmdline);
  const cmd = cmdline.slice(0, firstFlag);
  cmd.push('-');
  return cmd.join(' ');
};

const outputFlags = async (inputArray: string[]) => {
  const toExec = generateShellCommandToComplete(inputArray);
  const output = await execCompleteLine(toExec);
  return output.filter((line) => line.startsWith('-'));
};

const shortFlag = (flag: string) => {
  return flag.startsWith('-') && !flag.startsWith('--');
};

const longFlag = (flag: string) => {
  return flag.startsWith('--') && flag.length > 2;
};

const hasUnixFlags = (allFlagLines: string[]) => {
  for (const line of allFlagLines) {
    const [flag, doc]: string[] = line.split('\t') || [];
    if (!flag) {
      continue;
    }
    if (shortFlag(flag) && flag.length > 2) {
      return true;
    }
  }
  return false;
};

const parseInputFlags = (inputArray: string[], seperateShort: boolean) => {
  const result: string[] = [];
  for (let i = 0; i < inputArray.length; i++) {
    const arg = inputArray[i];
    if (arg && shortFlag(arg)) {
      if (seperateShort) {
        const shortFlags = arg.slice(1).split('').map(ch => '-' + ch);
        result.push(...shortFlags);
      } else {
        result.push(arg);
      }
    } else if (arg && longFlag(arg)) {
      result.push(arg);
    }
  }
  return result;
};

const findMatchingFlags = (inputFlags: string[], allFlagLines: string[]) => {
  const output: string[] = [];
  for (const line of allFlagLines) {
    const [flag, doc] = line.split('\t');
    if (flag && inputFlags.includes(flag)) {
      output.push(line);
    }
  }
  return output;
};

async function getFlagDocumentationStrings(input: string) : Promise<string[]> {
  const splitInputArray = tokenizeInput(input);
  const outputFlagLines = await outputFlags(splitInputArray);
  const shouldSeperateShortFlags = !hasUnixFlags(outputFlagLines);
  const parsedInputFlags = parseInputFlags(splitInputArray, shouldSeperateShortFlags);
  const matchingFlags = findMatchingFlags(parsedInputFlags, outputFlagLines);
  return matchingFlags
    .map(line => line.split('\t'))
    .map(([flag, doc]) => `**\`${flag}\`** *\`${doc}\`*`)
    .reverse();
}

export function getFlagCommand(input: string) : string {
  const splitInputArray = tokenizeInput(input);
  const firstFlag = findFirstFlagIndex(splitInputArray);
  let cmd = splitInputArray;
  if (firstFlag !== -1) {
    cmd = splitInputArray.slice(0, firstFlag);
  }
  return cmd.join(' ');
}

export async function getFlagDocumentationAsMarkup(input: string) : Promise<MarkupContent> {
  const docString = await getFlagDocumentationString(input);
  return {
    kind: MarkupKind.Markdown,
    value: docString,
  };
}

export async function getFlagDocumentationString(input: string): Promise<string> {
  const cmdName = getFlagCommand(input);
  const flagLines = await getFlagDocumentationStrings(input);
  const flagString = flagLines.join('\n');
  const manpage = await execCommandDocs(cmdName.replaceAll(' ', '-'));
  const flagDoc = flagString.trim().length > 0 ? ['___', '  ***Flags***', flagString].join('\n') : '';
  const manDoc = manpage.trim().length > 0 ? ['___', '```man', manpage, '```'].join('\n') : '';
  const afterString = [flagDoc, manDoc].join('\n').trim();
  return [
    `***\`${cmdName}\`***`,
    afterString,
  ].join('\n');
}
