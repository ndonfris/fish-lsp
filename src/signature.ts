import {
  MarkupContent,
  SignatureHelp,
  SignatureInformation,
  SignatureHelpParams,
  Command,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { ExtendedBaseJson, PrebuiltDocumentationMap } from './utils/snippets';
import { FishAliasCompletionItem } from './utils/completion/types';
import * as NodeTypes from './utils/node-types';
import * as TreeSitter from './utils/tree-sitter';
import { CompletionItemMap } from './utils/completion/startup-cache';

export function buildSignature(label: string, value: string) : SignatureInformation {
  return {
    label: label,
    documentation: {
      kind: 'markdown',
      value: value,
    },
  };
}

export function getCurrentNodeType(input: string) {
  const prebuiltTypes = PrebuiltDocumentationMap.getByName(input);
  if (!prebuiltTypes || prebuiltTypes.length === 0) {
    return null;
  }
  let longestDocs = prebuiltTypes[0]!;
  for (const prebuilt of prebuiltTypes) {
    if (prebuilt.description.length > longestDocs.description.length) {
      longestDocs = prebuilt;
    }
  }
  return longestDocs;
}

export function lineSignatureBuilder(lineRootNode: SyntaxNode, lineCurrentNode: SyntaxNode, completeMmap: CompletionItemMap): SignatureHelp | null {
  const currentCmd = NodeTypes.findParentCommand(lineCurrentNode) || lineRootNode;
  const pipes = getPipes(lineRootNode);
  const varNode = getVariableNode(lineRootNode);
  const allCmds = getAllCommands(lineRootNode);
  const regexOption = getRegexOption(lineRootNode);

  if (pipes.length === 1) return getPipesSignature(pipes);

  switch (true) {
    case isStringWithRegex(currentCmd.text, regexOption):
      return getDefaultSignatures();

    case varNode && isSetOrReadWithVarNode(currentCmd?.text || lineRootNode.text, varNode, lineRootNode, allCmds):
      return getSignatureForVariable(varNode);

    case currentCmd?.text.startsWith('return') || lineRootNode.text.startsWith('return'):
      return getReturnStatusSignature();

    case allCmds.length === 1:
      return getCommandSignature(currentCmd);

    default:
      return null;
  }
}

export function getPipes(rootNode: SyntaxNode): ExtendedBaseJson[] {
  const pipeNames = PrebuiltDocumentationMap.getByType('pipe');
  return TreeSitter.getChildNodes(rootNode).reduce((acc: ExtendedBaseJson[], node) => {
    const pipe = pipeNames.find(p => p.name === node.text);
    if (pipe) acc.push(pipe);
    return acc;
  }, []);
}

function getVariableNode(rootNode: SyntaxNode): SyntaxNode | undefined {
  return TreeSitter.getChildNodes(rootNode).find(c => NodeTypes.isVariableDefinition(c));
}

function getAllCommands(rootNode: SyntaxNode): SyntaxNode[] {
  return TreeSitter.getChildNodes(rootNode).filter(c => NodeTypes.isCommand(c));
}

function getRegexOption(rootNode: SyntaxNode): SyntaxNode | undefined {
  return TreeSitter.getChildNodes(rootNode).find(n => NodeTypes.isMatchingOption(n, { shortOption: '-r', longOption: '--regex' }));
}

function isStringWithRegex(line: string, regexOption: SyntaxNode | undefined): boolean {
  return line.startsWith('string') && !!regexOption;
}

function isSetOrReadWithVarNode(line: string, varNode: SyntaxNode | undefined, rootNode: SyntaxNode, allCmds: SyntaxNode[]): boolean {
  return !!varNode && (line.startsWith('set') || line.startsWith('read')) && allCmds.pop()?.text === rootNode.text.trim();
}

function getSignatureForVariable(varNode: SyntaxNode): SignatureHelp | null {
  const output = getCurrentNodeType(varNode.text);
  if (!output) return null;
  return {
    signatures: [buildSignature(output.name, output.description)],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getReturnStatusSignature(): SignatureHelp {
  const output = PrebuiltDocumentationMap.getByType('status').map((o: ExtendedBaseJson) => `___${o.name}___ - _${o.description}_`).join('\n');
  return {
    signatures: [buildSignature('$status', output)],
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getPipesSignature(pipes: ExtendedBaseJson[]): SignatureHelp {
  return {
    signatures: pipes.map((o: ExtendedBaseJson) => buildSignature(o.name, `${o.name} - _${o.description}_`)),
    activeSignature: 0,
    activeParameter: 0,
  };
}

function getCommandSignature(firstCmd: SyntaxNode): SignatureHelp {
  const output = PrebuiltDocumentationMap.getByType('command').filter(n => n.name === firstCmd.text);
  return {
    signatures: [buildSignature(firstCmd.text, output.map((o: ExtendedBaseJson) => `${o.name} - _${o.description}_`).join('\n'))],
    activeSignature: 0,
    activeParameter: 0,
  };
}

export function getAliasedCompletionItemSignature(item: FishAliasCompletionItem): SignatureHelp {
  // const output = PrebuiltDocumentationMap.getByType('command').filter(n => n.name === firstCmd.text);
  return {
    signatures: [buildSignature(item.label, [
      '```fish',
      `${item.fishKind} ${item.label} ${item.detail}`,
      '```',
    ].join('\n'))],
    activeSignature: 0,
    activeParameter: 0,
  };
}

export function regexStringSignature() : SignatureInformation {
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
