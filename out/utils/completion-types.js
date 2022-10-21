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
exports.handleCompletionResolver = exports.buildCompletionItemPromise = exports.resolveFishCompletionItemType = exports.getFishCompletionItemType = exports.completionItemKindMap = exports.fishCompletionItemKindMap = exports.FishCompletionItemKind = exports.getCompletionItemKind = exports.isFishCommand = exports.isGlobalVariable = exports.isGlobalFunction = exports.isFlag = exports.isBuiltIn = exports.BuiltInList = exports.isCommand = exports.isAlias = exports.isAbbr = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const documentation_1 = require("../documentation");
const exec_1 = require("./exec");
function createFishBuiltinComplete(arr) {
    const cmp = {
        text: "",
        description: ""
    };
    cmp.text = arr[0];
    if (arr.length === 2) {
        cmp.description = arr[1];
    }
    return cmp;
}
function parseDescriptionKeywords(cliText) {
    const secondItem = cliText.description.replace(':', '');
    let results = [];
    if (secondItem === "") {
        return [""];
    }
    else {
        if (secondItem.includes(' ')) {
            results = secondItem.split(' ', 2);
            return [results[0].toLowerCase(), ...results.slice(1)];
        }
        else {
            return [secondItem];
        }
    }
}
/**
 *     ta	Abbreviation: tmux attach -t
 *
 * @param {CmdLineCmp} line - a result from fish's builtin commandline completions
 *                     index[0]: the actual abbr
 *                     index[1]: Abbreviation: expansion
 *
 */
function isAbbr(line) {
    if (line[0] === 'fft') {
        return true;
    }
    return false;
    ///if (cliText.description !== "")  {
    ///    const firstWord = cliText.description.split(' ', 1)[0]
    ///    return firstWord === "Abbreviation:"
    ///}
    ///return false;
}
exports.isAbbr = isAbbr;
/**
 * line is an array of length 2 (Example below)
 *
 *     vdiff	    alias vdiff=nvim -d
 *     vimdiff	    alias vimdiff=nvim -d
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 *                     index[0]: the alias
 *                     index[1]: alias shortend_cmd=some_longer_cmd
 */
function isAlias(line) {
    if (line.length > 1) {
        return line[1].split(' ', 1)[0] === 'alias';
    }
    return false;
}
exports.isAlias = isAlias;
/**
 * line is an array of length 2 (Example's below). External commands MIGHT have man-pages,
 * and are retrieved as executeables in $PATH.
 *
 *     acpi_listen	command
 *     adhocfilelist	command link
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an Shell External Command.
 */
function isCommand(line) {
    if (line.length === 2) {
        return [
            'command',
            'command link'
        ].includes(line[1]);
    }
    return false;
}
exports.isCommand = isCommand;
exports.BuiltInList = [
    "[",
    "_",
    "and",
    "argparse",
    "begin",
    "bg",
    "bind",
    "block",
    "break",
    "breakpoint",
    "builtin",
    "case",
    "cd",
    "command",
    "commandline",
    "complete",
    "contains",
    "continue",
    "count",
    "disown",
    "echo",
    "else",
    "emit",
    "end",
    "eval",
    "exec",
    "exit",
    "false",
    "fg",
    "for",
    "function",
    "functions",
    "history",
    "if",
    "jobs",
    "math",
    "not",
    "or",
    "path",
    "printf",
    "pwd",
    "random",
    "read",
    "realpath",
    "return",
    "set",
    "set_color",
    "source",
    "status",
    "string",
    "switch",
    "test",
    "time",
    "true",
    "type",
    "ulimit",
    "wait",
    "while",
];
// You can generate this list by running `builtin --names` in a fish session
// note that '.', and ':' are removed from the list because they do not contain
// a man-page
const BuiltInSET = new Set(exports.BuiltInList);
/**
 * line is an array of length 2 (Example's below). Builtins are retreived via:
 *          builtins --names
 * builtins
 *
 *     true	Do nothing, successfully
 *     while	Perform a command multiple times
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an builtin
 */
function isBuiltIn(line) {
    const word = line[0].trim();
    return BuiltInSET.has(word);
}
exports.isBuiltIn = isBuiltIn;
/**
 *   line array length could be 1 or 2. User completions may not provide description
 *
 *   Example below, seen from 'test -'
 *
 *   -x     File is executable
 *   -w	    File is writable
 *   -u	    File set-user-ID bit is set
 */
function isFlag(line) {
    return line[0].startsWith('-');
}
exports.isFlag = isFlag;
function isGlobalFunction() {
    return false;
}
exports.isGlobalFunction = isGlobalFunction;
/**
 * line is an array of length 2 (Example's below). Retrieving a gloabl varaible can be
 * done through the shell in any of the following methods. (We use method 1)
 *
 *       complete --do-complete '$'
 *       ~~~~~~~~~~~~~~ or ~~~~~~~~~~~
 *       set --show
 *       ~~~~~~~~~~~~~~ or ~~~~~~~~~~~
 *       set --names
 *
 *
 *    $BAT_THEME	Variable: base16
 *    $CMD_DURATION	Variable: 3
 *    $COLUMNS	        Variable: 127
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 * @return {boolean} - line is a completion for an builtin
 */
function isGlobalVariable(line) {
    // noDescription
    if (line.length == 2) {
        return line[1].trim().startsWith('Variable:');
    }
    return false;
}
exports.isGlobalVariable = isGlobalVariable;
// not neccessary yet.
function isFishCommand(line) {
    // noDescription
    if (line.length === 1) {
        return true;
    }
    if (line.length === 2) {
        const type_indicator = line[1].split(' ', 1)[0];
        const somethingElse = [
            'command',
            'command link',
            'alias',
            'Abbreviation:'
        ].includes(type_indicator);
        return !somethingElse && !isBuiltIn(line) && !isFlag(line);
    }
    return false;
}
exports.isFishCommand = isFishCommand;
/**
 * gets the completion item type for Generating a completion item
 *
 * @param {string[]} line - the line recieved from fish shell call
 * @returns {CompletionItemKind} - a completion item kind to display different types
 *                                 of items displayed in a CompletionList.
 *                                 CompletionResolver()  will use this info to enrich
 *                                 the Completion
 */
function getCompletionItemKind(line, fishKind) {
    const cli = createFishBuiltinComplete(line);
    if (fishKind !== undefined) {
        return fishKind === FishCompletionItemKind.LOCAL_VAR
            ? vscode_languageserver_1.CompletionItemKind.Variable : vscode_languageserver_1.CompletionItemKind.Function;
    }
    else if (isAbbr(line)) {
        return vscode_languageserver_1.CompletionItemKind.Interface;
    }
    else if (isAlias(line)) {
        return vscode_languageserver_1.CompletionItemKind.Constant;
    }
    else if (isBuiltIn(line)) {
        return vscode_languageserver_1.CompletionItemKind.Keyword;
    }
    else if (isGlobalVariable(line)) {
        return vscode_languageserver_1.CompletionItemKind.Variable;
    }
    else if (isCommand(line)) {
        return vscode_languageserver_1.CompletionItemKind.Module;
    }
    else if (isFlag(line)) {
        return vscode_languageserver_1.CompletionItemKind.Field;
    }
    else {
        return isFishCommand(line) ?
            vscode_languageserver_1.CompletionItemKind.Method : vscode_languageserver_1.CompletionItemKind.Reference;
    }
}
exports.getCompletionItemKind = getCompletionItemKind;
var FishCompletionItemKind;
(function (FishCompletionItemKind) {
    FishCompletionItemKind[FishCompletionItemKind["ABBR"] = vscode_languageserver_1.CompletionItemKind.Interface] = "ABBR";
    FishCompletionItemKind[FishCompletionItemKind["ALIAS"] = vscode_languageserver_1.CompletionItemKind.Struct] = "ALIAS";
    FishCompletionItemKind[FishCompletionItemKind["BUILTIN"] = vscode_languageserver_1.CompletionItemKind.Keyword] = "BUILTIN";
    FishCompletionItemKind[FishCompletionItemKind["GLOBAL_VAR"] = vscode_languageserver_1.CompletionItemKind.Constant] = "GLOBAL_VAR";
    FishCompletionItemKind[FishCompletionItemKind["LOCAL_VAR"] = vscode_languageserver_1.CompletionItemKind.Variable] = "LOCAL_VAR";
    FishCompletionItemKind[FishCompletionItemKind["USER_FUNC"] = vscode_languageserver_1.CompletionItemKind.Function] = "USER_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["GLOBAL_FUNC"] = vscode_languageserver_1.CompletionItemKind.Method] = "GLOBAL_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["LOCAL_FUNC"] = vscode_languageserver_1.CompletionItemKind.Constructor] = "LOCAL_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["FLAG"] = vscode_languageserver_1.CompletionItemKind.Field] = "FLAG";
    FishCompletionItemKind[FishCompletionItemKind["CMD"] = vscode_languageserver_1.CompletionItemKind.Class] = "CMD";
    FishCompletionItemKind[FishCompletionItemKind["CMD_NO_DOC"] = vscode_languageserver_1.CompletionItemKind.Class] = "CMD_NO_DOC";
    FishCompletionItemKind[FishCompletionItemKind["RESOLVE"] = vscode_languageserver_1.CompletionItemKind.Unit] = "RESOLVE"; // unit
})(FishCompletionItemKind = exports.FishCompletionItemKind || (exports.FishCompletionItemKind = {}));
exports.fishCompletionItemKindMap = {
    ABBR: vscode_languageserver_1.CompletionItemKind.Interface,
    ALIAS: vscode_languageserver_1.CompletionItemKind.Struct,
    BUILTIN: vscode_languageserver_1.CompletionItemKind.Keyword,
    FLAG: vscode_languageserver_1.CompletionItemKind.Field,
    LOCAL_VAR: vscode_languageserver_1.CompletionItemKind.Variable,
    GLOBAL_VAR: vscode_languageserver_1.CompletionItemKind.Constant,
    GLOBAL_FUNC: vscode_languageserver_1.CompletionItemKind.Method,
    USER_FUNC: vscode_languageserver_1.CompletionItemKind.Function,
    LOCAL_FUNC: vscode_languageserver_1.CompletionItemKind.Constructor,
    CMD: vscode_languageserver_1.CompletionItemKind.Class,
    CMD_NO_DOC: vscode_languageserver_1.CompletionItemKind.Class,
    RESOLVE: vscode_languageserver_1.CompletionItemKind.Unit
};
//interface CompeltionItemKindKey {
//[key in keyof typeof CompletionItemKind]: any;
//}
exports.completionItemKindMap = {
    Interface: FishCompletionItemKind.ABBR,
    Struct: FishCompletionItemKind.ALIAS,
    Keyword: FishCompletionItemKind.BUILTIN,
    Field: FishCompletionItemKind.FLAG,
    Variable: FishCompletionItemKind.LOCAL_VAR,
    Constant: FishCompletionItemKind.GLOBAL_VAR,
    Method: FishCompletionItemKind.GLOBAL_FUNC,
    Function: FishCompletionItemKind.USER_FUNC,
    Constructor: FishCompletionItemKind.LOCAL_FUNC,
    Class: FishCompletionItemKind.CMD_NO_DOC,
    Unit: FishCompletionItemKind.RESOLVE
};
//export type CompletionItemKindType = Partial<Record<keyof typeof CompletionItemKind, number>>;
//
//export type CompletionItemKindMapKey = typeof completionItemKindMap[keyof typeof completionItemKindMap]
//export function getCorrespondingKind(knownKind: any): FishCompletionItemKind | CompletionItemKind {
//    if (knownKind instanceof completionItemKindMap) {
//        return completionItemKindMap.knownKind as CompletionItemKindMapKey;
//    } else {
//        return fishCompletionItemKindMap[knownKind] as CompletionItemKindMapKey;
//    }
//    
//
//}
function getFishCompletionItemType(itemKind, options) {
    switch (itemKind) {
        case vscode_languageserver_1.CompletionItemKind.Function:
            return (options === null || options === void 0 ? void 0 : options.local) ?
                FishCompletionItemKind.LOCAL_FUNC : FishCompletionItemKind.GLOBAL_FUNC;
        case vscode_languageserver_1.CompletionItemKind.Interface:
            return FishCompletionItemKind.ABBR;
        case vscode_languageserver_1.CompletionItemKind.Variable:
            return (options === null || options === void 0 ? void 0 : options.local) ?
                FishCompletionItemKind.LOCAL_VAR : FishCompletionItemKind.GLOBAL_VAR;
        case vscode_languageserver_1.CompletionItemKind.Constant:
            return FishCompletionItemKind.ALIAS;
        case vscode_languageserver_1.CompletionItemKind.Keyword:
            return FishCompletionItemKind.BUILTIN;
        case vscode_languageserver_1.CompletionItemKind.Module:
            return FishCompletionItemKind.CMD;
        case vscode_languageserver_1.CompletionItemKind.Field:
            return FishCompletionItemKind.FLAG;
        case vscode_languageserver_1.CompletionItemKind.Method:
            return (options === null || options === void 0 ? void 0 : options.fishFile) ? FishCompletionItemKind.LOCAL_FUNC :
                (options === null || options === void 0 ? void 0 : options.usrFile) ? FishCompletionItemKind.GLOBAL_FUNC :
                    FishCompletionItemKind.RESOLVE;
        default:
            return FishCompletionItemKind.RESOLVE;
    }
}
exports.getFishCompletionItemType = getFishCompletionItemType;
/**
 * TODO: convert to promise.all() -> Promise.all should be able to be called in
 *       completion since it returns a promise
 * @async resolveFishCompletionItemType(cmd) - here we are checking if the command,
 *                                             (from fish completion line [cmd, ...])
 *                                             has either a manpage or fish file.
 *
 *  Output from execCommandType ->
 *       • "command" ==> show using man
 *       • "file"    ==> show using functions query
 *       • ""        ==> show location? TODO
 *
 * @param {string} cmd - first index of completion.stdout.split('\t') array of fish
 *                       temrinal completions.
 * @returns {Promise<FishCompletionItemKind>} - the corresponding FishCompletionItemKind
 *                                              matching cmd.
 */
function resolveFishCompletionItemType(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield (0, exec_1.execCommandType)(cmd)
            .then(cmdType => {
            switch (cmdType) {
                case 'file':
                    return FishCompletionItemKind.GLOBAL_FUNC;
                case 'builtin':
                    return FishCompletionItemKind.CMD;
                default:
                    return FishCompletionItemKind.CMD_NO_DOC;
            }
        }).catch(err => {
            return FishCompletionItemKind.CMD_NO_DOC;
        });
    });
}
exports.resolveFishCompletionItemType = resolveFishCompletionItemType;
function initailFishCompletion(label, arr) {
    const cmpKind = getCompletionItemKind(arr);
    const fishKind = getFishCompletionItemType(cmpKind);
    const result = vscode_languageserver_1.CompletionItem.create(label);
    result.kind = cmpKind;
    result.documentation = arr.length > 1 ? arr[1] : "";
    result.insertText = '';
    result.filterText = "";
    result.data = {
        fishKind: fishKind,
        originalCompletion: arr.join('\t'),
    };
    return result;
}
/**
 * @async buildCompletionItem() - takes the array of nodes from our string.
 *
 * @param {string[]} arr - [name, docs]
 * @returns {Promise<FishCompletionItem>} - CompletionItem to resolve onCompletion()
 */
function buildCompletionItemPromise(arr) {
    const name = arr[0];
    const result = initailFishCompletion(name, arr);
    switch (result.data.fishKind) {
        case FishCompletionItemKind.RESOLVE:
            result.data.fishKind = getFishCompletionItemType(result.kind);
            break;
        case FishCompletionItemKind.ABBR:
            result.insertText = arr[1].split(' ', 1)[-1].trim();
            result.commitCharacters = [' ', ';'];
            break;
        case FishCompletionItemKind.LOCAL_VAR:
            //docs = findDefinition()
            result.documentation = "Local Variable: " + arr[1];
            break;
        case FishCompletionItemKind.LOCAL_FUNC:
            //docs = findDefinition()
            result.documentation = "Local Function: " + arr[1];
            break;
        case FishCompletionItemKind.GLOBAL_VAR:
            //docs = findDefinition
            //result.data.resolveCommand = `set -S ${name}`
            break;
        default:
            break;
    }
    //logger.log('cmpItem ',  {completion: result})
    return result;
    //const result = {
    //    ...CompletionItem.create(name),
    //    documentation: docs,
    //    kind: itemKind,
    //    insertText: insertText,
    //    commitCharacters: commitCharacters,
    //    data: {
    //        resolveCommand: resolveCommand,
    //        fishKind: fishKind, 
    //        originalCompletion: arr.join('\t'),
    //    },
    //}
}
exports.buildCompletionItemPromise = buildCompletionItemPromise;
function handleCompletionResolver(item, console) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        let newDoc = '';
        const fishKind = (_a = item.data) === null || _a === void 0 ? void 0 : _a.fishKind;
        console.log('handleCmpResolver ' + fishKind);
        switch (fishKind) {
            case FishCompletionItemKind.ABBR: // interface
            case FishCompletionItemKind.ALIAS: // interface
                break;
            case FishCompletionItemKind.BUILTIN: // keyword
                newDoc = yield (0, exec_1.execCommandDocs)(item.label);
                item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'man');
                break;
            case FishCompletionItemKind.LOCAL_VAR: // variable
            case FishCompletionItemKind.LOCAL_FUNC: // function
                break;
            case FishCompletionItemKind.GLOBAL_VAR: // variable
            case FishCompletionItemKind.GLOBAL_FUNC: // function
                item.documentation = yield (0, exec_1.execCommandDocs)(item.label);
                break;
            case FishCompletionItemKind.FLAG: // field
                if ((_b = item.data) === null || _b === void 0 ? void 0 : _b.originalCompletion) {
                    item.documentation = (0, documentation_1.enrichCommandArg)(item.data.originalCompletion);
                }
                break;
            case FishCompletionItemKind.CMD: // module
            case FishCompletionItemKind.CMD_NO_DOC: // refrence
            case FishCompletionItemKind.RESOLVE: // method -> module or function
                newDoc = yield (0, exec_1.execCommandDocs)(item.label);
                item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'man');
                break;
        }
        return item;
    });
}
exports.handleCompletionResolver = handleCompletionResolver;
//# sourceMappingURL=completion-types.js.map