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

    public readonly defaultGlobalPath = '/usr/share/fish';
    public readonly defaultUserPath = `${homedir()}/.config/fish`;

    private _otherPaths: string[] = []
    private _allPaths: string[] = []

    public create(...locations: string[]) {
        this.otherPaths.push(...locations)
        const allPathsToSearch = [
            this.defaultGlobalPath,
            this.defaultUserPath,
            ...this._otherPaths,
        ]
        this._allPaths = getAbsoluteFilePaths(...allPathsToSearch)
        this.userFunctions = findLocalFunctions(this.defaultUserPath)
        this.fishFunctions = findLocalFunctions(this.defaultGlobalPath)
        this.otherFunctions = findLocalFunctions(this.otherPaths)
        return this._allPaths;
    }   
    
    get otherPaths() {
        return this._otherPaths
    }

    get allAbsolutePaths() {
        return this._allPaths;
    }

    public isGlobalFishFunction(name: string) {
        return this.fishFunctions.includes(name)
    }

    public isUserFishFunction(name: string) {
        return this.userFunctions.includes(name)
    }

    public isOtherFishFunction(name: string) {
        return this.userFunctions.includes(name)
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


