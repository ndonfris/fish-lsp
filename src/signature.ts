import {
  MarkupContent,
  SignatureHelp,
  SignatureInformation,
  SignatureHelpParams,
  Command,
} from 'vscode-languageserver';
//import { FishCompletionItemKind } from './utils/completion-strategy';
//import { stringRegexExpressions} from './utils/completion-types';
import { isBuiltin } from './utils/builtins';

function regexStringSignature() : SignatureInformation {
  //const regexItems = stringRegexExpressions;
  //let signatureDoc = ["__String Regex Patterns__", "---"];
  //for (const item of regexItems) {
  //    signatureDoc.push(`${item.label}  {item.description}`)
  //}
  const signatureDoc: MarkupContent = {
    kind: 'markdown',
    value: [
      markdownStringRepetitions,
      markdownStringCharClasses,
      markdownStringGroups,
    ].join('\n---\n'),
  };
  return {
    label: 'Regex Patterns',
    documentation: signatureDoc,
  };
}

function regexStringCharacterSets(): SignatureInformation {
  return {
    label: 'Regex Groups',
    documentation: {
      kind: 'markdown',
      value: markdownStringCharacterSets,
    } as MarkupContent,
  };
}

type signatureType = 'stringRegexPatterns' | 'stringRegexCharacterSets';

export const signatureIndex: {[str in signatureType]: number} = {
  stringRegexPatterns: 0,
  stringRegexCharacterSets: 1,
};

export function getDefaultSignatures() : SignatureHelp {
  return {
    activeParameter: 0,
    activeSignature: 0,
    signatures: [
      regexStringSignature(),
      regexStringCharacterSets(),
    ],
  };
}

// REGEX STRING LINES
const markdownStringRepetitions = [
  'Repetitions',
  '-----------',
  '- __*__ refers to 0 or more repetitions of the previous expression',
  '- __+__ 1 or more',
  '- __?__ 0 or 1.',
  '- __{n}__ to exactly n (where n is a number)',
  '- __{n,m}__ at least n, no more than m.',
  '- __{n,}__ n or more',
].join('\n');

const markdownStringCharClasses = [
  'Character Classes',
  '-----------------',
  '- __.__ any character except newline',
  '- __\\d__ a decimal digit and __\\D__, not a decimal digit',
  '- __\\s__ whitespace and __\\S__, not whitespace',
  '- __\\w__ a “word” character and __\\W__, a “non-word” character',
  '- __\\b__ a “word” boundary, and __\\B__, not a word boundary',
  '- __[...]__ (where “…” is some characters) is a character set',
  '- __[^...]__ is the inverse of the given character set',
  '- __[x-y]__ is the range of characters from x-y',
  '- __[[:xxx:]]__ is a named character set',
  '- __[[:^xxx:]]__ is the inverse of a named character set',
].join('\n');

const markdownStringCharacterSets = [
  '__[[:alnum:]]__ : “alphanumeric”',
  '__[[:alpha:]]__ : “alphabetic”',
  '__[[:ascii:]]__ : “0-127”',
  '__[[:blank:]]__ : “space or tab”',
  '__[[:cntrl:]]__ : “control character”',
  '__[[:digit:]]__ : “decimal digit”',
  '__[[:graph:]]__ : “printing, excluding space”',
  '__[[:lower:]]__ : “lower case letter”',
  '__[[:print:]]__ : “printing, including space”',
  '__[[:punct:]]__ : “printing, excluding alphanumeric”',
  '__[[:space:]]__ : “white space”',
  '__[[:upper:]]__ : “upper case letter”',
  '__[[:word:]]__ : “same as w”',
  '__[[:xdigit:]]__ : “hexadecimal digit”',
].join('\n');

const markdownStringGroups = [
  'Groups',
  '------',
  '- __(...)__ is a capturing group',
  '- __(?:...)__ is a non-capturing group',
  '- __\\n__ is a backreference (where n is the number of the group, starting with 1)',
  '- __$n__ is a reference from the replacement expression to a group in the match expression.',
].join('\n');
