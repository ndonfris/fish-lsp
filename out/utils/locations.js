"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllFishLocations = exports.readFishDir = exports.getFishTextDocumentsFromStandardLocations = exports.FISH_LOCATIONS = void 0;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
//import * as glob from 'glob';
//import  { globby } from 'globby'
const fast_glob_1 = __importDefault(require("fast-glob"));
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const completionsDir = (0, path_1.resolve)((0, os_1.homedir)(), '.config', 'fish', 'completions');
const functionsDir = (0, path_1.resolve)((0, os_1.homedir)(), '.config', 'fish', 'functions');
const configPath = (0, path_1.resolve)((0, os_1.homedir)(), '.config', 'fish', 'config.fish');
const builtinFunctionsDir = (0, path_1.resolve)('/', 'usr', 'share', 'fish', 'functions');
const builtinCompletionsDir = (0, path_1.resolve)('/', 'usr', 'share', 'fish', 'completions');
exports.FISH_LOCATIONS = {
    configFile: configPath,
    config: {
        completions: completionsDir,
        functions: functionsDir,
    },
    builtins: {
        completions: builtinCompletionsDir,
        functions: builtinFunctionsDir,
    }
};
function getFishTextDocumentsFromStandardLocations() {
    return __awaiter(this, void 0, void 0, function* () {
        const paths = [`${(0, os_1.homedir)()}/.config/fish`, '/usr/share/fish'];
        const allFiles = [];
        paths.forEach((path) => {
            const files = fast_glob_1.default.sync("**.fish", {
                absolute: true,
                dot: true,
                globstar: true,
                deep: 5,
                cwd: path,
            });
            allFiles.push(...files);
        });
        // now allFiles contains every fish file that could be used in the workspace
        return yield Promise.all(allFiles.map((file) => __awaiter(this, void 0, void 0, function* () {
            const contents = yield fs_1.promises.readFile(file, 'utf8');
            return vscode_languageserver_textdocument_1.TextDocument.create(file, 'fish', 0, contents || "");
        })));
    });
}
exports.getFishTextDocumentsFromStandardLocations = getFishTextDocumentsFromStandardLocations;
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
function readFishDir(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        let files = [];
        try {
            files = (0, fs_1.readdirSync)(dir, { encoding: 'utf8', withFileTypes: false });
        }
        catch (e) {
            console.log(e);
        }
        return files.map(file => dir + path_1.sep + file.toString());
    });
}
exports.readFishDir = readFishDir;
function getAllFishLocations() {
    return __awaiter(this, void 0, void 0, function* () {
        const allDirs = [
            exports.FISH_LOCATIONS.config.completions,
            exports.FISH_LOCATIONS.config.functions,
        ];
        //FISH_LOCATIONS.builtins.functions,
        //FISH_LOCATIONS.builtins.completions,
        const files = [];
        for (const loc of allDirs) {
            const newFiles = yield readFishDir(loc);
            files.push(...newFiles);
        }
        files.push(exports.FISH_LOCATIONS.configFile);
        return files;
    });
}
exports.getAllFishLocations = getAllFishLocations;
//# sourceMappingURL=locations.js.map