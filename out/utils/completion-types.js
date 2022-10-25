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
exports.handleCompletionResolver = exports.resolveFishCompletionItemType = exports.getFishCompletionItemType = exports.FishCompletionItemKind = exports.isGlobalVariable = exports.stringRegexExpressions = exports.bashEquivalentChars = exports.WildcardItems = exports.statusNumbers = exports.pipes = exports.escapeChars = exports.isBuiltIn = exports.BuiltInList = exports.isCommand = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const documentation_1 = require("../documentation");
const exec_1 = require("./exec");
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
//export function isBuiltIn(line: string | [...string[]]): boolean {
function isBuiltIn(line) {
    return BuiltInSET.has(line);
}
exports.isBuiltIn = isBuiltIn;
exports.escapeChars = {
    ['a']: 'escapes the alert character',
    ['b']: 'escapes the backspace character',
    ['e']: 'escapes the escape character',
    ['f']: 'escapes the form feed character',
    ['n']: 'escapes a newline character',
    ['r']: 'escapes the carriage return character',
    ['t']: 'escapes the tab character',
    ['v']: 'escapes the vertical tab character',
    [' ']: 'escapes the space character',
    ['$']: 'escapes the dollar character',
    ['\\']: 'escapes the backslash character',
    ['*']: 'escapes the star character',
    ['?']: 'escapes the question mark character',
    ['~']: 'escapes the tilde character',
    ['%']: 'escapes the percent character',
    ['#']: 'escapes the hash character',
    ['(']: 'escapes the left parenthesis character',
    [')']: 'escapes the right parenthesis character',
    ['{']: 'escapes the left curly bracket character',
    ['}']: 'escapes the right curly bracket character',
    ['[']: 'escapes the left bracket character',
    [']']: 'escapes the right bracket character',
    ['<']: 'escapes the less than character',
    ['>']: 'escapes the more than character',
    ['^']: 'escapes the circumflex character',
    ['&']: 'escapes the ampersand character',
    [';']: 'escapes the semicolon character',
    ['"']: 'escapes the quote character',
    ["'"]: 'escapes the apostrophe character',
    ['xxx']: "where xx is a hexadecimal number, escapes the ascii character with the specified value. For example, \\x9 is the tab character.",
    ['Xxx']: "where xx is a hexadecimal number, escapes a byte of data with the specified value. If you are using a mutibyte encoding, this can be used to enter invalid strings. Only use this if you know what you are doing.",
    ['ooo']: 'where ooo is an octal number, escapes the ascii character with the specified value. For example, \\011 is the tab character.',
    ['uxxxx']: 'where xxxx is a hexadecimal number, escapes the 16-bit Unicode character with the specified value. For example, \\u9 is the tab character.',
    ['Uxxxxxxxx']: 'where xxxxxxxx is a hexadecimal number, escapes the 32-bit Unicode character with the specified value. For example, \\U9 is the tab character.',
    ['cx']: ' where x is a letter of the alphabet, escapes the control sequence generated by pressing the control key and the specified letter. for example, \\ci is the tab character',
};
exports.pipes = {
    ['<']: {
        'altLabel': 'READ <SOURCE_FILE',
        'insertText': '<',
        'documentation': 'To read standard input from a file, use <SOURCE_FILE'
    },
    ['>']: {
        'altLabel': 'WRITE >DESTINATION',
        'insertText': '>',
        'documentation': 'To write standard output to a file, use >DESTINATION'
    },
    ['2>']: {
        'altLabel': 'WRITE 2>DESTINATION',
        'insertText': '2>',
        'documentation': 'To write standard error to a file, use 2>DESTINATION'
    },
    ['>>']: {
        'altLabel': 'APPEND >>DESTINATION_FILE',
        'insertText': '>>',
        'documentation': 'To append standard output to a file, use >>DESTINATION_FILE'
    },
    ['2>>']: {
        'altLabel': 'APPEND 2>>DESTINATION_FILE',
        'insertText': '2>>',
        'documentation': 'To append standard error to a file, use 2>>DESTINATION_FILE'
    },
    ['NOCLOBBER >?DESTINATION']: {
        'altLabel': 'NOCLOBBER >?DESTINATION',
        'insertText': '>?',
        'documentation': 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.'
    },
    ['1>?']: {
        'altLabel': 'NOCLOBBER 1>?DESTINATION',
        'insertText': '1>?',
        'documentation': 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.'
    },
    ['2>?']: {
        'altLabel': 'NOCLOBBER 2>?DESTINATION',
        'insertText': '2>?',
        'documentation': 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.'
    },
    ['&-']: {
        'altLabel': 'CLOSE &-',
        'insertText': '&-',
        'documentation': 'An ampersand followed by a minus sign (&-). The file descriptor will be closed.'
    },
    ['|']: {
        'altLabel': 'OUTPUT | INPUT',
        'insertText': '|',
        'documentation': 'Pipe one stream with another. Usually standard output of one command will be piped to standard input of another. OUTPUT | INPUT'
    },
    ['&']: {
        'altLabel': 'DISOWN &',
        'insertText': '&',
        'documentation': 'Disown output . OUTPUT &'
    },
    ['&>']: {
        'altLabel': 'STDOUT_AND_STDERR &>',
        'insertText': '&>',
        'documentation': 'the redirection &> can be used to direct both stdout and stderr to the same destination'
    }
};
exports.statusNumbers = {
    ['0']: 'generally the exit status of commands if they successfully performed the requested operation.',
    ['1']: 'generally the exit status of commands if they failed to perform the requested operation.',
    ['121']: 'is generally the exit status of commands if they were supplied with invalid arguments.',
    ['123']: 'means that the command was not executed because the command name contained invalid characters.',
    ['124']: 'means that the command was not executed because none of the wildcards in the command produced any matches.',
    ['125']: 'means that while an executable with the specified name was located, the operating system could not actually execute the command.',
    ['126']: 'means that while a file with the specified name was located, it was not executable.',
    ['127']: 'means that no function, builtin or command with the given name could be located.'
};
exports.WildcardItems = {
    ['*']: {
        label: '*',
        documentation: 'matches any number of characters (including zero) in a file name, not including _/_',
        kind: vscode_languageserver_1.CompletionItemKind.Text,
        examples: [
            ['a*', 'matches any files beginning with an ‘a’ in the current directory.'],
            ['ls *.fish', 'matches any fish file within the current directory. [Will not show sub-directories]']
        ]
    },
    ['**']: {
        label: '**',
        documentation: 'matches any number of characters (including zero), and also descends into subdirectories. If _**_ is a segment by itself, that segment may match zero times, for compatibility with other shells.',
        kind: vscode_languageserver_1.CompletionItemKind.Text,
        examples: [
            ['**', 'matches any files and directories in the current directory and all of its subdirectories',],
            ['ls **.fish', 'finds all fish files in any subdirectory']
        ]
    },
    ['?']: {
        label: '?',
        documentation: 'can match any _single_ character except /. This is deprecated and can be disabled via the qmark-noglob feature flag, so _?_ will just be an ordinary character.',
        kind: vscode_languageserver_1.CompletionItemKind.Text,
        examples: [
            ['set -Ua fish_features no-qmark-noglob', 'To enable',],
            ['?*.js', 'would match all js files in the current directory'],
            ['ls | string match -r "(\\w+).??"', 'list the filenames that have two character extenstions']
        ]
    }
};
exports.bashEquivalentChars = {
    ['$*']: '$argv',
    ['$?']: '$status',
    ['$$']: '$fish_pid',
    ['$#']: 'count $argv',
    ['$!']: '$last_pid',
    ['$0']: 'status filename',
    ['$-']: 'status is-interactive & status is-login'
};
exports.stringRegexExpressions = [
    {
        label: '*',
        description: 'refers to 0 or more repetitions of the previous expression',
        insertText: '*',
        insertTextFormat: 1,
        examples: []
    },
    {
        label: '^',
        description: '^ is the start of the string or line, $ the end',
        insertText: '^'
    },
    {
        label: '$',
        description: '$ the end of string or line',
        insertText: '$'
    },
    {
        label: '+',
        description: '1 or more',
        insertText: '+',
        insertTextFormat: 1,
        examples: []
    },
    {
        label: '?',
        description: '0 or 1.',
        insertText: '?',
        examples: []
    },
    {
        label: '{n}',
        description: 'to exactly n (where n is a number)',
        insertText: '{n}',
        examples: []
    },
    {
        label: '{n,m}',
        description: 'at least n, no more than m.',
        insertText: '{n,m}',
        examples: []
    },
    {
        label: '{n,}',
        description: 'n or more',
        insertText: '{${1:number},}',
        insertTextFormat: 2,
        examples: []
    },
    {
        label: '.',
        description: 'any character except newline',
        insertText: '.',
        examples: []
    },
    {
        label: '\\d a decimal digit',
        description: '\\d a decimal digit and \\D, not a decimal digit',
        insertText: '\\d',
        examples: []
    },
    {
        label: '\\D not a decimal digit',
        description: '\\d a decimal digit and \\D, not a decimal digit',
        insertText: '\\D',
        examples: []
    },
    {
        label: '\\s whitespace',
        description: 'whitespace and \\S, not whitespace ',
        insertText: '\\s',
        examples: []
    },
    {
        label: '\\S not whitespace',
        description: '\\S, not whitespace and \\s whitespace',
        insertText: '\\S',
        examples: []
    },
    {
        label: '\\w a “word” character',
        description: 'a “word” character and \\W, a “non-word” character ',
        insertText: '\\w'
    },
    {
        label: '\\W a “non-word” character',
        description: 'a “non-word” character ',
        insertText: '\\W'
    },
    {
        label: '[...] a character set',
        description: '[...] - (where “…” is some characters) is a character set ',
        insertText: '[...]',
    },
    {
        label: '[^...]',
        description: '[^...] is the inverse of the given character set',
        insertText: '[^...]',
    },
    {
        label: '[x-y] the range of characters from x-y',
        description: '[x-y] is the range of characters from x-y',
        insertText: '[x-y]',
    },
    {
        label: '[[:xxx:]]',
        description: '[[:xxx:]] is a named character set',
        insertText: '[[:xxx:]]',
    },
    {
        label: '[[:^xxx:]]',
        description: '[[:^xxx:]] is the inverse of a named character set',
        insertText: '[[:^xxx:]]',
    },
    {
        label: '[[:alnum:]]',
        description: '[[:alnum:]] : “alphanumeric”',
        insertText: '[[:alnum:]]',
    },
    {
        label: '[[:alpha:]]',
        description: '[[:alpha:]] : “alphabetic”',
        insertText: '[[:alpha:]]',
    },
    {
        label: '[[:ascii:]]',
        description: '[[:ascii:]] : “0-127”',
        insertText: '[[:ascii:]]',
    },
    {
        label: '[[:blank:]]',
        description: '[[:blank:]] : “space or tab”',
        insertText: '[[:blank:]]',
    },
    {
        label: '[[:cntrl:]]',
        description: '[[:cntrl:]] : “control character”',
        insertText: '[[:cntrl:]]',
    },
    {
        label: '[[:digit:]]',
        description: '[[:digit:]] : “decimal digit”',
        insertText: '[[:digit:]]',
    },
    {
        label: '[[:graph:]]',
        description: '[[:graph:]] : “printing, excluding space”',
        insertText: '[[:graph:]]',
    },
    {
        label: '[[:lower:]]',
        description: '[[:lower:]] : “lower case letter”',
        insertText: '[[:lower:]]',
    },
    {
        label: '[[:print:]]',
        description: '[[:print:]] : “printing, including space”',
        insertText: '[[:print:]]',
    },
    {
        label: '[[:punct:]]',
        description: '[[:punct:]] : “printing, excluding alphanumeric”',
        insertText: '[[:punct:]]',
    },
    {
        label: '[[:space:]]',
        description: '[[:space:]] : “white space”',
        insertText: '[[:space:]]',
    },
    {
        label: '[[:upper:]]',
        description: '[[:upper:]] : “upper case letter”',
        insertText: '[[:upper:]]',
    },
    {
        label: '[[:word:]]',
        description: '[[:word:]] : “same as w”',
        insertText: '[[:word:]]',
    },
    {
        label: '[[:xdigit:]]',
        description: '[[:xdigit:]] : “hexadecimal digit”',
        insertText: '[[:xdigit:]]',
    },
    {
        label: '(...)',
        description: '(...) is a capturing group',
        insertText: '(...)'
    },
    {
        label: '(?:...) is a non-capturing group',
        description: '(?:...) is a non-capturing group',
        insertText: '(?:...)'
    },
    {
        label: '\\n',
        description: '\\n is a backreference (where n is the number of the group, starting with 1)',
        insertText: '\\',
    },
    {
        label: '$n',
        description: '$n is a reference from the replacement expression to a group in the match expression.',
        insertText: '$'
    },
    {
        label: '\\b',
        description: '\\b denotes a word boundary, \\B is not a word boundary.',
        insertText: '\\b'
    },
    {
        label: '|',
        description: '| is “alternation”, i.e. the “or”.',
        insertText: '|'
    }
];
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
/**
 * gets the completion item type for Generating a completion item
 *
 * @param {string[]} line - the line recieved from fish shell call
 * @returns {CompletionItemKind} - a completion item kind to display different types
 *                                 of items displayed in a CompletionList.
 *                                 CompletionResolver()  will use this info to enrich
 *                                 the Completion
 */
//export function getCompletionItemKind(line: string[], fishKind?: FishCompletionItemKind) : CompletionItemKind {
//    const cli = createFishBuiltinComplete(line)
//    if (fishKind !== undefined) {
//        return fishKind === FishCompletionItemKind.LOCAL_VAR
//            ? CompletionItemKind.Variable : CompletionItemKind.Function
//    } else if (isAbbr(line)) {
//        return CompletionItemKind.Interface
//    } else if (isAlias(line)) {
//        return CompletionItemKind.Constant
//    } else if (isBuiltIn(line[0])) {
//        return CompletionItemKind.Keyword
//    } else if (isGlobalVariable(line)) {
//        return CompletionItemKind.Variable
//    } else if (isCommand(line)) {
//        return CompletionItemKind.Module
//    } else if (isFlag(line)) {
//        return CompletionItemKind.Field
//    } else {
//        return  isFishCommand(line) ? 
//            CompletionItemKind.Method :  CompletionItemKind.Reference 
//    }
//}
var FishCompletionItemKind;
(function (FishCompletionItemKind) {
    FishCompletionItemKind[FishCompletionItemKind["ABBR"] = 0] = "ABBR";
    FishCompletionItemKind[FishCompletionItemKind["ALIAS"] = 1] = "ALIAS";
    FishCompletionItemKind[FishCompletionItemKind["BUILTIN"] = 2] = "BUILTIN";
    FishCompletionItemKind[FishCompletionItemKind["GLOBAL_VAR"] = 3] = "GLOBAL_VAR";
    FishCompletionItemKind[FishCompletionItemKind["LOCAL_VAR"] = 4] = "LOCAL_VAR";
    FishCompletionItemKind[FishCompletionItemKind["USER_FUNC"] = 5] = "USER_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["GLOBAL_FUNC"] = 6] = "GLOBAL_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["LOCAL_FUNC"] = 7] = "LOCAL_FUNC";
    FishCompletionItemKind[FishCompletionItemKind["FLAG"] = 8] = "FLAG";
    FishCompletionItemKind[FishCompletionItemKind["CMD"] = 9] = "CMD";
    FishCompletionItemKind[FishCompletionItemKind["CMD_NO_DOC"] = 10] = "CMD_NO_DOC";
    FishCompletionItemKind[FishCompletionItemKind["RESOLVE"] = 11] = "RESOLVE";
})(FishCompletionItemKind = exports.FishCompletionItemKind || (exports.FishCompletionItemKind = {}));
//export enum FishCompletionItemKind {
//    ABBR = CompletionItemKind.Interface,                // interface
//    ALIAS = CompletionItemKind.Struct,                  // struct
//    BUILTIN = CompletionItemKind.Keyword,               // keyword
//    GLOBAL_VAR = CompletionItemKind.Constant,           // constant
//    LOCAL_VAR = CompletionItemKind.Variable,            // variable
//    USER_FUNC = CompletionItemKind.Function,            // function
//    GLOBAL_FUNC = CompletionItemKind.Method,            // method
//    LOCAL_FUNC = CompletionItemKind.Constructor,        // constructor
//    FLAG = CompletionItemKind.Field,                    // field
//    CMD = CompletionItemKind.Class,                     // class
//    CMD_NO_DOC = CompletionItemKind.Class,              // class
//    RESOLVE = CompletionItemKind.Unit                   // unit
//}
//export const fishCompletionItemKindMap = {
//    ABBR: CompletionItemKind.Interface,
//    ALIAS: CompletionItemKind.Struct,
//    BUILTIN: CompletionItemKind.Keyword,
//    FLAG: CompletionItemKind.Field, 
//    LOCAL_VAR: CompletionItemKind.Variable, 
//    GLOBAL_VAR: CompletionItemKind.Constant, 
//    GLOBAL_FUNC: CompletionItemKind.Method, 
//    USER_FUNC: CompletionItemKind.Function, 
//    LOCAL_FUNC: CompletionItemKind.Constructor, 
//    CMD: CompletionItemKind.Class,
//    CMD_NO_DOC: CompletionItemKind.Class,
//    RESOLVE: CompletionItemKind.Unit
//} as const;
//interface CompeltionItemKindKey {
//[key in keyof typeof CompletionItemKind]: any;
//}
//export const completionItemKindMap = {
//    Interface:     FishCompletionItemKind.ABBR,
//    Struct:        FishCompletionItemKind.ALIAS,
//    Keyword:       FishCompletionItemKind.BUILTIN,
//    Field:         FishCompletionItemKind.FLAG,
//    Variable:      FishCompletionItemKind.LOCAL_VAR,
//    Constant:      FishCompletionItemKind.GLOBAL_VAR,
//    Method:        FishCompletionItemKind.GLOBAL_FUNC,
//    Function:      FishCompletionItemKind.USER_FUNC,
//    Constructor:   FishCompletionItemKind.LOCAL_FUNC,
//    Class:         FishCompletionItemKind.CMD_NO_DOC,
//    Unit:          FishCompletionItemKind.RESOLVE
//} as const;
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
//function initailFishCompletion(label: string, arr: string[]) {
//    const cmpKind = getCompletionItemKind(arr);
//    const fishKind = getFishCompletionItemType(cmpKind)
//    const result: FishCompletionItem = CompletionItem.create(label) as FishCompletionItem
//    result.kind = cmpKind;
//    result.documentation = arr.length > 1 ? arr[1] : "";
//    result.insertText = '';
//    result.filterText = "";
//    result.data = {
//        fishKind: fishKind,
//        originalCompletion: arr.join('\t'),
//    }
//    return result;
//}
/**
 * @async buildCompletionItem() - takes the array of nodes from our string.
 *
 * @param {string[]} arr - [name, docs]
 * @returns {Promise<FishCompletionItem>} - CompletionItem to resolve onCompletion()
 */
//export function buildCompletionItemPromise(arr: string[]): FishCompletionItem {
//    const name = arr[0];
//    const result = initailFishCompletion(name, arr);
//    switch (result.data.fishKind) {
//        case FishCompletionItemKind.RESOLVE:
//            result.data.fishKind = getFishCompletionItemType(result.kind)
//            break;
//        case FishCompletionItemKind.ABBR:
//            result.insertText = arr[1].split(' ', 1)[-1].trim();
//            result.commitCharacters = [' ', ';']
//            break;
//        case FishCompletionItemKind.LOCAL_VAR:
//            //docs = findDefinition()
//            result.documentation = "Local Variable: " + arr[1]
//            break;
//        case FishCompletionItemKind.LOCAL_FUNC:
//            //docs = findDefinition()
//            result.documentation = "Local Function: " + arr[1]
//            break;
//        case FishCompletionItemKind.GLOBAL_VAR:
//            //docs = findDefinition
//            //result.data.resolveCommand = `set -S ${name}`
//            break;
//        default:
//            break;
//            
//    }
//    //logger.log('cmpItem ',  {completion: result})
//    return result;
//    //const result = {
//    //    ...CompletionItem.create(name),
//    //    documentation: docs,
//    //    kind: itemKind,
//    //    insertText: insertText,
//    //    commitCharacters: commitCharacters,
//    //    data: {
//    //        resolveCommand: resolveCommand,
//    //        fishKind: fishKind, 
//    //        originalCompletion: arr.join('\t'),
//    //    },
//    //}
//
//}
function handleCompletionResolver(item, console) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        let newDoc = '';
        const fishKind = (_a = item.data) === null || _a === void 0 ? void 0 : _a.fishKind;
        console.log('handleCmpResolver ' + fishKind);
        const fallbackString = ((_b = item.documentation) === null || _b === void 0 ? void 0 : _b.toString()) || item.data.originalCompletion;
        switch (fishKind) {
            case FishCompletionItemKind.ABBR: // interface
            case FishCompletionItemKind.ALIAS: // interface
                item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(fallbackString);
                break;
            case FishCompletionItemKind.BUILTIN: // keyword
                newDoc = yield (0, exec_1.execCommandDocs)(item.label);
                item.documentation = (0, documentation_1.enrichToCodeBlockMarkdown)(newDoc, 'man');
                break;
            case FishCompletionItemKind.LOCAL_VAR: // variable
            case FishCompletionItemKind.GLOBAL_VAR: // variable
                item.documentation = (0, documentation_1.enrichToMarkdown)(`__${item.label}__ ${fallbackString}`);
                break;
            case FishCompletionItemKind.LOCAL_FUNC: // function
            case FishCompletionItemKind.GLOBAL_FUNC: // function
                item.documentation = yield (0, exec_1.execCommandDocs)(item.label);
                break;
            case FishCompletionItemKind.FLAG: // field
                item.documentation = (0, documentation_1.enrichToMarkdown)(`__${item.label}__ ${item.documentation}`);
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