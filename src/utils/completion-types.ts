import FastGlob from 'fast-glob';
import {homedir} from 'os';
import {CompletionItem, CompletionItemKind, InsertTextFormat, MarkupContent, RemoteConsole} from 'vscode-languageserver';
import {enrichCommandArg, enrichToCodeBlockMarkdown, enrichToMarkdown} from '../documentation';
import {logger} from '../logger';
import {execCommandDocs, execCommandType} from './exec';


export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent; 
    data: {
        originalCompletion: string; // the original line in fish completion call from the terminal
        fishKind: FishCompletionItemKind; // VERBOSE form of kind
        localSymbol: boolean;
    }
}

export const BuiltInList = [
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
const BuiltInSET = new Set(BuiltInList);


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
export function isBuiltIn(line: string): boolean {
    return BuiltInSET.has(line)
}


export const escapeChars: {[char: string]: string} = {
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
    ['cx']:' where x is a letter of the alphabet, escapes the control sequence generated by pressing the control key and the specified letter. for example, \\ci is the tab character',
}

interface pipeObj {
    altLabel: string;
    insertText: string;
    documentation: string | MarkupContent;
}

export const pipes: {[pipe:string]: pipeObj} = {
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
}

export const statusNumbers: {[statusNumber: string]: string} = {
    ['0']: 'generally the exit status of commands if they successfully performed the requested operation.',
    ['1']: 'generally the exit status of commands if they failed to perform the requested operation.',
    ['121']:  'is generally the exit status of commands if they were supplied with invalid arguments.',
    ['123']: 'means that the command was not executed because the command name contained invalid characters.',
    ['124']: 'means that the command was not executed because none of the wildcards in the command produced any matches.',
    ['125']: 'means that while an executable with the specified name was located, the operating system could not actually execute the command.',
    ['126']: 'means that while a file with the specified name was located, it was not executable.',
    ['127']: 'means that no function, builtin or command with the given name could be located.'
}

interface exampleCmd {
    cmd: string,
    description: string,
}

interface wildcardCompletionItem {
    label: string,
    documentation: string,
    kind: CompletionItemKind,
    examples: [string, string][]
}


export const WildcardItems: {[char: string]: wildcardCompletionItem } = {
    ['*']: {
        label: '*',
        documentation: 'matches any number of characters (including zero) in a file name, not including _/_',
        kind: CompletionItemKind.Text,
        examples: [
            ['a*', 'matches any files beginning with an ‘a’ in the current directory.'],
            ['ls *.fish', 'matches any fish file within the current directory. [Will not show sub-directories]']
        ]
    },
    ['**']: {
        label: '**',
        documentation: 'matches any number of characters (including zero), and also descends into subdirectories. If _**_ is a segment by itself, that segment may match zero times, for compatibility with other shells.',
        kind: CompletionItemKind.Text,
        examples: [
            ['**', 'matches any files and directories in the current directory and all of its subdirectories',],
            ['ls **.fish', 'finds all fish files in any subdirectory']
        ]
    },
    ['?']: {
        label: '?',
        documentation: 'can match any _single_ character except /. This is deprecated and can be disabled via the qmark-noglob feature flag, so _?_ will just be an ordinary character.',
        kind: CompletionItemKind.Text,
        examples: [
            ['set -Ua fish_features no-qmark-noglob', 'To enable', ],
            ['?*.js', 'would match all js files in the current directory'],
            ['ls | string match -r "(\\w+).??"', 'list the filenames that have two character extenstions']
        ]
    }
}

export const bashEquivalentChars: {[char: string]: string} = {
    [ '$*' ]: '$argv',
    [ '$?']: '$status',
    ['$$']: '$fish_pid',
    ['$#']: 'count $argv',
    ['$!']: '$last_pid',
    ['$0']: 'status filename',
    ['$-']: 'status is-interactive & status is-login'
}

export interface regexItem {
    label: string,
    insertText: string,
    insertTextFormat?: number,
    description: string,
    examples?: string[]
}


export const stringRegexExpressions: regexItem[] = [
    {
	label:'*',
	description:'refers to 0 or more repetitions of the previous expression',
	insertText:'*',
        insertTextFormat: 1,
	examples: [
	]
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
	label:'+',
	description:'1 or more',
	insertText:'+',
        insertTextFormat: 1,
	examples: [
	]
     },
    {
	label:'?',
	description:'0 or 1.',
	insertText:'?',
	examples: [
	]
     },
    {
	label:'{n}',
	description:'to exactly n (where n is a number)',
	insertText:'{n}',
	examples: [
	]
     },
    {
	label:'{n,m}',
	description:'at least n, no more than m.',
	insertText:'{n,m}',
	examples: [
	]
     },

    {
	label:'{n,}',
	description:'n or more',
	insertText:'{${1:number},}',
        insertTextFormat: 2,
	examples: [
	]
     },
    {
        label: '.',
        description: '\'.\' any character except newline',
        insertText: '.',
        examples: [
            
        ]
    },
    {
    label: '\\d a decimal digit',
    description: '\\d a decimal digit and \\D, not a decimal digit',
    insertText: '\\d',
    examples: [

    ]
    },
    {
    label: '\\D not a decimal digit',
    description: '\\d a decimal digit and \\D, not a decimal digit',
    insertText: '\\D',
    examples: [

        ]
    },
    {
    label: '\\s whitespace',
    description: 'whitespace and \\S, not whitespace ',
    insertText: '\\s',
    examples: [

    ]},
    {
    label: '\\S not whitespace',
    description: '\\S, not whitespace and \\s whitespace',
    insertText: '\\S',
    examples: [

    ]},
    {
        label: '\\w a “word” character',
        description: '\\w a “word” character and \\W, a “non-word” character ',
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
        description: '\\b denotes a word boundary, \\B is not a word boundary.' ,
        insertText: '\\b'
    },
    {
        label: '|',
        description: '| is “alternation”, i.e. the “or”.',
        insertText: '|'
    }
]

export enum FishCompletionItemKind {
    ABBR,			// interface
    ALIAS,			// struct
    BUILTIN,			// keyword
    GLOBAL_VAR,			// constant
    LOCAL_VAR,			// variable
    USER_FUNC,			// function
    GLOBAL_FUNC,		// method
    LOCAL_FUNC,			// constructor
    FLAG,			// field
    CMD,			// class
    CMD_NO_DOC,			// class
    RESOLVE,			// unit
}


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
export async function resolveFishCompletionItemType(cmd: string): Promise<FishCompletionItemKind> {
    return await execCommandType(cmd)
        .then(cmdType => {
            switch (cmdType) {
                case 'file':
                    return FishCompletionItemKind.GLOBAL_FUNC
                case 'builtin':
                    return FishCompletionItemKind.CMD
                default:
                    return FishCompletionItemKind.CMD_NO_DOC
            }
        }).catch(err => {
            return FishCompletionItemKind.CMD_NO_DOC
        })
}
