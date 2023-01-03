import * as LSP from 'vscode-languageserver';
import {Hover, MarkedString, MarkupKind} from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import {documentationHoverProvider, enrichCommandWithFlags, enrichToCodeBlockMarkdown} from './documentation';
import {execCommandDocs, execComplete, execCompletions} from './utils/exec';
import {isCommand, isCommandName} from './utils/node-types';
import {findEnclosingScope, findFirstParent, getNodeAtRange, getRange} from './utils/tree-sitter';
import * as Symbols from './workspace-symbol';




export async function handleHover(uri: string, root: Parser.SyntaxNode, current: Parser.SyntaxNode) : Promise<LSP.Hover | null>{
    if (current.text.startsWith('-')) {
        return await getHoverForFlag(current)
    }
    const local = Symbols.getMostRecentReference(uri, root, current);
    if (local) {
        const localParent = local.parent ;
        if (!localParent) return null;
        const nodeText = localParent.text || '';
        return {
            contents: enrichToCodeBlockMarkdown(nodeText, 'fish'),
            range: getRange(local),
        }
    } 
    const commandString = await collectCommandString(current);
    return await documentationHoverProvider(commandString)
}




export async function getHoverForFlag(current: Parser.SyntaxNode): Promise<Hover | null> {
    const commandNode = findFirstParent(current, n => isCommand(n))
    if (!commandNode) return null;
    let commandStr = [commandNode.child(0)?.text || '']
    const flags: string[] = []
    let hasFlags = false;
    for (const child of commandNode?.children) {
        if (!hasFlags && !child.text.startsWith('-')) {
            commandStr = await appendToCommand(commandStr, child.text );
            //console.log(commandStr.join(' ').bgBlack);
        } else if (child.text.startsWith('-')) {
            flags.push(child.text)
            hasFlags = true;
        } 
    }
    const flagCompletions = await execCompletions(...commandStr, '-')
    const shouldSplitShortFlags = hasOldUnixStyleFlags(flagCompletions)
    const fixedFlags = spiltShortFlags(flags, shouldSplitShortFlags)
    const found = flagCompletions
        .map(line => line.split('\t'))
        .filter(line => fixedFlags.includes(line[0]))
        .map(line => line.join('\t'))

    return {
        contents: enrichCommandWithFlags(commandStr.join('-'), found)
    }
}

function hasOldUnixStyleFlags(allFlags: string[]) {
    for (const [flag, desc] of allFlags.map(line => line.split('\t'))) {
        if (flag.startsWith('-') && !flag.startsWith('--')) {
            if (flag.length > 2) {
                return true;
            }
        }
    }
    return false;
}

function spiltShortFlags(flags: string[], shouldSplit: boolean): string[] {
    const newFlags : string[] = []
    for (let flag of flags) {
        flag = flag.split('=')[0]
        if (flag.startsWith('-') && !flag.startsWith('--')) {
            if (flag.length > 2 && shouldSplit) {
                newFlags.push(...flag.split('').map(f => '-' + f))
                continue;
            }
        }
        newFlags.push(flag)
    }
    return newFlags
}

async function appendToCommand(commands: string[], subCommand: string): Promise<string[]> {
    const completions = await execCompletions(...commands, ' ')
    if (completions.includes(subCommand)) {
        commands.push(subCommand)
        return commands
    } else {
        return commands;
    }
}

export async function collectCommandString(current: Parser.SyntaxNode): Promise<string> {
    const commandNode = findFirstParent(current, n => isCommand(n))
    if (!commandNode) return '';
    const commandNodeText = commandNode.child(0)?.text
    const subCommandName = commandNode.child(1)?.text
    if (subCommandName?.startsWith("-")) return commandNodeText || ''
    const commandText = [commandNodeText, subCommandName].join('-')
    const docs = await execCommandDocs(commandText)
    if (docs) return commandText
    return commandNodeText || ''
}

