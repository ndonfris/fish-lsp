import {CompletionItem, CompletionItemKind, InsertTextFormat, MarkupContent, RemoteConsole} from 'vscode-languageserver';
import {enrichCommandArg, enrichToCodeBlockMarkdown} from '../documentation';
import {execCommandDocs, execCommandType} from './exec';



/**
 * line is an array of length 2 (Example below)
 *
 *     ta	Abbreviation: tmux attach -t
 *
 * @param {string[]} line - a result from fish's builtin commandline completions
 *                     index[0]: the actual abbr
 *                     index[1]: Abbreviation: expansion
 *
 */
export function isAbbr(line: string[]): boolean {
    if (line.length <= 1) {
        return false;
    }
    return line[1].trim().startsWith("Abbreviation:")
}

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
export function isAlias(line: string[]): boolean {
    if (line.length <= 1) {
        return false;
    }
    return line[1].trim().split(' ', 1)[0] === 'alias' 
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
    if (line.length !== 2) {
        return false;
    } 
    return [
        'command',
        'command link'
    ].includes(line[1].trim())
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
export function isBuiltIn(line: string[]): boolean {
    const word = line[0].trim()
    return BuiltInSET.has(word)
}


/**
 *   line array length could be 1 or 2. User completions may not provide description
 *
 *   Example below, seen from 'test -'
 *
 *   -x     File is executable
 *   -w	    File is writable
 *   -u	    File set-user-ID bit is set
 */
export function isFlag(line: string[]): boolean {
    return line[0].startsWith('-')
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

// not neccessary yet.
export function isFishCommand(line: string[]): boolean {
    // noDescription
    if (line.length === 1) {
        return true;
    }
    if (line.length === 2 ) {
        const type_indicator = line[1].split(' ', 1)[0]
        return ![
            'command',
            'command link',
            'alias',
            'Abbreviation:'
        ].includes(type_indicator) && !isBuiltIn(line) && !isFlag(line)
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
export function getCompletionItemType(line: string[], fishKind?: FishCompletionItemKind) : CompletionItemKind {
    if (fishKind !== undefined) {
        return fishKind === FishCompletionItemKind.LOCAL_VAR
            ? CompletionItemKind.Variable : CompletionItemKind.Function
    } else if (isAbbr(line)) {
        return CompletionItemKind.Interface
    } else if (isAlias(line)) {
        return CompletionItemKind.Constant
    } else if (isBuiltIn(line)) {
        return CompletionItemKind.Keyword
    } else if (isGlobalVariable(line)) {
        return CompletionItemKind.Variable
    } else if (isCommand(line)) {
        return CompletionItemKind.Module
    } else if (isFlag(line)) {
        return CompletionItemKind.Field
    } else {
        return  isFishCommand(line)  ? 
            CompletionItemKind.Method :  CompletionItemKind.Reference 
    }
}


export enum FishCompletionItemKind {
    ABBR,              // interface
    ALIAS,             // interface
    BUILTIN,           // keyword
    GLOBAL_VAR,        // variable
    LOCAL_VAR,         // variable
    GLOBAL_FUNC,       // function
    LOCAL_FUNC,        // function
    FLAG,              // field
    CMD,               // module
    CMD_NO_DOC,        // refrence
    RESOLVE            // method -> module or function
}


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


export interface FishCompletionItem extends CompletionItem {
    label: string;
    kind: CompletionItemKind;
    documentation?: string | MarkupContent; 
    insertText?: string;
    commitCharacters?: string[];
    data?: {
        originalCompletion?: string; // the original line in fish completion call from the terminal
        resolveCommand?: string; // command for connection.CompletionResolveItem()
        fishKind?: FishCompletionItemKind; // VERBOSE form of kind
        range?: Range;
    }
}


/**
 * @async buildCompletionItem() - takes the array of nodes from our string. 
 *
 * @param {string[]} arr - [name, docs]
 * @returns {Promise<FishCompletionItem>} - CompletionItem to resolve onCompletion()
 */
export async function buildCompletionItemPromise(arr: string[]): Promise<FishCompletionItem> {
    const name = arr[0];

    let itemKind = getCompletionItemType(arr)
    let fishKind = getFishCompletionItemType(itemKind);
    let originalCompletion = arr.join('\t');
    let docs = arr[1] || originalCompletion;
    let insertText = undefined;
    let resolveCommand = undefined;
    let commitCharacters: string[] = [];

    switch (fishKind) {
        case FishCompletionItemKind.RESOLVE:
            fishKind = getFishCompletionItemType(itemKind)
            break;
        case FishCompletionItemKind.ABBR:
            insertText = docs.split(' ', 1)[-1].trim();
            commitCharacters = [' ', ';']
            break;
        case FishCompletionItemKind.LOCAL_VAR:
            //docs = findDefinition()
            docs = "Local Variable: " + arr[1]
            break;
        case FishCompletionItemKind.LOCAL_FUNC:
            //docs = findDefinition()
            docs = "Local Function: \n" + arr[1]
            break;
        case FishCompletionItemKind.GLOBAL_VAR:
            //docs = findDefinition
            resolveCommand = `set -S ${name}`
            break;
        default:
            break;
    }

    return {
        ...CompletionItem.create(name),
        documentation: docs,
        kind: itemKind,
        insertText,
        commitCharacters,
        data: {
            resolveCommand,
            fishKind, 
            originalCompletion,
        },
    }
}




export async function handleCompletionResolver(item: FishCompletionItem, console: RemoteConsole):  Promise<FishCompletionItem> {
    let newDoc = '';
    const fishKind = item.data?.fishKind;
    console.log('handleCmpResolver ' + fishKind)
    switch (fishKind) {
        case FishCompletionItemKind.ABBR:              // interface
        case FishCompletionItemKind.ALIAS:             // interface
            break;
        case FishCompletionItemKind.BUILTIN:           // keyword
            newDoc = await execCommandDocs(item.label)
            item.documentation = enrichToCodeBlockMarkdown(newDoc, 'man')
            break;
        case FishCompletionItemKind.LOCAL_VAR:         // variable
        case FishCompletionItemKind.LOCAL_FUNC:        // function
            break;
        case FishCompletionItemKind.GLOBAL_VAR:        // variable
        case FishCompletionItemKind.GLOBAL_FUNC:       // function
            item.documentation = await execCommandDocs(item.label)
            break;
        case FishCompletionItemKind.FLAG:              // field
            if (item.data?.originalCompletion) {
                item.documentation = enrichCommandArg(item.data.originalCompletion)
            }
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


