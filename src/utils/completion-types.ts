import FastGlob from "fast-glob";
import { homedir } from "os";
import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupContent,
    RemoteConsole,
} from "vscode-languageserver";
import {
    enrichCommandArg,
    enrichToCodeBlockMarkdown,
    enrichToMarkdown,
} from "../documentation";
//import {  } from "./completion-strategy";
import { execCommandDocs, execCommandType, getGloablVariable } from "./exec";
import { getAbbrDocString, getAliasDocString, getBuiltinDocString, getCommandDocString, getFunctionDocString, getVariableDocString } from './documentationCache';

export enum FishCompletionItemKind {
    ABBR = "abbr",
    BUILTIN = "builtin",
    FUNCTION = "function",
    VARIABLE = "variable",
    EVENT = "event",
    PIPE = "pipe",
    ESC_CHARS = "esc_chars",
    STATUS = "status",
    WILDCARD = "wildcard",
    COMMAND = "command",
    ALIAS = "alias",
    REGEX = "regex",
    COMBINER = "combiner",
    FORMAT_STR = "format_str",
    STATEMENT = "statement",
    ARGUMENT = "argument",
    EMPTY = "empty",
}

export const toCompletionItemKind: Record<FishCompletionItemKind, CompletionItemKind> = {
    [FishCompletionItemKind.ABBR]: CompletionItemKind.Snippet,
    [FishCompletionItemKind.BUILTIN]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.FUNCTION]: CompletionItemKind.Function,
    [FishCompletionItemKind.VARIABLE]: CompletionItemKind.Variable,
    [FishCompletionItemKind.EVENT]: CompletionItemKind.Event,
    [FishCompletionItemKind.PIPE]: CompletionItemKind.Operator,
    [FishCompletionItemKind.ESC_CHARS]: CompletionItemKind.Operator,
    [FishCompletionItemKind.STATUS]: CompletionItemKind.EnumMember,
    [FishCompletionItemKind.WILDCARD]: CompletionItemKind.Operator,
    [FishCompletionItemKind.COMMAND]: CompletionItemKind.Class,
    [FishCompletionItemKind.ALIAS]: CompletionItemKind.Constructor,
    [FishCompletionItemKind.REGEX]: CompletionItemKind.Operator,
    [FishCompletionItemKind.COMBINER]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.FORMAT_STR]: CompletionItemKind.Operator,
    [FishCompletionItemKind.STATEMENT]: CompletionItemKind.Keyword,
    [FishCompletionItemKind.ARGUMENT]: CompletionItemKind.Property,
    [FishCompletionItemKind.EMPTY]: CompletionItemKind.Text,
}

export interface CompletionExample {
  title: string;
  shellText: string;
}

export namespace CompletionExample {
  export function create(title: string, ...shellText: string[]): CompletionExample {
    let shellTextString: string = shellText.length > 1 ? shellText.join('\n') : shellText.at(0)!
    return {
      title,
      shellText: shellTextString,
    }
  }
}

export interface FishCompletionItem extends CompletionItem {
    label: string;
    detail: string;
    documentation: string;
}

export class FishCompletionItem implements FishCompletionItem {
    kind: CompletionItemKind = CompletionItemKind.Text
    fishKind: FishCompletionItemKind = FishCompletionItemKind.EMPTY
    constructor(label: string, detail: string, documentation: string) {
        this.label = label
        this.detail = detail
        this.documentation = documentation
    }

    setKinds(kind: FishCompletionItemKind) {
        this.kind = toCompletionItemKind[kind]
        this.fishKind = kind
    }

    toStaticCompletionItem(): FishStaticCompletionItem {
        const staticItem = new FishStaticCompletionItem(this.label, this.detail, this.documentation) 
        return staticItem;
    }
    toStaticResolvedCompletionItem(): FishStaticResolvedCompletionItem {
        const staticItem = new FishStaticResolvedCompletionItem(this.label, this.detail, this.documentation)
        return staticItem;
    }
}

export interface FishStaticCompletionItem extends FishCompletionItem {
  examples?: CompletionExample[];
}

export class FishStaticCompletionItem extends FishCompletionItem implements FishStaticCompletionItem {
  constructor(label: string, detail: string, documentation: string, examples: CompletionExample[] = []) {
    super(label, detail, documentation);
    this.examples = examples
  }

  async markupResolver(): Promise<MarkupContent> {
    let result = [
      '```text',
      `${this.label}  -  ${this.documentation}`,
      '```'
    ].join('\n')
    if (this.examples) {
      for (const example of this.examples) {
        result += [
          "___",
          "```fish",
          `# ${example.title}`,
          example.shellText,
          "```",
        ].join("\n");
      }
    }
    return {
      kind: 'markdown',
      value: result
    } as MarkupContent
  }
}

export class FishStaticResolvedCompletionItem extends FishStaticCompletionItem {
  constructor(label: string, detail: string, documentation: string, examples: CompletionExample[] = []) {
    super(label, detail, documentation, examples)
  }

  async markupResolver(): Promise<MarkupContent> {
    const doc = await getBuiltinDocString(this.label)
    if (doc) {
      return {
        kind: 'markdown',
        value: doc
      } as MarkupContent
    }
    return await super.markupResolver()
  }
}

export class FishCommandCompletionItem extends FishCompletionItem {
    constructor(label: string, detail: string, documentation: string) {
        super(label, detail, documentation)
    }

    async markupResolver(): Promise<MarkupContent> {
        const doc = await getCommandDocumentation(this.fishKind, this.label)
        return {
            kind: 'markdown',
            value: doc
        } as MarkupContent
    }
}


async function getCommandDocumentation(toFishCompletionItemKind: FishCompletionItemKind, label: string, documentation?: string): Promise<string | undefined> { 
    switch (toFishCompletionItemKind) {                                                                     
        case FishCompletionItemKind.BUILTIN:                                                                
            return getBuiltinDocString(label)                                                          
        case FishCompletionItemKind.FUNCTION:                                                               
            return getFunctionDocString(label)                                                         
        case FishCompletionItemKind.ABBR:                                                                   
            return getAbbrDocString(label)                                                             
        case FishCompletionItemKind.VARIABLE:                                                               
            return getVariableDocString(label)
        case FishCompletionItemKind.COMMAND:
            return getCommandDocString(label)
        case FishCompletionItemKind.ALIAS:
            return getAliasDocString(label, documentation || `alias ${label}`)
        default:                                                                                            
            return documentation as string
    }                                                                                                       
}                                                                                                           













//export interface FishSimpleCompletionItem extends CompletionItem {
//    label: string;
//    detail: string;
//    documentation: string;
//}
//
//export const EscapeCharItems: FishSimpleCompletionItem[] = [
//    {
//        label: "\\a",
//        detail: 'alert character',
//        documentation: "escapes the alert character",
//    },
//    {
//        label: "\\b",
//        detail: 'backspace character',
//        documentation: "escapes the backspace character"
//    },
//    {
//        label: "\\e",
//        detail: 'escape character',
//        documentation: "escapes the escape character"
//    },
//    {
//        label: "\\f",
//        detail: 'form feed character',
//        documentation: "escapes the form feed character"
//    },
//    {
//        label: "\\n",
//        detail: 'newline character',
//        documentation: "escapes a newline character"
//    },
//    {
//        label: "\\r",
//        detail: 'carriage return character',
//        documentation: "escapes the carriage return character"
//    },
//    {
//        label: "\\t",
//        detail: 'tab character',
//        documentation: "escapes the tab character"
//    },
//    {
//        label: "\\v",
//        detail: 'vertical tab character',
//        documentation: "escapes the vertical tab character"
//    },
//    {
//        label: "\\ ",
//        detail: 'space character',
//        documentation: "escapes the space character"
//    },
//    {
//        label: "\\$",
//        detail: 'dollar character',
//        documentation: "escapes the dollar character"
//    },
//    {
//        label: "\\\\",
//        detail: 'backslash character',
//        documentation: "escapes the backslash character"
//    },
//    {
//        label: "\\*",
//        detail: 'star character',
//        documentation: "escapes the star character"
//    },
//    {
//        label: "\\?",
//        detail: 'question mark character',
//        documentation: "escapes the question mark character"
//    },
//    {
//        label: "\\~",
//        detail: 'tilde character',
//        documentation: "escapes the tilde character"
//    },
//    {
//        label: "\\%",
//        detail: 'percent character',
//        documentation: "escapes the percent character"
//    },
//    {
//        label: "\\#",
//        detail: 'hash character',
//        documentation: "escapes the hash character"
//    },
//    {
//        label: "\\(",
//        detail: 'left parenthesis character',
//        documentation: "escapes the left parenthesis character"
//    },
//    {
//        label: "\\)",
//        detail: 'right parenthesis character',
//        documentation: "escapes the right parenthesis character"
//    },
//    {
//        label: "\\{",
//        detail: 'left curly bracket character',
//        documentation: "escapes the left curly bracket character"
//    },
//    {
//        label: "\\}",
//        detail: 'right curly bracket character',
//        documentation: "escapes the right curly bracket character"
//    },
//    {
//        label: "\\[",
//        detail: 'left bracket character',
//        documentation: "escapes the left bracket character"
//    },
//    {
//        label: "\\]",
//        detail: 'right bracket character',
//        documentation: "escapes the right bracket character"
//    },
//    {
//        label: "\\<",
//        detail: 'less than character',
//        documentation: "escapes the less than character"
//    },
//    {
//        label: "\\>",
//        detail: 'greater than character',
//        documentation: "escapes the more than character"
//    },
//    {
//        label: "\\^",
//        detail: 'circumflex character',
//        documentation: "escapes the circumflex character"
//    },
//    {
//        label: "\\&",
//        detail: 'ampersand character',
//        documentation: "escapes the ampersand character"
//    },
//    {
//        label: "\\;",
//        detail: 'semicolon character',
//        documentation: "escapes the semicolon character"
//    },
//    {
//        label: '\\"',
//        detail: 'quote character',
//        documentation: "escapes the quote character"
//    },
//    {
//        label: "\\'",
//        detail: 'quote character',
//        documentation: "escapes the apostrophe character"
//    },
//    {
//        label: "\\xxx",
//        detail: 'hexadecimal character',
//        documentation: "where xx is a hexadecimal number, escapes the ascii character with the specified value. For example, \\x9 is the tab character."
//    },
//    {
//        label: "\\Xxx",
//        detail: 'hexadecimal character',
//        documentation: "where xx is a hexadecimal number, escapes a byte of data with the specified value. If you are using a mutibyte encoding, this can be used to enter invalid strings. Only use this if you know what you are doing."
//    },
//    {
//        label: "\\ooo",
//        detail: 'octal character',
//        documentation: "where ooo is an octal number, escapes the ascii character with the specified value. For example, \\011 is the tab character."
//    },
//    {
//        label: "\\uxxxx",
//        detail: 'unicode character',
//        documentation: "where xxxx is a hexadecimal number, escapes the 16-bit Unicode character with the specified value. For example, \\u9 is the tab character."
//    },
//    {
//        label: "\\Uxxxxxxxx",
//        detail: 'unicode character',
//        documentation: "where xxxxxxxx is a hexadecimal number, escapes the 32-bit Unicode character with the specified value. For example, \\U9 is the tab character."
//    },
//    {
//        label: "\\cx",
//        detail: 'alphabet character',
//        documentation: " where x is a letter of the alphabet, escapes the control sequence generated by pressing the control key and the specified letter. for example, \\ci is the tab character"
//    },
//];
//
//export const PipeItems: FishSimpleCompletionItem[] = [
//    {
//        label: "<",
//        detail: "READ <SOURCE_FILE",
//        insertText: "<",
//        documentation: "To read standard input from a file, use <SOURCE_FILE",
//    },
//    {
//        label: ">",
//        detail: "WRITE >DESTINATION",
//        insertText: ">",
//        documentation: "To write standard output to a file, use >DESTINATION",
//    },
//    {
//        label: "2>",
//        detail: "WRITE 2>DESTINATION",
//        insertText: "2>",
//        documentation: "To write standard error to a file, use 2>DESTINATION",
//    },
//    {
//        label: ">>",
//        detail: "APPEND >>DESTINATION_FILE",
//        insertText: ">>",
//        documentation:
//            "To append standard output to a file, use >>DESTINATION_FILE",
//    },
//    {
//        label: "2>>",
//        detail: "APPEND 2>>DESTINATION_FILE",
//        insertText: "2>>",
//        documentation:
//            "To append standard error to a file, use 2>>DESTINATION_FILE",
//    },
//    {
//        label: ">?",
//        detail: "NOCLOBBER >? DESTINATION",
//        insertText: ">?",
//        documentation:
//            "To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.",
//    },
//    {
//        label: "1>?",
//        detail: "NOCLOBBER 1>?DESTINATION",
//        insertText: "1>?",
//        documentation:
//            "To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.",
//    },
//    {
//        label: "2>?",
//        detail: "NOCLOBBER 2>?DESTINATION",
//        insertText: "2>?",
//        documentation:
//            "To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.",
//    },
//    {
//        label: "&-",
//        detail: "CLOSE &-",
//        insertText: "&-",
//        documentation:
//            "An ampersand followed by a minus sign (&-). The file descriptor will be closed.",
//    },
//    {
//        label: "|",
//        detail: "OUTPUT | INPUT",
//        insertText: "|",
//        documentation:
//            "Pipe one stream with another. Usually standard output of one command will be piped to standard input of another. OUTPUT | INPUT",
//    },
//    {
//        label: "&",
//        detail: "DISOWN &",
//        insertText: "&",
//        documentation: "Disown output . OUTPUT &",
//    },
//    {
//        label: "&>",
//        detail: "STDOUT_AND_STDERR &>",
//        insertText: "&>",
//        documentation:
//            "the redirection &> can be used to direct both stdout and stderr to the same destination",
//    },
//    {
//        label: '&|',
//        detail: "STDOUT_AND_STDERR &|",
//        insertText: "&|",
//        documentation:
//            "the redirection &| can be used to direct both stdout and stderr to the same destination",
//    }
//];
//
////export const StatusNumbersCompletionItems: CompletionItem[] = [
//export const StatusNumbers: FishSimpleCompletionItem[] = [
//    {
//        label: "0",
//        detail: "Status Success",
//        documentation: "Success",
//    },
//    {
//        label: "1",
//        detail: "Status Failure",
//        documentation: "Failure",
//    },
//    {
//        label: "121",
//        detail: 'Status Invalid Arguments',
//        documentation: "is generally the exit status of commands if they were supplied with invalid arguments.",
//    },
//    {
//        label: "123",
//        detail: "Status Invalid Command",
//        documentation: "means that the command was not executed because the command name contained invalid characters.",
//    },
//    {
//        label: "124",
//        detail: "Status No Matches",
//        documentation: "means that the command was not executed because none of the wildcards in the command produced any matches.",
//    },
//    {
//        label: "125",
//        detail: "Status Invalid Privileges",
//        documentation: "means that while an executable with the specified name was located, the operating system could not actually execute the command.",
//    },
//    {
//        label: "126",
//        detail: "Status Not Executable",
//        documentation: "means that while a file with the specified name was located, it was not executable.",
//    },
//    {
//        label: "127",
//        detail: "Status Not Found",
//        documentation: "means that no function, builtin or command with the given name could be located.",
//    },
//]
//
//interface exampleCmd {
//    cmd: string;
//    description: string;
//}
//
//interface WildcardCompletionItem {
//    label: string;
//    documentation: string;
//    kind: CompletionItemKind;
//    examples: [string, string][];
//}
//
//export const WildcardItems: WildcardCompletionItem[] = [
//    {
//        label: "*",
//        documentation: "matches any number of characters (including zero) in a file name, not including _/_",
//        kind: CompletionItemKind.Text,
//        examples: [
//            [
//                "a*",
//                "matches any files beginning with an ‘a’ in the current directory.",
//            ],
//            [
//                "ls *.fish",
//                "matches any fish file within the current directory. [Will not show sub-directories]",
//            ],
//        ],
//    },
//    {
//        label: "**",
//        documentation: "matches any number of characters (including zero), and also descends into subdirectories. If _**_ is a segment by itself, that segment may match zero times, for compatibility with other shells.",
//        kind: CompletionItemKind.Text,
//        examples: [
//            [
//                "**",
//                "matches any files and directories in the current directory and all of its subdirectories",
//            ],
//            ["ls **.fish", "finds all fish files in any subdirectory"],
//        ]
//    },
//    {
//        label: "?",
//        documentation: "can match any _single_ character except /. This is deprecated and can be disabled via the qmark-noglob feature flag, so _?_ will just be an ordinary character.",
//        kind: CompletionItemKind.Text,
//        examples: [
//            ["set -Ua fish_features no-qmark-noglob", "To enable"],
//            ["?*.js", "would match all js files in the current directory"],
//            [
//                'ls | string match -r "(\\w+).??"',
//                "list the filenames that have two character extenstions",
//            ],
//        ],
//    },
//];
//
//export const bashEquivalentChars: { [char: string]: string } = {
//    ["$*"]: "$argv",
//    ["$?"]: "$status",
//    ["$$"]: "$fish_pid",
//    ["$#"]: "count $argv",
//    ["$!"]: "$last_pid",
//    ["$0"]: "status filename",
//    ["$-"]: "status is-interactive & status is-login",
//};
//
//export interface FishRegexItem extends FishSimpleCompletionItem {
//    label: string;
//    documentation: string;
//    insertText: string;
//    examples?: string[];
//}
//
//export const StringRegexExpressions: FishRegexItem[] = [
//    {
//        label: "*",
//        detail: '0 >= matches',
//        documentation:
//            "refers to 0 or more repetitions of the previous expression",
//        insertText: "*",
//        insertTextFormat: 1,
//        examples: [],
//    },
//    {
//        label: "^",
//        detail: "START of string",
//        documentation: "^ is the start of the string or line, $ the end",
//        insertText: "^",
//    },
//    {
//        label: "$",
//        detail: "END of string",
//        documentation: "$ the end of string or line",
//        insertText: "$",
//    },
//    {
//        label: "+",
//        detail: "1 >= matches",
//        documentation: "1 or more",
//        insertText: "+",
//        insertTextFormat: 1,
//        examples: [],
//    },
//    {
//        label: "?",
//        detail: "0 or 1 matches",
//        documentation: "0 or 1.",
//        insertText: "?",
//        examples: [],
//    },
//    {
//        label: "{n}",
//        detail: "exactly n matches",
//        documentation: "to exactly n (where n is a number)",
//        insertText: "{n}",
//        examples: [],
//    },
//    {
//        label: "{n,m}",
//        detail: "n <= MATCHES <= m",
//        documentation: "at least n, no more than m.",
//        insertText: "{n,m}",
//        examples: [],
//    },
//
//    {
//        label: "{n,}",
//        detail: "n >= MATCHES",
//        documentation: "n or more",
//        insertText: "{${1:number},}",
//        insertTextFormat: 2,
//        examples: [],
//    },
//    {
//        label: ".",
//        detail: 'Alpha-numeric Character',
//        documentation: "'.' any character except newline",
//        insertText: ".",
//        examples: [],
//    },
//    {
//        label: "\\d a decimal digit",
//        detail: "Decimal Character",
//        documentation: "\\d a decimal digit and \\D, not a decimal digit",
//        insertText: "\\d",
//        examples: [],
//    },
//    {
//        label: "\\D not a decimal digit",
//        detail: "Not a Decimal Character",
//        documentation: "\\d a decimal digit and \\D, not a decimal digit",
//        insertText: "\\D",
//        examples: [],
//    },
//    {
//        label: "\\s whitespace",
//        detail: "Whitespace Character",
//        documentation: "whitespace and \\S, not whitespace ",
//        insertText: "\\s",
//        examples: [],
//    },
//    {
//        label: "\\S not whitespace",
//        detail: "Not a Whitespace Character",
//        documentation: "\\S, not whitespace and \\s whitespace",
//        insertText: "\\S",
//        examples: [],
//    },
//    {
//        label: "\\w a “word” character",
//        detail: "Word Character",
//        documentation: "\\w a “word” character and \\W, a “non-word” character ",
//        insertText: "\\w",
//    },
//    {
//        label: "\\W a “non-word” character",
//        detail: "Non-Word Character",
//        documentation: "a “non-word” character ",
//        insertText: "\\W",
//    },
//    {
//        label: "[...] a character set",
//        detail: "Character Set",
//        documentation:
//            "[...] - (where “…” is some characters) is a character set ",
//        insertText: "[...]",
//    },
//    {
//        label: "[^...]",
//        detail: "Inverse Character Set",
//        documentation: "[^...] is the inverse of the given character set",
//        insertText: "[^...]",
//    },
//
//    {
//        label: "[x-y] the range of characters from x-y",
//        detail: "Range of Characters",
//        documentation: "[x-y] is the range of characters from x-y",
//        insertText: "[x-y]",
//    },
//
//    {
//        label: "[[:xxx:]]",
//        detail: "Named Character Set",
//        documentation: "[[:xxx:]] is a named character set",
//        insertText: "[[:xxx:]]",
//    },
//
//    {
//        label: "[[:^xxx:]]",
//        detail: "Inverse Named Character Set",
//        documentation: "[[:^xxx:]] is the inverse of a named character set",
//        insertText: "[[:^xxx:]]",
//    },
//
//    {
//        label: "[[:alnum:]]",
//        detail: "Alphanumeric Character",
//        documentation: "[[:alnum:]] : “alphanumeric”",
//        insertText: "[[:alnum:]]",
//    },
//
//    {
//        label: "[[:alpha:]]",
//        detail: "Alphabetic Character",
//        documentation: "[[:alpha:]] : “alphabetic”",
//        insertText: "[[:alpha:]]",
//    },
//
//    {
//        label: "[[:ascii:]]",
//        detail: "ASCII Character",
//        documentation: "[[:ascii:]] : “0-127”",
//        insertText: "[[:ascii:]]",
//    },
//
//    {
//        label: "[[:blank:]]",
//        detail: "Space or Tab",
//        documentation: "[[:blank:]] : “space or tab”",
//        insertText: "[[:blank:]]",
//    },
//
//    {
//        label: "[[:cntrl:]]",
//        detail: "Control Character",
//        documentation: "[[:cntrl:]] : “control character”",
//        insertText: "[[:cntrl:]]",
//    },
//
//    {
//        label: "[[:digit:]]",
//        detail: "Decimal Digit",
//        documentation: "[[:digit:]] : “decimal digit”",
//        insertText: "[[:digit:]]",
//    },
//
//    {
//        label: "[[:graph:]]",
//        detail: "Printing Character",
//        documentation: "[[:graph:]] : “printing, excluding space”",
//        insertText: "[[:graph:]]",
//    },
//
//    {
//        label: "[[:lower:]]",
//        detail: "Lower Case Letter",
//        documentation: "[[:lower:]] : “lower case letter”",
//        insertText: "[[:lower:]]",
//    },
//
//    {
//        label: "[[:print:]]",
//        detail: "Printing Character",
//        documentation: "[[:print:]] : “printing, including space”",
//        insertText: "[[:print:]]",
//    },
//
//    {
//        label: "[[:punct:]]",
//        detail: "Punctuation Character",
//        documentation: "[[:punct:]] : “printing, excluding alphanumeric”",
//        insertText: "[[:punct:]]",
//    },
//
//    {
//        label: "[[:space:]]",
//        detail: "White Space Character",
//        documentation: "[[:space:]] : “white space”",
//        insertText: "[[:space:]]",
//    },
//
//    {
//        label: "[[:upper:]]",
//        detail: "Upper Case Letter",
//        documentation: "[[:upper:]] : “upper case letter”",
//        insertText: "[[:upper:]]",
//    },
//
//    {
//        label: "[[:word:]]",
//        detail: "Word Character",
//        documentation: "[[:word:]] : “same as w”",
//        insertText: "[[:word:]]",
//    },
//    {
//        label: "[[:xdigit:]]",
//        detail: "Hexadecimal Digit",
//        documentation: "[[:xdigit:]] : “hexadecimal digit”",
//        insertText: "[[:xdigit:]]",
//    },
//    {
//        label: "(...)",
//        detail: "Capturing Group",
//        documentation: "(...) is a capturing group",
//        insertText: "(...)",
//    },
//    {
//        label: "(?:...) is a non-capturing group",
//        detail: "Non-Capturing Group",
//        documentation: "(?:...) is a non-capturing group",
//        insertText: "(?:...)",
//    },
//    {
//        label: "\\n",
//        detail: "Backreference",
//        documentation:
//            "\\n is a backreference (where n is the number of the group, starting with 1)",
//        insertText: "\\",
//    },
//    {
//        label: "$n",
//        detail: "Reference",
//        documentation:
//            "$n is a reference from the replacement expression to a group in the match expression.",
//        insertText: "$",
//    },
//    {
//        label: "\\b",
//        detail: "Word Boundary",
//        documentation: "\\b denotes a word boundary, \\B is not a word boundary.",
//        insertText: "\\b",
//    },
//    {
//        label: "|",
//        detail: "Alternation",
//        documentation: "| is “alternation”, i.e. the “or”.",
//        insertText: "|",
//    },
//];
//
////export const FunctionCompletionEvents: FishSimpleCompletionItem[] = [
////    {
////        label: "fish_prompt",
////        documentation:
////            "is emitted whenever a new fish prompt is about to be displayed.",
////    },
////    {
////        label: "fish_preexec",
////        documentation:
////            "is emitted right before executing an  interactive  command.  The  commandline  is passed as the first parameter. Not emitted if command is empty. ",
////    },
////    {
////        label: "fish_posterror",
////        documentation:
////            "is emitted right after executing a command with syntax errors. The commandline is passed as the first parameter.",
////    },
////    {
////        label: "fish_postexec",
////        documentation:
////            "is emitted right after executing an  interactive  command.  The  commandline  is passed as the first parameter. Not emitted if command is empty.",
////    },
////    {
////        label: "fish_exit",
////        documentation: "is emitted right before fish exits.",
////    },
////    {
////        label: "fish_cancel",
////        documentation: "is emitted when a commandline is cleared.",
////    },
////];
//
//export const CombinerCompletionItems: FishSimpleCompletionItem[] = [
//    {
//        label: "and",
//        detail: "and CONDITION; COMMANDS; end",
//        documentation:
//            "is a combiner that combines two commands with a logical and. The second command is only executed if the first command returns true.",
//    },
//    {
//        label: "or",
//        detail: "or CONDITION; COMMANDS; end",
//        documentation:
//            "is a combiner that combines two commands with a logical or. The second command is only executed if the first command returns false.",
//    },
//    {
//        label: "not",
//        detail: "not CONDITION; COMMANDS; end",
//        documentation:
//            "not  negates the exit status of another command. If the exit status is zero, not returns 1. Otherwise, not returns 0.",
//    },
//    {
//        label: "||",
//        detail: "|| CONDITION; COMMANDS; end",
//        documentation:
//            "is a combiner that combines two commands with a logical or. The second command is only executed if the first command returns false.",
//    },
//    {
//        label: "&&",
//        detail: "&& CONDITION; COMMANDS; end",
//        documentation:
//            "is a combiner that combines two commands with a logical and. The second command is only executed if the first command returns true.",
//    },
//    {
//        label: "!",
//        detail: "! CONDITION; COMMANDS; end",
//        documentation:
//            "not  negates the exit status of another command. If the exit status is zero, not returns 1. Otherwise, not returns 0.",
//    },
//];
//
//export const FormatSpecifierCompletionItems: FishSimpleCompletionItem[] = [
//    {
//        label: "%d",
//        detail: "Decimal Integer",
//        documentation:
//            "Argument will be used as decimal integer (signed or unsigned)",
//    },
//    {
//        label: "%i",
//        detail: "Decimal Integer",
//        documentation:
//            "Argument will be used as decimal integer (signed or unsigned)",
//    },
//    {
//        label: "%o",
//        detail: "Octal Integer",
//        documentation: "An octal unsigned integer",
//    },
//    {
//        label: "%u",
//        detail: "Unsigned Integer",
//        documentation:
//            "An unsigned decimal integer - this means negative numbers will wrap around",
//    },
//    {
//        label: "%x",
//        detail: "Hexadecimal Integer",
//        documentation: "An unsigned hexadecimal integer",
//    },
//    {
//        label: "%X",
//        detail: "Hexadecimal Integer",
//        documentation: "An unsigned hexadecimal integer",
//    },
//    {
//        label: "%f",
//        detail: "Floating Point",
//        documentation:
//            "A floating-point number. %f defaults to 6 places after the decimal point (which is  locale-dependent  - e.g. in de_DE it will be a ,).",
//    },
//    {
//        label: "%g",
//        detail: "Floating Point",
//        documentation:
//            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
//    },
//    {
//        label: "%G",
//        detail: "Floating Point",
//        documentation:
//            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
//    },
//    {
//        label: "%s",
//        detail: "String",
//        documentation: "A string",
//    },
//    {
//        label: "%b",
//        detail: "Word Boundary",
//        documentation:
//            "As a string, interpreting backslash escapes, except that octal escapes are of the  form  0 or 0ooo.",
//    },
//    {
//        label: "%%",
//        detail: "Literal Percent",
//        documentation: 'Signifies a literal "%"',
//    },
//];
//
//export const StatementCompletionItems: FishSimpleCompletionItem[] = [
//    {
//        label: "if",
//        detail: "if CONDITION; COMMANDS; end",
//        documentation:
//            "if is a conditional statement that executes a command if a condition is true.",
//    },
//    {
//        label: "else if",
//        detail: "else if CONDITION; COMMANDS; end",
//        documentation:
//            "else if is a conditional statement that executes a command if a condition is true.",
//    },
//    {
//        label: "else",
//        detail: "else; COMMANDS; end",
//        documentation:
//            "else is a conditional statement that executes a command if a condition is true.",
//    },
//    {
//        label: "switch",
//        detail: "switch CONDITION; case VALUE; COMMANDS; end; end",
//        documentation:
//            "switch is a conditional statement that executes a command if a condition is true.",
//    },
//    {
//        label: "while",
//        detail: "while CONDITION; COMMANDS; end",
//        documentation:
//            'while is a conditional statement that executes a command if a condition is true. (Works like a repeated "if" statement)',
//    },
//];
//
////// (fish-doc) line:3552
//////
//////   Keywords
//////       Core language keywords that make up the syntax, like
//////
//////       • if for conditions.
//////
//////       • for and while for loops.
//////
//////       • break and continue to control loops.
//////
//////       • function to define functions.
//////
//////       • return to return a status from a function.
//////
//////       • begin to begin a block and end to end any block (including ifs and loops).
//////
//////       • and, or and not to combine commands logically.
//////
//////       • switch and case to make multiple blocks depending on the value of a variable.
//////
//////       • command or builtin to tell fish what sort of thing to execute
//////
//////       • time to time execution
//////
//////       • exec tells fish to replace itself with a command.
//
//// Use to complete DocumentSymbols if seen in command.
//export const StopShellComplete = '--';
//
//export const WordsToNotCompleteAfter: string[] = [
//    'continue',
//    'break',
//    'begin',
//    'true',
//    'false',
//    //'else'     //
//]
//
//export enum CompletionItemsArrayTypes {
//    NONE,			          // do not complete
//    //ARGUMENTS,                // call to external shell completions
//    VARIABLES,			      // symbols and variables from the external shell call
//    FLAGS,                    // flags from the external shell call
//    BUILTINS,			      // add all builtins to the list
//    FUNCTIONS,			      // add all functions to the list
//    PIPES,                    // add all pipes to the list
//    ESCAPE_CHARS,             // add all escape characters to the list
//    WILDCARDS,                // add all wildcards to the list
//    FORMAT_SPECIFIERS,        // add all format specifiers to the list
//    STATUS_NUMBERS,           // add all status numbers to the list
//    COMBINERS,                // add all combiners to the list
//    EVENTS,                   // add all events to the list
//    REGEX_ITEMS,              // add all regex items to the list
//    AUTOLOAD_FILENAME,         // add ~/.config/fish/functions/<NAME>.fish
//}
//
//export function previousWordToCompletionArrayType(previousWord?: string): CompletionItemsArrayTypes[] {
//    if (!previousWord) return []
//    if (WordsToNotCompleteAfter.includes(previousWord)) return []
//    if (previousWord.endsWith(';')) return [CompletionItemsArrayTypes.COMBINERS]
//    switch (previousWord) {
//        case 'end':
//            return [CompletionItemsArrayTypes.PIPES]
//        case 'command':
//            return []
//        case 'builtin':
//            return [CompletionItemsArrayTypes.BUILTINS]
//        case 'function':
//            return [CompletionItemsArrayTypes.AUTOLOAD_FILENAME]
//        case 'return':
//            return [CompletionItemsArrayTypes.STATUS_NUMBERS]
//        case '--':
//            return [CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.FUNCTIONS]
//        case '<':
//        case '>':
//        case '>>':
//        case '2>':
//        case '2>>':
//        case '&>':
//        case '>?':
//        case '1>?':
//        case '2>?':
//        case '&-':
//        case '|':
//        case '&':
//        case '&>':
//            return []
//        case 'printf':
//            return [CompletionItemsArrayTypes.FORMAT_SPECIFIERS, CompletionItemsArrayTypes.ESCAPE_CHARS]
//        default:
//            return [CompletionItemsArrayTypes.VARIABLES, CompletionItemsArrayTypes.FUNCTIONS]
//    }
//}
//
//const defaultArrayTypes: CompletionItemsArrayTypes[] = [
//    CompletionItemsArrayTypes.BUILTINS,
//    CompletionItemsArrayTypes.FUNCTIONS,
//    CompletionItemsArrayTypes.VARIABLES,
//]
//
//export function wordToCompletionArrayType(word: string): CompletionItemsArrayTypes[] {
//    if (word.endsWith(';')) return [CompletionItemsArrayTypes.COMBINERS, ...defaultArrayTypes]
//    if (word.includes('/')) return [CompletionItemsArrayTypes.WILDCARDS]
//    if (word.endsWith('\\')) return [CompletionItemsArrayTypes.ESCAPE_CHARS]
//    if (word.startsWith('-')) return [CompletionItemsArrayTypes.FLAGS]
//    if (word.startsWith('(') || word.startsWith('$(')) return defaultArrayTypes
//    if (word.startsWith('$') && !word.startsWith('$(')) return [CompletionItemsArrayTypes.VARIABLES]
//    return []
//}
//
//
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
//export async function resolveFishCompletionItemType(
//    cmd: string
//): Promise<FishCompletionItemKind> {
//    return await execCommandType(cmd)
//        .then((cmdType) => {
//            switch (cmdType) {
//                case "file":
//                    return FishCompletionItemKind.GLOBAL_FUNCTION;
//                case "builtin":
//                    return FishCompletionItemKind.CMD;
//                default:
//                    return FishCompletionItemKind.CMD_NO_DOC;
//            }
//        })
//        .catch((err) => {
//            return FishCompletionItemKind.CMD_NO_DOC;
//        });
//}
//
//
//
////export const FormatSpecifierCompletionItems: FishSimpleCompletionItem[] = [
////    {
////        label: "%d",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "Argument will be used as decimal integer (signed or unsigned)",
////        documentation: "Argument will be used as decimal integer (signed or unsigned)",
////    },
////    {
////        label: "%i",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "Argument will be used as decimal integer (signed or unsigned)",
////        documentation: "Argument will be used as decimal integer (signed or unsigned)",
////    },
////    {
////        label: "%o",
////        type: FishCompletionItemType.FormatSpecifier,
////        description: "An octal unsigned integer",
////        documentation: "An octal unsigned integer",
////    },
////    {
////        label: "%u",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "An unsigned decimal integer - this means negative numbers will wrap around",
////        documentation: "An octal unsigned integer",
////    },
////    {
////        label: "%x",
////        type: FishCompletionItemType.FormatSpecifier,
////        description: "An unsigned hexadecimal integer",
////        documentation: "An unsigned hexadecimal integer",
////    },
////    {
////        label: "%X",
////        type: FishCompletionItemType.FormatSpecifier,
////        description: "An unsigned hexadecimal integer",
////        documentation: "An unsigned hexadecimal integer",
////    },
////    {
////        label: "%f",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "A floating-point number. %f defaults to 6 places after the decimal point (which is  locale-dependent  - e.g. in de_DE it will be a ,).",
////        documentation: "A floating-point number. %f defaults to 6 places after the decimal point (which is  locale-dependent  - e.g. in de_DE it will be a ,).",
////    },
////    {
////        label: "%g",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////        documentation: "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////    },
////    {
////        label: "%G",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////        documentation: "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////    },
////    {
////        label: "%s",
////        type: FishCompletionItemType.FormatSpecifier,
////        description: "A string",
////        documentation: "A string",
////    },
////    {
////        label: "%b",
////        type: FishCompletionItemType.FormatSpecifier,
////        description:
////            "As a string, interpreting backslash escapes, except that octal escapes are of the  form  0 or 0ooo.",
////        documentation: "As a string, interpreting backslash escapes, except that octal escapes are of the  form  0 or 0ooo.",
////    },
////    {
////        label: "%%",
////        type: FishCompletionItemType.FormatSpecifier,
////        description: 'Signifies a literal "%"',
////        documentation: 'Signifies a literal "%"',
////    },
////}
////
//
//
//
////
////export const FormatSpecifierCompletionItems: CompletionItem[] = [
////    {
////        label: "%d",
////        description:
////            "Argument will be used as decimal integer (signed or unsigned)",
////    },
////    {
////        label: "%i",
////        description:
////            "Argument will be used as decimal integer (signed or unsigned)",
////    },
////    {
////        label: "%o",
////        description: "An octal unsigned integer",
////    },
////    {
////        label: "%u",
////        description:
////            "An unsigned decimal integer - this means negative numbers will wrap around",
////    },
////    {
////        label: "%x",
////        description: "An unsigned hexadecimal integer",
////    },
////    {
////        label: "%X",
////        description: "An unsigned hexadecimal integer",
////    },
////    {
////        label: "%f",
////        description:
////            "A floating-point number. %f defaults to 6 places after the decimal point (which is  locale-dependent  - e.g. in de_DE it will be a ,).",
////    },
////    {
////        label: "%g",
////        description:
////            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////    },
////    {
////        label: "%G",
////        description:
////            "will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.",
////    },
////    {
////        label: "%s",
////        description: "A string",
////    },
////    {
////        label: "%b",
////        description:
////            "As a string, interpreting backslash escapes, except that octal escapes are of the  form  0 or 0ooo.",
////    },
////    {
////        label: "%%",
////        description: 'Signifies a literal "%"',
////    },
////]
////export const StatusNumbersCompletionItems: CompletionItem[] = [
////    {
////        label: "0",
////        description: "Success",
////    },
////    {
////        label: "1",
////        description: "Failure",
////    },
////    {
////        label: "121",
////        description: "is generally the exit status of commands if they were supplied with invalid arguments.",
////    },
////    {
////        label: "123",
////        description: "means that the command was not executed because the command name contained invalid characters.",
////    },
////    {
////        label: "124",
////        description: "means that the command was not executed because none of the wildcards in the command produced any matches.",
////    },
////    {
////        label: "125",
////        description: "means that while an executable with the specified name was located, the operating system could not actually execute the command.",
////    },
////    {
////        label: "126",
////        description: "means that while a file with the specified name was located, it was not executable.",
////    },
////    {
////        label: "127",
////        description: "means that no function, builtin or command with the given name could be located.",
////    },
////]
////