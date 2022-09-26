

import { exec, execFileSync } from 'child_process';
import {resolve} from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);


/**
 * @async execEscapedComplete() - executes the fish command with 
 * 
 * @param {string} cmd - the current command to complete
 *
 * @returns {Promise<string[]>} - the array of completions, types will need to be added when
 *                                the fish completion command is implemented
 */
export async function execEscapedCommand(cmd: string): Promise<string[]> {
    const escapedCommand = cmd.replace(/(["'$`\\])/g,'\\$1');
    const completeString = `fish -c "${escapedCommand}"`;

    const child = await execAsync(completeString)

    if (!child) {
        return ['']
    }

    return child.stdout.trim().split('\n')
}



export async function execCompleteLine(cmd: string): Promise<string[]> {
    const escapedCommand = cmd.replace(/(["'$`\\])/g,'\\$1');
    const completeString = `fish -c "${escapedCommand}"`;

    const child = await execAsync(completeString)

    if (child.stderr) {
        return ['']
    }

    return child.stdout.trim().split('\n')
}

export async function execCompleteCmdArgs(cmd: string): Promise<string[]> {
    let results = await execEscapedCommand(`complete --do-complete='${cmd} -'`)

    let i = 0;
    let fixedResults: string[] = [];
    while ( i < results.length) {
        const line = results[i]
        if (!line.startsWith('-', 0)) {
            //fixedResults.slice(i-1, i).join(' ')
            fixedResults.push(fixedResults.pop()?.trimEnd() + ' ' + line.trim())
        } else {
            fixedResults.push(line)
        }  
        i++;
    }

    return fixedResults;
}


export async function execCompleteAbbrs(): Promise<string[]> {
    return await execEscapedCommand('abbr --show');
}

export async function execCommandDocs(cmd: string): Promise<string> {
    const file = resolve(__dirname, '../fish_files/get-documentation.fish')
    const docs = execFileSync(file, [cmd])
    return docs.toString().trim();
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
    const file = resolve(__dirname, '../fish_files/get-type.fish')
    const docs = execFileSync(file, [cmd])
    return docs.toString().trim();
}

export interface CompletionArguments {
    command: string;
    args: {
        [arg: string]: string
    }
}

export async function generateCompletionArguments(cmd: string): Promise<CompletionArguments> {
    const cmdArgs = await execCompleteCmdArgs(cmd)
    const cmdDescription = await execAsync(`fish -c "__fish_describe_command ${cmd}" | head -n1`)
    const cmdHeader = cmdDescription.stdout.toString() || cmd;
    const args: {[arg: string]: string} = {};
    for (const arg of cmdArgs) {
        const flag = arg.split('\t', 1)[0].trim()
        const description =  arg.split('\t', 1)[1].trim()
        args[flag] = description
    }
    return {
        command: cmdHeader,
        args: args
    }
}


export async function execFindDependency(cmd: string): Promise<string> {
    const file = resolve(__dirname, '../fish_files/get-dependency.fish')
    const docs = execFileSync(file, [cmd])
    return docs.toString().trim();
}
