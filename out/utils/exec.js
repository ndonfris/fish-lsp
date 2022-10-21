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
exports.execCompleteGlobalDocs = exports.execComplete = exports.execFindSubcommand = exports.execFindDependency = exports.generateCompletionArguments = exports.documentCommandDescription = exports.execCommandType = exports.execCommandDocs = exports.execCompleteAbbrs = exports.execCompleteVariables = exports.execCompleteCmdArgs = exports.execCompleteSpace = exports.execCompleteLine = exports.execEscapedCommand = void 0;
const child_process_1 = require("child_process");
const path_1 = require("path");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * @async execEscapedComplete() - executes the fish command with
 *
 * @param {string} cmd - the current command to complete
 *
 * @returns {Promise<string[]>} - the array of completions, types will need to be added when
 *                                the fish completion command is implemented
 */
function execEscapedCommand(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
        const completeString = `fish -c "${escapedCommand}"`;
        const child = yield execAsync(completeString);
        if (!child) {
            return [''];
        }
        return child.stdout.trim().split('\n');
    });
}
exports.execEscapedCommand = execEscapedCommand;
function execCompleteLine(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
        const completeString = `fish -c "${escapedCommand}"`;
        const child = yield execAsync(completeString);
        return child.stdout.trim().split('\n');
    });
}
exports.execCompleteLine = execCompleteLine;
function execCompleteSpace(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const escapedCommand = cmd.replace(/(["'$`\\])/g, '\\$1');
        const completeString = `fish -c 'complete --do-complete="${escapedCommand} "'`;
        const child = yield execAsync(completeString);
        if (child.stderr) {
            return [''];
        }
        return child.stdout.trim().split('\n');
    });
}
exports.execCompleteSpace = execCompleteSpace;
function execCompleteCmdArgs(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const exec = (0, path_1.resolve)(__dirname, '../../fish_files/get-command-options.fish');
        const args = (0, child_process_1.execFile)(exec, [cmd]);
        const results = args.toString().trim().split('\n');
        let i = 0;
        let fixedResults = [];
        while (i < results.length) {
            const line = results[i];
            if (cmd === 'test') {
                fixedResults.push(line);
            }
            else if (!line.startsWith('-', 0)) {
                //fixedResults.slice(i-1, i).join(' ')
                fixedResults.push(fixedResults.pop() + ' ' + line.trim());
            }
            else {
                fixedResults.push(line);
            }
            i++;
        }
        return fixedResults;
    });
}
exports.execCompleteCmdArgs = execCompleteCmdArgs;
//async function execShell(cmd: string) {
//    const res = await execAsync(`fish -c 'complete --cmd`)
//    return res.stdout.trim()
//}
function execCompleteVariables() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield execEscapedCommand('complete --do-complete="echo \\$"');
    });
}
exports.execCompleteVariables = execCompleteVariables;
function execCompleteAbbrs() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield execEscapedCommand('abbr --show');
    });
}
exports.execCompleteAbbrs = execCompleteAbbrs;
function execCommandDocs(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const file = (0, path_1.resolve)(__dirname, '../../fish_files/get-documentation.fish');
        //const cmdArr = cmd.split(' ')
        const docs = yield execFileAsync(file, [cmd]);
        if (docs.stderr) {
            return '';
        }
        const out = docs.stdout;
        return out.toString().trim();
    });
}
exports.execCommandDocs = execCommandDocs;
/**
 * runs: ../fish_files/get-type.fish <cmd>
 *
 * @param {string} cmd - command type from document to resolve
 * @returns {Promise<string>}
 *                     'command' -> cmd has man
 *                     'file' -> cmd is fish function
 *                     '' ->    cmd is neither
 */
function execCommandType(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const file = (0, path_1.resolve)(__dirname, '../../fish_files/get-type.fish');
        const cmdCheck = cmd.split(' ')[0].trim();
        const docs = yield execFileAsync(file, [cmdCheck]);
        if (docs.stderr) {
            return '';
        }
        return docs.stdout.toString().trim();
    });
}
exports.execCommandType = execCommandType;
function documentCommandDescription(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmdDescription = yield execAsync(`fish -c "__fish_describe_command ${cmd}" | head -n1`);
        return cmdDescription.stdout.trim() || cmd;
    });
}
exports.documentCommandDescription = documentCommandDescription;
function generateCompletionArguments(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const outCmdArgs = yield execCompleteCmdArgs(cmd);
        const cmdDescription = yield execAsync(`fish -c "__fish_describe_command ${cmd}" | head -n1`);
        const cmdHeader = cmdDescription.stdout.toString() || cmd;
        const cmdArgs = new Map();
        for (const line of outCmdArgs) {
            const args = line.split('\t');
            cmdArgs.set(args[0], args[1]);
        }
        return {
            command: cmdHeader,
            args: cmdArgs
        };
    });
}
exports.generateCompletionArguments = generateCompletionArguments;
function execFindDependency(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const file = (0, path_1.resolve)(__dirname, '../../fish_files/get-dependency.fish');
        const docs = (0, child_process_1.execFileSync)(file, [cmd]);
        return docs.toString().trim();
    });
}
exports.execFindDependency = execFindDependency;
function execFindSubcommand(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const file = (0, path_1.resolve)(__dirname, '../../fish_files/get-current-subcommand.fish');
        const docs = (0, child_process_1.execFileSync)(file, cmd);
        return docs.toString().trim()
            .split('\n')
            .map(subcmd => subcmd.split('\t', 1))
            .filter(subcmd => subcmd.length == 2)
            .map(subcmd => subcmd[0].trim());
    });
}
exports.execFindSubcommand = execFindSubcommand;
function execComplete(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const exec = (0, path_1.resolve)(__dirname, '../../fish_files/get-command-options.fish');
        const args = (0, child_process_1.execFileSync)(exec, cmd);
        const results = args.toString().trim().split('\n');
        let i = 0;
        let fixedResults = [];
        while (i < results.length) {
            const line = results[i];
            if (cmd[0] === 'test') {
                fixedResults.push(line);
            }
            else if (!line.startsWith('-', 0)) {
                //fixedResults.slice(i-1, i).join(' ')
                fixedResults.push(fixedResults.pop() + ' ' + line.trim());
            }
            else {
                fixedResults.push(line);
            }
            i++;
        }
        return fixedResults || [];
    });
}
exports.execComplete = execComplete;
function execCompleteGlobalDocs(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const executable = (0, path_1.resolve)(__dirname, '../../fish_files/generate-global-completions.fish');
        const exec = (0, child_process_1.execFileSync)(executable, [cmd]);
        return exec.toString('utf8').trim();
    });
}
exports.execCompleteGlobalDocs = execCompleteGlobalDocs;
//# sourceMappingURL=exec.js.map