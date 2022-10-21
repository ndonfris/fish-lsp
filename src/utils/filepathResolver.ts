import FastGlob from 'fast-glob';
import {homedir} from 'os';

/**
 * Synchroniously  search for all files inside of paths, typically only only should be 
 * called in create(). @see findLocalFunctions for similiar implementation of fast-glob
 *
 * @return all files found
 */
function getAbsoluteFilePaths(...paths: string[]) {
    const found : string[] = [];
    paths.forEach((path: string) => {
        const files = FastGlob.sync("**.fish", {
            absolute: true,
            dot: true,
            globstar: true,
            cwd: path,
        });
        found.push(...files)
    })
    return found;
}

export class FilepathResolver {

    public fishFunctions: string[] = [];
    public userFunctions: string[] = [];
    /** TODO: implement on server config settings */
    public otherFunctions: string[] = [];

    public static readonly defaultGlobalPath = '/usr/share/fish';
    public static readonly defaultUserPath = `${homedir()}/.config/fish`;

    private _otherPaths: string[] = []
    private _allPaths: string[] = []

    private static instance: FilepathResolver

    private constructor() {}

    public static create(...locations: string[]) {
        //this.otherPaths.push(...locations)
        FilepathResolver.instance = new FilepathResolver();
        const allPathsToSearch = [
            FilepathResolver.defaultGlobalPath,
            FilepathResolver.defaultUserPath,
            //...FilepathResolver._otherPaths,
        ]
        FilepathResolver.instance._allPaths = getAbsoluteFilePaths(...allPathsToSearch)
        FilepathResolver.instance.userFunctions = findLocalFunctions(this.defaultUserPath)
        FilepathResolver.instance.fishFunctions = findLocalFunctions(this.defaultGlobalPath)
        //this.otherFunctions = findLocalFunctions(...this.otherPaths)
        return FilepathResolver.instance;
    }   
    
    public isGlobalFishFunction(name: string) {
        return FilepathResolver.instance.fishFunctions.includes(name)
    }

    public isUserFishFunction(name: string) {
        return FilepathResolver.instance.userFunctions.includes(name)
    }

    public isOtherFishFunction(name: string) {
        return FilepathResolver.instance.userFunctions.includes(name)
    }

    public getAllpaths() {
        return FilepathResolver.instance._allPaths
    }
}

function getFunctionNameFromPath(path: string) {
    const pathArr = path.split('/');
    if (pathArr.lastIndexOf('functions') === pathArr.length - 2) {
        const filename = pathArr[-1] || ''
        return filename.replace('.fish', '')
    }
    if (pathArr.length == 1) {
        const filename = pathArr[-1] || ''
        return filename.replace('.fish', '')
    }
    return ''
}

function findLocalFunctions(path: string) {
    const funcs = []
    const localFuncs = FastGlob.sync("functions/**.fish", {
        absolute: false,
        dot: true,
        globstar: true,
        cwd: path,
    });
    for (const func of localFuncs) {
        const filename = getFunctionNameFromPath(func)
        funcs.push(filename)
    }
    return funcs;
}


