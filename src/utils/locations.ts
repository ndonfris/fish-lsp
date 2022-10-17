import {promises, readdirSync} from 'fs';
import {homedir} from 'os';
import path, { resolve, sep } from 'path'
//import * as glob from 'glob';
//import  { globby } from 'globby'
import FastGlob from 'fast-glob';
import {TextDocument} from 'vscode-languageserver-textdocument';


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

export async function getFishTextDocumentsFromStandardLocations() {

    const paths = [`${homedir()}/.config/fish`, "/usr/share/fish"];
    const allFiles: string[] = [];

    paths.forEach((path) => {
        const files = FastGlob.sync("**.fish", {
            absolute: true,
            dot: true,
            globstar: true,
            deep: 5,
            cwd: path,
        });
        allFiles.push(...files);
    });

    // now allFiles contains every fish file that could be used in the workspace
    return await Promise.all(allFiles.map(async file => {
        const contents = await promises.readFile(file, 'utf8')
        return TextDocument.create(file, 'fish', 0, contents || "")
    }))
}


// TODO: globby might not be necessary ? probably is though because you still need the uri's 
//
// @see https://code.visualstudio.com/api/references/vscode-api#workspace.registerFileSystemProvider
// @see https://code.visualstudio.com/api/references/vscode-api#workspace.workspaceFolders
//
// @see https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-multi-server-sample
//       has workspace configuration in client
//
// @see bash-lsp using glob
//      • https://github.com/bash-lsp/bash-language-server/blob/main/server/src/config.ts
//      • https://github.com/bash-lsp/bash-language-server/blob/293f41cfcd881b9c3d99808469de0050896b9a1b/server/src/analyser.ts#L50
//export async function getGlobalIndex(rootPath: string) : Promise<string[]> {
//    const pattern: string = path.posix.join(homedir() ,'.config' , 'fish', '**.fish');
//    // globby -> https://github.com/sindresorhus/globby#readme
//    // patterns ->  https://github.com/sindresorhus/multimatch/blob/main/test/test.js
//    // fast-glob -> https://github.com/mrmlnc/fast-glob#how-to-use-unc-path
//    // note: fast-glob is used under the hood, and the second param of options 
//    //       is from @types/fast-glob
//    //return await globby([pattern], {onlyFiles: true, absolute: true})
//
//    //return new Promise(glob.default(
//    //    pattern,
//    //    { cwd: rootPath, nodir: true, absolute: true, strict: false },
//    //    function (err, files) {
//    //        if (err) {
//    //            return Promise.reject(err)
//    //        }
//
//    //        Promise.resolve(files)
//    //    },
//    //))
//}

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
    ]
    //FISH_LOCATIONS.builtins.functions,
    //FISH_LOCATIONS.builtins.completions,
    const files: string[] = []
    for (const loc of allDirs) {
        const newFiles = await readFishDir(loc)
        files.push(...newFiles)
    }
    files.push(FISH_LOCATIONS.configFile)
    return files;
}
