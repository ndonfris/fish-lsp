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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllFishLocations = exports.readFishDir = exports.FISH_LOCATIONS = void 0;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
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