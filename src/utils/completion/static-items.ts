import { CompletionItemKind } from 'vscode-languageserver';
import { ErrorCodes } from '../../diagnostics/error-codes';
import { md } from '../markdown-builder';
import { FishCompletionItem, FishCompletionItemKind, CompletionExample } from './types';
import { PrebuiltDocumentationMap } from '../snippets';

const EscapedChars: FishCompletionItem[] = [
  {
    label: '\\a',
    detail: 'alert character',
    documentation: 'escapes the alert character',
  },
  {
    label: '\\b',
    detail: 'backspace character',
    documentation: 'escapes the backspace character',
  },
  {
    label: '\\e',
    detail: 'escape character',
    documentation: 'escapes the escape character',
  },
  {
    label: '\\f',
    detail: 'form feed character',
    documentation: 'escapes the form feed character',
  },
  {
    label: '\\n',
    detail: 'newline character',
    documentation: 'escapes a newline character',
  },
  {
    label: '\\r',
    detail: 'carriage return character',
    documentation: 'escapes the carriage return character',
  },
  {
    label: '\\t',
    detail: 'tab character',
    documentation: 'escapes the tab character',
  },
  {
    label: '\\v',
    detail: 'vertical tab character',
    documentation: 'escapes the vertical tab character',
  },
  {
    label: '\\ ',
    detail: 'space character',
    documentation: 'escapes the space character',
  },
  {
    label: '\\$',
    detail: 'dollar character',
    documentation: 'escapes the dollar character',
  },
  {
    label: '\\\\',
    detail: 'backslash character',
    documentation: 'escapes the backslash character',
  },
  {
    label: '\\*',
    detail: 'star character',
    documentation: 'escapes the star character',
  },
  {
    label: '\\?',
    detail: 'question mark character',
    documentation: 'escapes the question mark character',
  },
  {
    label: '\\~',
    detail: 'tilde character',
    documentation: 'escapes the tilde character',
  },
  {
    label: '\\%',
    detail: 'percent character',
    documentation: 'escapes the percent character',
  },
  {
    label: '\\#',
    detail: 'hash character',
    documentation: 'escapes the hash character',
  },
  {
    label: '\\(',
    detail: 'left parenthesis character',
    documentation: 'escapes the left parenthesis character',
  },
  {
    label: '\\)',
    detail: 'right parenthesis character',
    documentation: 'escapes the right parenthesis character',
  },
  {
    label: '\\{',
    detail: 'left curly bracket character',
    documentation: 'escapes the left curly bracket character',
  },
  {
    label: '\\}',
    detail: 'right curly bracket character',
    documentation: 'escapes the right curly bracket character',
  },
  {
    label: '\\[',
    detail: 'left bracket character',
    documentation: 'escapes the left bracket character',
  },
  {
    label: '\\]',
    detail: 'right bracket character',
    documentation: 'escapes the right bracket character',
  },
  {
    label: '\\<',
    detail: 'less than character',
    documentation: 'escapes the less than character',
  },
  {
    label: '\\>',
    detail: 'greater than character',
    documentation: 'escapes the more than character',
  },
  {
    label: '\\^',
    detail: 'circumflex character',
    documentation: 'escapes the circumflex character',
  },
  {
    label: '\\&',
    detail: 'ampersand character',
    documentation: 'escapes the ampersand character',
  },
  {
    label: '\\;',
    detail: 'semicolon character',
    documentation: 'escapes the semicolon character',
  },
  {
    label: '\\"',
    detail: 'quote character',
    documentation: 'escapes the quote character',
  },
  {
    label: "\\'",
    detail: 'quote character',
    documentation: 'escapes the apostrophe character',
  },
  {
    label: '\\xxx',
    detail: 'hexadecimal character',
    documentation: 'where xx is a hexadecimal number, escapes the ascii character with the specified value. For example, \\x9 is the tab character.',
  },
  {
    label: '\\Xxx',
    detail: 'hexadecimal character',
    documentation: 'where xx is a hexadecimal number, escapes a byte of data with the specified value. If you are using a mutibyte encoding, this can be used to enter invalid strings. Only use this if you know what you are doing.',
  },
  {
    label: '\\ooo',
    detail: 'octal character',
    documentation: 'where ooo is an octal number, escapes the ascii character with the specified value. For example, \\011 is the tab character.',
  },
  {
    label: '\\uxxxx',
    detail: 'unicode character',
    documentation: 'where xxxx is a hexadecimal number, escapes the 16-bit Unicode character with the specified value. For example, \\u9 is the tab character.',
  },
  {
    label: '\\Uxxxxxxxx',
    detail: 'unicode character',
    documentation: 'where xxxxxxxx is a hexadecimal number, escapes the 32-bit Unicode character with the specified value. For example, \\U9 is the tab character.',
  },
  {
    label: '\\cx',
    detail: 'alphabet character',
    documentation: ' where x is a letter of the alphabet, escapes the control sequence generated by pressing the control key and the specified letter. for example, \\ci is the tab character',
  },
] as FishCompletionItem[];

const PrebuiltVars: FishCompletionItem[] = [
  ...PrebuiltDocumentationMap.getByType('variable').map((item) => {
    return {
      label: item.name,
      detail: 'variable',
      kind: CompletionItemKind.Variable,
      documentation: item.description,
      useDocAsDetail: true,
    };
  }) as FishCompletionItem[],
];

const PrebuiltFuncs: FishCompletionItem[] = [
  ...PrebuiltDocumentationMap.getByType('command').map((item) => {
    return {
      label: item.name,
      detail: 'function',
      kind: CompletionItemKind.Function,
      documentation: item.description,
      useDocAsDetail: true,
    };
  }) as FishCompletionItem[],
];

const Pipes: FishCompletionItem[] = [
  {
    label: '<',
    detail: 'READ <SOURCE_FILE',
    insertText: '<',
    documentation: 'To read standard input from a file, use <SOURCE_FILE',
  },
  {
    label: '>',
    detail: 'WRITE >DESTINATION',
    insertText: '>',
    documentation: 'To write standard output to a file, use >DESTINATION',
  },
  {
    label: '2>',
    detail: 'WRITE 2>DESTINATION',
    insertText: '2>',
    documentation: 'To write standard error to a file, use 2>DESTINATION',
  },
  {
    label: '>>',
    detail: 'APPEND >>DESTINATION',
    insertText: '>>',
    documentation: 'To append standard output to a file, use >>DESTINATION',
  },
  {
    label: '2>>',
    detail: 'APPEND 2>>DESTINATION',
    insertText: '2>>',
    documentation: 'To append standard error to a file, use 2>>DESTINATION',
  },
  {
    label: '>?',
    detail: 'NOCLOBBER >? DESTINATION',
    insertText: '>?',
    documentation: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
  },
  {
    label: '1>?',
    detail: 'NOCLOBBER 1>?DESTINATION',
    insertText: '1>?',
    documentation: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
  },
  {
    label: '2>?',
    detail: 'NOCLOBBER 2>?DESTINATION',
    insertText: '2>?',
    documentation: 'To not overwrite (“clobber”) an existing file, use >?DESTINATION or 2>?DESTINATION. This is known as the “noclobber” redirection.',
  },
  {
    label: '&-',
    detail: 'CLOSE &-',
    insertText: '&-',
    documentation: 'An ampersand followed by a minus sign (&-). The file descriptor will be closed.',
  },
  {
    label: '|',
    detail: 'OUTPUT | INPUT',
    insertText: '|',
    documentation: 'Pipe one stream with another. Usually standard output of one command will be piped to standard input of another. OUTPUT | INPUT',
  },
  {
    label: '&',
    detail: 'DISOWN &',
    insertText: '&',
    documentation: 'Disown output . OUTPUT &',
  },
  {
    label: '&>',
    detail: 'STDOUT_AND_STDERR &>',
    insertText: '&>',
    documentation: 'the redirection &> can be used to direct both stdout and stderr to the same destination',
  },
  {
    label: '&|',
    detail: 'STDOUT_AND_STDERR &|',
    insertText: '&|',
    documentation: 'the redirection &| can be used to direct both stdout and stderr to the same destination',
  },
] as FishCompletionItem[];

const StatusNumbers: FishCompletionItem[] = [
  {
    label: '0',
    detail: 'Status Success',
    documentation: 'Success exit status, generally means that the command executed successfully.',
    examples: [
      CompletionExample.create('An implementation of the true command as a fish function:',
        'function true',
        '    return 0',
        'end',
      ),
      CompletionExample.create('Using true in an if statement',
        'if true',
        '    echo "This will be printed"',
        'end',
        'if !true',
        '    echo "This will not be printed"',
        'end',
      ),
    ],
  },
  {
    label: '1',
    detail: 'Status Failure',
    documentation: 'Failure exit status, generally means that the command executed with an Error.',
    examples: [
      CompletionExample.create('An implementation of the false command as a fish function:',
        'function false',
        '    return 1',
        'end',
      ),
      CompletionExample.create('Using false in an if statement',
        'if false',
        '    echo "This will not be printed"',
        'end',
        'if !false',
        '    echo "This will be printed"',
        'end',
      ),
    ],
  },
  {
    label: '2',
    detail: 'Status Misuse',
    documentation: 'Misuse exit status, generally means that the command was used incorrectly.',
    examples: [
      CompletionExample.create('as seen from the ls manpage:',
        'ls /directory/nonexistent',
        'echo $status      # prints "2"',
      ),
    ],
  },
  {
    label: '121',
    detail: 'Status Invalid Arguments',
    documentation: 'is generally the exit status of commands if they were supplied with invalid arguments.',
  },
  {
    label: '123',
    detail: 'Status Invalid Command',
    documentation: 'means that the command was not executed because the command name contained invalid characters.',
  },
  {
    label: '124',
    detail: 'Status No Matches',
    documentation: 'means that the command was not executed because none of the wildcards in the command produced any matches.',
  },
  {
    label: '125',
    detail: 'Status Invalid Privileges',
    documentation: 'means that while an executable with the specified name was located, the operating system could not actually execute the command.',
  },
  {
    label: '126',
    detail: 'Status Not Executable',
    documentation: 'means that while a file with the specified name was located, it was not executable.',
  },
  {
    label: '127',
    detail: 'Status Not Found',
    documentation: 'means that no function, builtin or command with the given name could be located.',
  },
] as FishCompletionItem[];

const StringRegex: FishCompletionItem[] = [
  {
    label: '*',
    detail: '0 >= MATCHES',
    documentation: 'refers to 0 or more repetitions of the previous expression',
    insertText: '*',
    insertTextFormat: 1,
    examples: [],
  },
  {
    label: '^',
    detail: 'START of string',
    documentation: '^ is the start of the string or line, $ the end',
    insertText: '^',
  },
  {
    label: '$',
    detail: 'END of string',
    documentation: '$ the end of string or line',
    insertText: '$',
  },
  {
    label: '+',
    detail: '1 >= MATCHES',
    documentation: '1 or more',
    insertText: '+',
    insertTextFormat: 1,
    examples: [],
  },
  {
    label: '?',
    detail: '0 or 1 MATCHES',
    documentation: '0 or 1.',
    insertText: '?',
    examples: [],
  },
  {
    label: '{n}',
    detail: 'exactly n MATCHES',
    documentation: 'to exactly n (where n is a number)',
    insertText: '{n}',
    examples: [],
  },
  {
    label: '{n,m}',
    detail: 'n <= MATCHES <= m',
    documentation: 'at least n, no more than m.',
    insertText: '{${1:n},${2:m}}',
    examples: [],
  },

  {
    label: '{n,}',
    detail: 'n >= MATCHES',
    documentation: 'n or more',
    insertText: '{${1:number},}',
    insertTextFormat: 2,
    examples: [],
  },
  {
    label: '.',
    detail: 'Alpha-numeric Character',
    documentation: "'.' any character except newline",
    insertText: '.',
    examples: [],
  },
  {
    label: '\\d a decimal digit',
    detail: 'Decimal Character',
    documentation: '\\d a decimal digit and \\D, not a decimal digit',
    insertText: '\\d',
    examples: [],
  },
  {
    label: '\\D not a decimal digit',
    detail: 'Not a Decimal Character',
    documentation: '\\d a decimal digit and \\D, not a decimal digit',
    insertText: '\\D',
    examples: [],
  },
  {
    label: '\\s whitespace',
    detail: 'Whitespace Character',
    documentation: 'whitespace and \\S, not whitespace ',
    insertText: '\\s',
    examples: [],
  },
  {
    label: '\\S not whitespace',
    detail: 'Not a Whitespace Character',
    documentation: '\\S, not whitespace and \\s whitespace',
    insertText: '\\S',
    examples: [],
  },
  {
    label: '\\w a “word” character',
    detail: 'Word Character',
    documentation: '\\w a “word” character and \\W, a “non-word” character ',
    insertText: '\\w',
  },
  {
    label: '\\W a “non-word” character',
    detail: 'Non-Word Character',
    documentation: 'a “non-word” character ',
    insertText: '\\W',
  },
  {
    label: '[...] a character set',
    detail: 'Character Set',
    documentation:
      '[...] - (where “…” is some characters) is a character set ',
    insertText: '[...]',
  },
  {
    label: '[^...]',
    detail: 'Inverse Character Set',
    documentation: '[^...] is the inverse of the given character set',
    insertText: '[^...]',
  },

  {
    label: '[x-y] the range of characters from x-y',
    detail: 'Range of Characters',
    documentation: '[x-y] is the range of characters from x-y',
    insertText: '[x-y]',
  },

  {
    label: '[[:xxx:]]',
    detail: 'Named Character Set',
    documentation: '[[:xxx:]] is a named character set',
    insertText: '[[:xxx:]]',
  },

  {
    label: '[[:^xxx:]]',
    detail: 'Inverse Named Character Set',
    documentation: '[[:^xxx:]] is the inverse of a named character set',
    insertText: '[[:^xxx:]]',
  },

  {
    label: '[[:alnum:]]',
    detail: 'Alphanumeric Character',
    documentation: '[[:alnum:]] : “alphanumeric”',
    insertText: '[[:alnum:]]',
  },

  {
    label: '[[:alpha:]]',
    detail: 'Alphabetic Character',
    documentation: '[[:alpha:]] : “alphabetic”',
    insertText: '[[:alpha:]]',
  },

  {
    label: '[[:ascii:]]',
    detail: 'ASCII Character',
    documentation: '[[:ascii:]] : “0-127”',
    insertText: '[[:ascii:]]',
  },

  {
    label: '[[:blank:]]',
    detail: 'Space or Tab',
    documentation: '[[:blank:]] : “space or tab”',
    insertText: '[[:blank:]]',
  },

  {
    label: '[[:cntrl:]]',
    detail: 'Control Character',
    documentation: '[[:cntrl:]] : “control character”',
    insertText: '[[:cntrl:]]',
  },

  {
    label: '[[:digit:]]',
    detail: 'Decimal Digit',
    documentation: '[[:digit:]] : “decimal digit”',
    insertText: '[[:digit:]]',
  },

  {
    label: '[[:graph:]]',
    detail: 'Printing Character',
    documentation: '[[:graph:]] : “printing, excluding space”',
    insertText: '[[:graph:]]',
  },

  {
    label: '[[:lower:]]',
    detail: 'Lower Case Letter',
    documentation: '[[:lower:]] : “lower case letter”',
    insertText: '[[:lower:]]',
  },

  {
    label: '[[:print:]]',
    detail: 'Printing Character',
    documentation: '[[:print:]] : “printing, including space”',
    insertText: '[[:print:]]',
  },

  {
    label: '[[:punct:]]',
    detail: 'Punctuation Character',
    documentation: '[[:punct:]] : “printing, excluding alphanumeric”',
    insertText: '[[:punct:]]',
  },

  {
    label: '[[:space:]]',
    detail: 'White Space Character',
    documentation: '[[:space:]] : “white space”',
    insertText: '[[:space:]]',
  },

  {
    label: '[[:upper:]]',
    detail: 'Upper Case Letter',
    documentation: '[[:upper:]] : “upper case letter”',
    insertText: '[[:upper:]]',
  },

  {
    label: '[[:word:]]',
    detail: 'Word Character',
    documentation: '[[:word:]] : “same as w”',
    insertText: '[[:word:]]',
  },
  {
    label: '[[:xdigit:]]',
    detail: 'Hexadecimal Digit',
    documentation: '[[:xdigit:]] : “hexadecimal digit”',
    insertText: '[[:xdigit:]]',
  },
  {
    label: '(...)',
    detail: 'Capturing Group',
    documentation: '(...) is a capturing group',
    insertText: '(...)',
  },
  {
    label: '(?:...) is a non-capturing group',
    detail: 'Non-Capturing Group',
    documentation: '(?:...) is a non-capturing group',
    insertText: '(?:...)',
  },
  {
    label: '\\n',
    detail: 'Backreference',
    documentation: '\\n is a backreference (where n is the number of the group, starting with 1)',
    insertText: '\\',
  },
  {
    label: '$n',
    detail: 'Reference',
    documentation:
      '$n is a reference from the replacement expression to a group in the match expression.',
    insertText: '$',
  },
  {
    label: '\\b',
    detail: 'Word Boundary',
    documentation: '\\b denotes a word boundary, \\B is not a word boundary.',
    insertText: '\\b',
  },
  {
    label: '|',
    detail: 'Alternation',
    documentation: '| is “alternation”, i.e. the “or”.',
    insertText: '|',
  },
] as FishCompletionItem[];

const FormatStrings: FishCompletionItem[] = [
  {
    label: '%d',
    detail: 'Decimal Integer',
    documentation: 'Argument will be used as decimal integer (signed or unsigned)',
  },
  {
    label: '%i',
    detail: 'Decimal Integer',
    documentation: 'Argument will be used as decimal integer (signed or unsigned)',
  },
  {
    label: '%o',
    detail: 'Octal Integer',
    documentation: 'An octal unsigned integer',
  },
  {
    label: '%u',
    detail: 'Unsigned Integer',
    documentation: 'An unsigned decimal integer - this means negative numbers will wrap around',
  },
  {
    label: '%x',
    detail: 'Hexadecimal Integer',
    documentation: 'An unsigned hexadecimal integer',
  },
  {
    label: '%X',
    detail: 'Hexadecimal Integer',
    documentation: 'An unsigned hexadecimal integer',
  },
  {
    label: '%f',
    detail: 'Floating Point',
    documentation: 'A floating-point number. %f defaults to 6 places after the decimal point (which is  locale-dependent  - e.g. in de_DE it will be a ,).',
  },
  {
    label: '%g',
    detail: 'Floating Point',
    documentation: 'will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.',
  },
  {
    label: '%G',
    detail: 'Floating Point',
    documentation: 'will trim trailing zeroes and switch to scientific notation (like %e) if the numbers get small or large enough.',
  },
  {
    label: '%s',
    detail: 'String',
    documentation: 'A string',
  },
  {
    label: '%b',
    detail: 'Word Boundary',
    documentation: 'As a string, interpreting backslash escapes, except that octal escapes are of the  form  0 or 0ooo.',
  },
  {
    label: '%%',
    detail: 'Literal Percent',
    documentation: 'Signifies a literal "%"',
  },
] as FishCompletionItem[];

const Combiners: FishCompletionItem[] = [
  {
    label: 'and',
    detail: 'and CONDITION; COMMANDS; end',
    documentation: 'is a combiner that combines two commands with a logical and. The second command is only executed if the first command returns true.',
  },
  {
    label: 'or',
    detail: 'or CONDITION; COMMANDS; end',
    documentation: 'is a combiner that combines two commands with a logical or. The second command is only executed if the first command returns false.',
  },
  {
    label: 'not',
    detail: 'not CONDITION; COMMANDS; end',
    documentation: 'not negates the exit status of another command. If the exit status is zero, not returns 1. Otherwise, not returns 0.',
  },
  {
    label: '||',
    detail: '|| CONDITION; COMMANDS; end',
    documentation: 'is a combiner that combines two commands with a logical or. The second command is only executed if the first command returns false.',
  },
  {
    label: '&&',
    detail: '&& CONDITION; COMMANDS; end',
    documentation: 'is a combiner that combines two commands with a logical and. The second command is only executed if the first command returns true.',
  },
  {
    label: '!',
    detail: '! CONDITION; COMMANDS; end',
    documentation: 'not  negates the exit status of another command. If the exit status is zero, not returns 1. Otherwise, not returns 0.',
  },
] as FishCompletionItem[];

const Statements: FishCompletionItem[] = [
  {
    label: 'if',
    detail: 'if CONDITION; COMMANDS; end',
    documentation: 'if is a conditional statement that executes a command if a condition is true.',
  },
  {
    label: 'else if',
    detail: 'else if CONDITION; COMMANDS; end',
    documentation: 'else if is a conditional statement that executes a command if a condition is true.',
  },
  {
    label: 'else',
    detail: 'else; COMMANDS; end',
    documentation: 'else is a conditional statement that executes a command if a condition is true.',
  },
  {
    label: 'switch',
    detail: 'switch CONDITION; case VALUE; COMMANDS; end; end',
    documentation: 'switch is a conditional statement that executes a command if a condition is true.',
  },
  {
    label: 'while',
    detail: 'while CONDITION; COMMANDS; end',
    documentation: 'while is a conditional statement that executes a command if a condition is true. (Works like a repeated "if" statement)',
  },
] as FishCompletionItem[];

const shebangs = [
  {
    label: '#!/usr/bin/env fish',
    fishKind: 'shebang',
    detail: 'execute script using fish env',
    documentation: 'execute script using fish env',
  },
  {
    label: '#!/usr/local/bin/fish',
    fishKind: 'shebang',
    detail: '#!/usr/local/bin/fish',
    documentation: 'Check this path exists. Could be /usr/bin/fish, /usr/local/bin/fish, or /bin/fish',
  },
  {
    label: '#!/usr/bin/fish',
    fishKind: 'shebang',
    detail: '#!/usr/bin/fish',
    documentation: 'Check this path exists. Could be /usr/bin/fish, /usr/local/bin/fish, or /bin/fish',
  },
  {
    label: '#!/bin/fish',
    fishKind: 'shebang',
    detail: '#!/bin/fish',
    documentation: 'Check this path exists. Could be /usr/bin/fish, /usr/local/bin/fish, or /bin/fish',
  },
] as FishCompletionItem[];

const disableDiagnostics = Object.values(ErrorCodes.codes).map((diagnostic) => {
  return {
    label: `${diagnostic.code}`,
    detail: diagnostic.message,
    useDocAsDetail: true,
    documentation: [
      `# Error code: ${diagnostic.code}`,
      md.separator(),
      `${diagnostic.message}`,
      md.separator(),
      `DIAGNOSTIC LEVEL: ${ErrorCodes.getSeverityString(diagnostic.severity)}`,
    ].join('\n'),
    insertText: `${diagnostic.code}`,
  };
}) as FishCompletionItem[];

const comments = [
  {
    label: '# @fish-lsp-disable',
    detail: 'Disable all LSP diagnostics for this file',
    fishKind: FishCompletionItemKind.COMMENT,
    documentation: [
      '# Disable all LSP diagnostics for this file',
      md.separator(),
      'This directive will disable all diagnostics for this file. This is useful when you want to ignore all diagnostics for a file.',
      '___',
      '```fish',
      '# @fish-lsp-disable',
      'alias ls "ls -l" # no more warnings',
      '```',
      '```fish',
      '# @fish-lsp-disable 2002',
      'alias ls="ls -l" # no more warnings',
      '# @fish-lsp-enable',
      'alias ls="ls -l" # warnings enabled again',
      '```',
    ].join('\n'),
  },
  {
    label: '# @fish-lsp-enable',
    detail: 'Enable all LSP diagnostics for this file',
    kind: CompletionItemKind.Enum,
    fishKind: FishCompletionItemKind.COMMENT,
    documentation: [
      '# Enables all LSP diagnostics for this file',
      md.separator(),
      'This directive will enable all diagnostics for this file. This is useful when you want to turn diagnostics on & off in sections.',
      '___',
      '```fish',
      '# @fish-lsp-disable',
      'alias ls "ls -l" # no more warnings',
      '```',
      '```fish',
      '# @fish-lsp-disable 2002',
      'alias ls="ls -l" # no more warnings',
      '# @fish-lsp-enable',
      'alias ls="ls -l" # warnings enabled again',
      '```',
    ].join('\n'),
  },
  {
    label: '# @fish-lsp-disable-next-line',
    detail: 'Disables all LSP diagnostics for the next line',
    fishKind: FishCompletionItemKind.COMMENT,
    documentation: [
      '# Disables LSP diagnostics for the next line.',
      md.separator(),
      ' Any enabled diagnostics inside the file, before this comment will be enabled again after this line.',
      '___',
      '```fish',
      '# @fish-lsp-disable-next-line',
      'alias ls "ls -a" # no more warnings',
      '```',
      '```fish',
      '# @fish-lsp-disable-next-line 2002',
      'alias ls="ls -1" # no more warnings',
      'alias lsl="ls -l" # warnings enabled again',
      '```',
    ].join('\n'),
  },
  {
    label: '# @fish-lsp-enable-next-line',
    detail: 'Enable LSP diagnostics for next line',
    fishKind: FishCompletionItemKind.COMMENT,
    documentation: [
      '# Enables LSP diagnostics for next line',
      md.separator(),
      'This directive will enable all diagnostics for the next line.',
      '___',
      '```fish',
      '# @fish-lsp-disable',
      'alias ls "ls -a" # warnings are disabled in this file',

      '# @fish-lsp-enable-next-line',
      'alias lsl="ls -l" # warnings temporarily enabled again',

      'alias lss "ls -s" # no more warnings again',
      '```',
    ].join('\n'),
  },
] as FishCompletionItem[];

export const StaticItems = {
  [FishCompletionItemKind.ESC_CHARS]: EscapedChars,
  [FishCompletionItemKind.PIPE]: Pipes,
  [FishCompletionItemKind.STATUS]: StatusNumbers,
  [FishCompletionItemKind.REGEX]: StringRegex,
  [FishCompletionItemKind.FORMAT_STR]: FormatStrings,
  [FishCompletionItemKind.COMBINER]: Combiners,
  [FishCompletionItemKind.STATEMENT]: Statements,
  [FishCompletionItemKind.SHEBANG]: shebangs,
  [FishCompletionItemKind.COMMENT]: comments,
  [FishCompletionItemKind.DIAGNOSTIC]: disableDiagnostics,
  [FishCompletionItemKind.VARIABLE]: PrebuiltVars,
  [FishCompletionItemKind.FUNCTION]: PrebuiltFuncs,
};
