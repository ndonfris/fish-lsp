"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FilepathResolver = void 0;
const fast_glob_1 = __importDefault(require("fast-glob"));
const os_1 = require("os");
/**
 * Synchroniously  search for all files inside of paths, typically only only should be
 * called in create(). @see findLocalFunctions for similiar implementation of fast-glob
 *
 * @return all files found
 */
function getAbsoluteFilePaths(...paths) {
    const found = [];
    paths.forEach((path) => {
        const files = fast_glob_1.default.sync("**.fish", {
            absolute: true,
            dot: true,
            globstar: true,
            cwd: path,
        });
        found.push(...files);
    });
    return found;
}
class FilepathResolver {
    constructor() {
        this.fishFunctions = [];
        this.userFunctions = [];
        /** TODO: implement on server config settings */
        this.otherFunctions = [];
        this._otherPaths = [];
        this._allPaths = [];
    }
    static create(...locations) {
        //this.otherPaths.push(...locations)
        FilepathResolver.instance = new FilepathResolver();
        const allPathsToSearch = [
            FilepathResolver.defaultGlobalPath,
            FilepathResolver.defaultUserPath,
            //...FilepathResolver._otherPaths,
        ];
        FilepathResolver.instance._allPaths = getAbsoluteFilePaths(...allPathsToSearch);
        FilepathResolver.instance.userFunctions = findLocalFunctions(this.defaultUserPath);
        FilepathResolver.instance.fishFunctions = findLocalFunctions(this.defaultGlobalPath);
        //this.otherFunctions = findLocalFunctions(...this.otherPaths)
        return FilepathResolver.instance;
    }
    isGlobalFishFunction(name) {
        return FilepathResolver.instance.fishFunctions.includes(name);
    }
    isUserFishFunction(name) {
        return FilepathResolver.instance.userFunctions.includes(name);
    }
    isOtherFishFunction(name) {
        return FilepathResolver.instance.userFunctions.includes(name);
    }
    getAllpaths() {
        return FilepathResolver.instance._allPaths;
    }
}
exports.FilepathResolver = FilepathResolver;
FilepathResolver.defaultGlobalPath = '/usr/share/fish';
FilepathResolver.defaultUserPath = `${(0, os_1.homedir)()}/.config/fish`;
function getFunctionNameFromPath(path) {
    const pathArr = path.split('/') || [""];
    if (pathArr.lastIndexOf('functions') === pathArr.length - 2) {
        const filename = pathArr[-1] || '';
        return filename.replace('.fish', '') || "";
    }
    if (pathArr.length == 1) {
        const filename = pathArr[-1] || '';
        return filename.replace('.fish', '') || "";
    }
    return '';
}
function findLocalFunctions(path) {
    const funcs = [];
    const localFuncs = fast_glob_1.default.sync("**.fish", {
        absolute: false,
        dot: true,
        globstar: true,
        cwd: path,
    });
    for (const func of localFuncs) {
        const filename = getFunctionNameFromPath(func);
        funcs.push(filename);
    }
    return funcs;
}
//# sourceMappingURL=filepathResolver.js.map