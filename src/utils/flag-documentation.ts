import {CompletionItem, FormattingOptions} from 'vscode-languageserver';
import {Hover, MarkupContent, MarkupKind} from 'vscode-languageserver-protocol/node';
import {SyntaxNode} from 'web-tree-sitter';
import {hasPossibleSubCommand} from './builtins';
import {execCommandDocs, execCommandType, CompletionArguments, execCompleteSpace, execCompleteCmdArgs, documentCommandDescription, execComplete, execFindSubcommand, execSubCommandCompletions, execCompleteLine} from './exec';
import {findParentCommand} from './node-types';
import {getChildNodes, getNodeText} from './tree-sitter';

const findFirstFlagIndex = (cmdline: string[]) => {
    for (let i = 0; i < cmdline.length; i++) {
        const arg = cmdline[i]
        if (arg.startsWith('-')) {
            return i
        }
    }
    return -1
}
const findFlagStopToken = (inputArray: string[]) => {
    for (let i = 0; i < inputArray.length; i++) {
        const arg = inputArray[i]
        if (arg === '--') {
            return i
        }
    }
    return -1
}

const ensureEndOfArgs = (inputArray: string[]) => {
    const stopToken = findFlagStopToken(inputArray)
    return stopToken === -1 ? inputArray : inputArray.slice(0, stopToken)
}

const removeStrings = (input: string) => {
    let output = input.replace(/^\s+/, '')
    output = output.replace(/^if\s+/,'');
    output = output.replace(/^else  if\s+/,'');
    output = output.replace(/"(.+)"/, '');
    output = output.replace(/'(.+)'/, '');
    return output
}


const tokenizeInput = (input: string) => {
    let removed = removeStrings(input)
    let tokenized = ensureEndOfArgs(removed.split(' '))
    return tokenized.filter(t => t.length > 0)
}

const generateShellCommandToComplete = (cmdline: string[]) => {
    const firstFlag = findFirstFlagIndex(cmdline)
    let cmd = cmdline.slice(0, firstFlag)
    cmd.push('-')
    return cmd.join(' ')
}

const outputFlags = async (inputArray: string[]) => {
    const toExec = generateShellCommandToComplete(inputArray)
    const output = await execCompleteLine(toExec)
    return output.filter((line) => line.startsWith('-'))
}

const shortFlag = (flag: string) => {
    return flag.startsWith('-') && !flag.startsWith('--')
}

const longFlag = (flag: string) => {
    return flag.startsWith('--') && flag.length > 2
}

const hasUnixFlags = (allFlagLines: string[]) => {
    for (let line of allFlagLines) {
        const [flag, doc] = line.split('\t')
        if (shortFlag(flag) && flag.length > 2) {
            return true
        }
    }
    return false;
}

const parseInputFlags = (inputArray: string[], seperateShort: boolean) => {
    const result: string[] = []
    for (let i = 0; i < inputArray.length; i++) {
        const arg = inputArray[i]
        if (shortFlag(arg)) {
            if (seperateShort) {
                const shortFlags = arg.slice(1).split('').map(ch => '-'+ch)
                result.push(...shortFlags)
            } else {
                result.push(arg)
            }
        } else if (longFlag(arg)) {
            result.push(arg)
        }
    }
    return result
}

const findMatchingFlags = (inputFlags: string[], allFlagLines: string[]) => {
    const output: string[] = []
    for (let line of allFlagLines) {
        const [flag, doc] = line.split('\t')
        if (inputFlags.includes(flag)) {
            output.push(line)
        }
    }
    return output
}


export async function getFlagDocumentationString(input: string) : Promise<string[]> {
    let splitInputArray = tokenizeInput(input);
    let outputFlagLines = await outputFlags(splitInputArray)
    let shouldSeperateShortFlags = !hasUnixFlags(outputFlagLines)
    let parsedInputFlags = parseInputFlags(splitInputArray, shouldSeperateShortFlags)
    let matchingFlags = findMatchingFlags(parsedInputFlags, outputFlagLines)
    return matchingFlags
            .map(line => line.split('\t'))
            .map(([flag, doc]) => `**\`${flag}\`** *\`${doc}\`*`)
            .reverse()
}

export function getFlagCommand(input: string) : string {
    let splitInputArray = tokenizeInput(input);
    const firstFlag = findFirstFlagIndex(splitInputArray)
    let cmd = splitInputArray.slice(0, firstFlag)
    return cmd.join(' ')
}


export async function getFlagDocumentationAsMarkup(input: string) : Promise<MarkupContent> {
    let cmdName = getFlagCommand(input)
    let flagLines = await getFlagDocumentationString(input)
    let flagString = flagLines.join('\n')
    return {
        kind: MarkupKind.Markdown,
        value: [
            `***\`${cmdName}\`***`,
            '___',
            flagString
        ].join('\n')
    }
}