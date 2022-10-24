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
    }
}

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
export function isCommand(line: string[]): boolean {
    if (line.length === 2) {
        return [
            'command',
            'command link'
        ].includes(line[1])
    } 
    return false;
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


const escapeChars = {
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

const pipes: {[pipe:string]: string} = {
    ['READ <SOURCE_FILE']: "To read standard input from a file, use <SOURCE_FILE",
    ['WRITE >DESTINATION']: "To write standard output to a file, use >DESTINATION",
    ['WRITE 2>DESTINATION']: 'To write standard error to a file, use 2>DESTINATION',
    ['APPEND >>DESTINATION_FILE']: 'To append standard output to a file, use >>DESTINATION_FILE',
    ['APPEND 2>>DESTINATION_FILE']: 'To append standard error to a file, use 2>>DESTINATION_FILE',
    ['NOCLOBBER >?DESTINATION']: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
    ['NOCLOBBER 1>?DESTINATION']: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
    ['NOCLOBBER 2>?DESTINATION']: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
    ['CLOSE &-']: 'An ampersand followed by a minus sign (&-). The file descriptor will be closed.',
    ['OUTPUT | INPUT']: 'Pipe one stream with another. Usually standard output of one command will be piped to standard input of another. OUTPUT | INPUT',
    ['DISOWN &']: 'Disown output . OUTPUT &',
    ['STDOUT_AND_STDERR &>']: 'the redirection &> can be used to direct both stdout and stderr to the same destination'
}

const status: {[statusNumber: string]: string} = {
    ['0']: 'generally the exit status of commands if they successfully performed the requested operation.',
    ['1']: 'generally the exit status of commands if they failed to perform the requested operation.',
    ['121']:  'is generally the exit status of commands if they were supplied with invalid arguments.',
    ['123']: 'means that the command was not executed because the command name contained invalid characters.',
    ['124']: 'means that the command was not executed because none of the wildcards in the command produced any matches.',
    ['125']: 'means that while an executable with the specified name was located, the operating system could not actually execute the command.',
    ['126']: 'means that while a file with the specified name was located, it was not executable.',
    ['127']: 'means that no function, builtin or command with the given name could be located.'
}


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
export function isGlobalVariable(line: string[]): boolean {
    // noDescription
    if (line.length == 2) {
        return line[1].trim().startsWith('Variable:')
    }
    return false;
}


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


export function getFishCompletionItemType(itemKind: CompletionItemKind, options?: {local?: boolean, usrFile?: boolean, fishFile?:boolean}) {
    switch (itemKind) {
        case CompletionItemKind.Function:
            return options?.local ?
                FishCompletionItemKind.LOCAL_FUNC : FishCompletionItemKind.GLOBAL_FUNC 

        case CompletionItemKind.Interface: 
            return FishCompletionItemKind.ABBR

        case CompletionItemKind.Variable: 
            return options?.local ?
                FishCompletionItemKind.LOCAL_VAR : FishCompletionItemKind.GLOBAL_VAR  

        case CompletionItemKind.Constant:
            return FishCompletionItemKind.ALIAS

        case CompletionItemKind.Keyword:
            return FishCompletionItemKind.BUILTIN

        case CompletionItemKind.Module:
            return FishCompletionItemKind.CMD

        case CompletionItemKind.Field:
            return FishCompletionItemKind.FLAG

        case CompletionItemKind.Method:
             return options?.fishFile ? FishCompletionItemKind.LOCAL_FUNC :
                    options?.usrFile ?  FishCompletionItemKind.GLOBAL_FUNC : 
                    FishCompletionItemKind.RESOLVE
        default: 
            return FishCompletionItemKind.RESOLVE
    }
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




export async function handleCompletionResolver(item: FishCompletionItem, console: RemoteConsole):  Promise<FishCompletionItem> {
    let newDoc = '';
    const fishKind = item.data?.fishKind;
    console.log('handleCmpResolver ' + fishKind)
    const fallbackString = item.documentation?.toString() || item.data.originalCompletion;
    switch (fishKind) {
        case FishCompletionItemKind.ABBR:              // interface
        case FishCompletionItemKind.ALIAS:             // interface
            item.documentation = enrichToCodeBlockMarkdown(fallbackString)
            break;
        case FishCompletionItemKind.BUILTIN:           // keyword
            newDoc = await execCommandDocs(item.label)
            item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
            break;
        case FishCompletionItemKind.LOCAL_VAR:         // variable
        case FishCompletionItemKind.GLOBAL_VAR:        // variable
            item.documentation = enrichToMarkdown(`__${item.label}__ ${fallbackString}`)
            break;
        case FishCompletionItemKind.LOCAL_FUNC:        // function
        case FishCompletionItemKind.GLOBAL_FUNC:       // function
            item.documentation = await execCommandDocs(item.label)
            break;
        case FishCompletionItemKind.FLAG:              // field
            item.documentation = enrichToMarkdown(`__${item.label}__ ${item.documentation}`)
            break;
        case FishCompletionItemKind.CMD:               // module
        case FishCompletionItemKind.CMD_NO_DOC:        // refrence
        case FishCompletionItemKind.RESOLVE:           // method -> module or function
            newDoc = await execCommandDocs(item.label)
            item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
            break;
    }
    return item;
}


