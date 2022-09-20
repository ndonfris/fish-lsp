import * as Path from 'path'
import { exec, execFileSync } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec);


/**
 * @async execFishCommand() - executes a command in the fish shell
 *
 * @param {string} cmd - the command to execute inside of an internal fish shell
 * @returns {Promise<string>} output from command
 */
export async function execFishCommand(cmd: string) : Promise<string> {
    const escapedCommand = cmd.replace(/(["'$`\\])/g,'\\$1');
    const completeString = `fish -c '${escapedCommand}'`;

    const child = await execAsync(completeString)

    return child.stdout.trim();
}


export function execFishType(word: string): string {
    const cmd = word.trim() || '';

    if (cmd === '' || word.split(' ').length > 1) {
        return ''
    }

    const result = execFileSync(Path.join(__dirname, '../../scripts/get-type.fish'), [cmd]);

    return result.toString().trim();
}

export function execFishDocumentation(word: string): string {
    const cmd = word.trim() || '';

    if (cmd === '' || word.split(' ').length > 1) {
        return ''
    }

    const result = execFileSync(Path.join(__dirname, '../../scripts/get-documentation.fish'), [cmd]);

    return result.toString().trim();
}


export async function resolveAllFishAbbr(): Promise<Map<string, string>> {
    const result = await execFishCommand('abbr --show');

    const abbrs = new Map<string, string>()

    result.split('\n')
        .map((line: string) => line.split(' -- ', 1))
        .filter(arr => arr.length == 2)
        .map(array => array[1])
        .map(abbr => abbr!.trim().split(' ', 1))
        .filter(arr => arr.length == 2)
        .map(abbr => abbrs.set(abbr[0]!, abbr[1]!))

    return abbrs;
}


export async function resolveAllFishBuiltins(): Promise<string[]> {
    const result = await execFishCommand('builtin -n');

    const builtins = result.split('\n').map(( b: string ) => b.trim())
    return builtins;
}


export async function resolveFishFunctionPath(func: string): Promise<string> {
    const result = await execFishCommand('functions --all --details '+func);
    return result.toString().trim();

}
