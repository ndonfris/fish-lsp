import {readdirSync} from 'fs';
import {homedir} from 'os';
import { resolve, sep } from 'path'


const completionsDir = resolve(homedir(), '.config', 'fish', 'completions')
const functionsDir = resolve(homedir(), '.config', 'fish', 'functions')
const configPath = resolve(homedir(), '.config', 'fish', 'config.fish')
const builtinFunctionsDir = resolve('/', 'usr', 'share', 'fish', 'functions')
const builtinCompletionsDir = resolve('/', 'usr', 'share', 'fish', 'completions')

export const FISH_LOCATIONS = {
    configFile: configPath,
    config: {
        completions: completionsDir,
        functions:  functionsDir, 
    },
    builtins: {
        completions: builtinCompletionsDir,
        functions: builtinFunctionsDir,
    }
}


export async function readFishDir(dir: string): Promise<string[]> {
    let files: string[] = []
    try {
        files = readdirSync(dir, {encoding:'utf8', withFileTypes: false})
    } catch (e) {
        console.log(e)
    }
    return files.map(file => dir + sep + file.toString())
}

export async function getAllFishLocations(): Promise<string[]> {
    const allDirs = [
        FISH_LOCATIONS.config.completions,
        FISH_LOCATIONS.config.functions,
        FISH_LOCATIONS.builtins.functions,
        FISH_LOCATIONS.builtins.completions,
    ]
    const files: string[] = []
    for (const loc of allDirs) {
        const newFiles = await readFishDir(loc)
        files.push(...newFiles)
    }
    files.push(FISH_LOCATIONS.configFile)
    return files;
}
