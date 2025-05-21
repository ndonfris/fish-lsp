import {
  MarkupContent,
  MarkupKind,
  ParameterInformation,
  Position,
  SignatureHelp,
  SignatureInformation,
  SymbolKind,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { ExtendedBaseJson, PrebuiltDocumentationMap } from './utils/snippets';
import { FishAliasCompletionItem } from './utils/completion/types';
import * as NodeTypes from './utils/node-types';
import * as TreeSitter from './utils/tree-sitter';
import { CompletionItemMap } from './utils/completion/startup-cache';
import { Option } from './parsing/options';
import { Analyzer } from './analyze';
import { md } from './utils/markdown-builder';
import { symbolKindToString } from './utils/translation';

export function buildSignature(label: string, value: string): SignatureInformation {
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

export function lineSignatureBuilder(lineRootNode: SyntaxNode, lineCurrentNode: SyntaxNode, _completeMmap: CompletionItemMap): SignatureHelp | null {
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
  return TreeSitter.getChildNodes(rootNode).find(n => NodeTypes.isMatchingOption(n, Option.create('-r', '--regex')));
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

export function regexStringSignature(): SignatureInformation {
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
  const inputText: string = [
    markdownStringRepetitions,
    markdownStringCharClasses,
    markdownStringGroups,
  ].join('\n---\n');
  const parameters: ParameterInformation[] = [
    ParameterInformation.create('argv[1]', inputText),
    ParameterInformation.create('argv[2]', inputText),
  ];
  return {
    label: 'Regex Groups',
    documentation: {
      kind: 'markdown',
      value: markdownStringCharacterSets,
    } as MarkupContent,
    parameters: parameters,
    activeParameter: 0,
  };
}
/**
 * Checks if a flag matches either a short flag (-r) or a long flag (--regex)
 * For short flags, it will check if the flag is part of a combined flag string (-re)
 *
 * @param text The text to check
 * @param shortFlag The short flag to check for (e.g. 'r')
 * @param longFlag The long flag to check for (e.g. 'regex')
 * @returns true if the text matches either the short or long flag
 */
export function isMatchingOption(
  text: string,
  options: { shortOption?: string; longOption?: string; },
): boolean {
  // Early return if text doesn't start with a dash
  if (!text.startsWith('-')) return false;

  // Handle long options (--option)
  if (text.startsWith('--') && options.longOption) {
    // Remove any equals sign and following text (--option=value)
    const cleanText = text.includes('=') ? text.slice(0, text.indexOf('=')) : text;
    return cleanText === `--${options.longOption}`;
  }

  // Handle short options (-o)
  if (text.startsWith('-') && options.shortOption) {
    // Check if the short option is included in the characters after the dash
    // This handles combined flags like -abc where we want to check for 'a'
    return text.slice(1).includes(options.shortOption);
  }

  return false;
}

/**
 * Determines the active parameter index based on cursor position
 *
 * @param line The complete command line
 * @param commandName The name of the command
 * @param cursorPosition The position of the cursor in the line
 * @returns The index of the active parameter
 */
export function getActiveParameterIndex(line: string, commandName: string, needsSubcommand: boolean, cursorPosition: number): number {
  // Split the line into tokens
  const tokens = line.trim().split(/\s+/);
  let currentPosition = 0;
  let paramIndex = 0;
  const commands = commandName.split(' ');
  let previousWasCommand = false;
  for (const token of tokens) {
    if (commands.includes(token) || ['if', 'else if', 'switch', 'case'].includes(token)) {
      // Skip the command name
      cursorPosition += token.length + 1; // +1 for the space
      previousWasCommand = true;
      continue;
    }
    // Skip the subcommand
    if (needsSubcommand && previousWasCommand) {
      cursorPosition += token.length + 1; // +1 for the space
      previousWasCommand = false;
      continue;
    }
    break;
  }

  // Find which parameter the cursor is in
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Check if cursor is before this token
    if (currentPosition + token!.length >= cursorPosition) {
      break;
    }

    // If token is a flag, it's not a parameter
    if (token!.startsWith('-')) {
      // Skip flag parameter if it's a value flag
      if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) {
        i++; // Skip the value
        currentPosition += tokens[i]!.length + 1;
      }
    } else {
      // This is a parameter
      paramIndex++;
    }

    currentPosition += token!.length + 1; // +1 for the space
  }

  return paramIndex;
}

/**
 * Check if the input line is a string command with regex option
 */
export function isRegexStringSignature(line: string): boolean {
  const tokens = line.split(' ');
  const hasStringCommand = tokens.some(token => token === 'string') && !tokens.some(token => token === '--');

  if (hasStringCommand) {
    return tokens.some(token =>
      isMatchingOption(token, {
        shortOption: 'r',
        longOption: 'regex',
      }),
    );
  }

  return false;
}

export function findActiveParameterStringRegex(
  line: string,
  cursorPosition: number,
): {
  isRegex: boolean;
  activeParameter: number;
} {
  const tokens = line.split(' ');
  const hasStringCommand = tokens.some(token => token === 'string');

  const isRegex = hasStringCommand && tokens.some(token =>
    isMatchingOption(token, {
      shortOption: 'r',
      longOption: 'regex',
    }),
  );

  const activeParameter = isRegex ? getActiveParameterIndex(line, 'string ', true, cursorPosition) : 0;
  return { isRegex, activeParameter };
}
type signatureType = 'stringRegexPatterns' | 'stringRegexCharacterSets';

export const signatureIndex: { [str in signatureType]: number } = {
  stringRegexPatterns: 0,
  stringRegexCharacterSets: 1,
};

export function getDefaultSignatures(): SignatureHelp {
  return {
    activeParameter: 0,
    activeSignature: 0,
    signatures: [
      regexStringSignature(),
      regexStringCharacterSets(),
    ],
  };
}

/**
 * Creates a signature help for a function
 *
 * @param analyzer The analyzer instance
 * @param lineLastNode The last node in the current line
 * @param line The current line text
 * @param position The cursor position
 * @returns A SignatureHelp object or null
 */
export function getFunctionSignatureHelp(
  analyzer: Analyzer,
  lineLastNode: SyntaxNode,
  line: string,
  position: Position,
): SignatureHelp | null {
  // Find the function symbol based on the node's parent's first named child
  const functionName = lineLastNode.parent?.firstNamedChild?.text.trim();
  if (!functionName) return null;

  const funcSymbol = analyzer.findSymbol((symbol, _) => symbol.name === functionName);
  if (!funcSymbol || funcSymbol.kind !== SymbolKind.Function) return null;

  // Get all parameter names, filtering out non-function variables
  const paramNames = funcSymbol.children
    .filter(s => s.fishKind === 'FUNCTION_VARIABLE' && s.name !== 'argv');

  // Add argv as the last parameter if it exists
  const argvParam = funcSymbol.children
    .find(s => s.fishKind === 'FUNCTION_VARIABLE' && s.name === 'argv');
  if (argvParam) {
    paramNames.push(argvParam);
  }

  // Create parameter information for each parameter
  const paramDocs: ParameterInformation[] = paramNames.map((p, idx) => {
    const markdownString = p.toMarkupContent().value.split(md.separator());
    // set the labels for `argv` to be `$argv[1..-1]` and the rest to be `$argv[1]`
    const label = p.name === 'argv'
      ? `$${p.name}[${idx + 1}..-1]`
      : p.name;
    // set the documentation to be the first line of the markdown string
    const newContentString = p.name === 'argv'
      ? [
        '',
        `${md.bold(`(${symbolKindToString(p.kind)})`)} ${label}`,
        md.separator(),
        `This parameter corresponds to ${md.inlineCode(`$argv[${idx + 1}..-1]`)} in the function.`,
        '',
      ].join(md.newline())
      : [
        '',
        `${md.bold(`(${symbolKindToString(p.kind)})`)} ${md.inlineCode(p.name)}`,
        md.separator(),
        `This parameter corresponds to ${md.inlineCode(`$argv[${idx + 1}]`)} in the function.`,
        '',
      ].join(md.newline());
    // set the documentation
    const newValue = p.name === 'argv'
      ? [
        newContentString,
      ].join(md.separator())
      : [
        newContentString,
        markdownString.slice(3, 4),
      ].join(md.separator());
    // set content
    const newContent = {
      kind: MarkupKind.Markdown,
      value: newValue,
    };
    return {
      label: label,
      documentation: newContent,
    };
  });

  // Create the signature label with the function name and parameter names
  const label = `${funcSymbol.name} ${paramDocs.map(p => p.label).join(' ')}`.trim();

  // Create the signature information
  const signature = SignatureInformation.create(
    label,
    funcSymbol.detail,
    ...paramDocs,
  );
  signature.documentation = {
    kind: MarkupKind.Markdown,
    value: funcSymbol.detail || 'No documentation available',
  };

  // Calculate the active parameter based on cursor position
  const activeParameter = calculateActiveParameter(line, position) - 1;

  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter: Math.min(activeParameter, paramNames.length - 1),
  };
}

/**
 * Calculates which parameter the cursor is currently on
 *
 * @param line The current line text
 * @param position The cursor position
 * @returns The index of the active parameter
 */
function calculateActiveParameter(line: string, position: Position): number {
  const textBeforeCursor = line.substring(0, position.character);
  const tokens = textBeforeCursor.trim().split(/\s+/);

  // First token is the function name, so we start at 0 (first parameter)
  // and count parameters (non-flag arguments)
  let paramCount = 0;

  // Skip the first token (function name)
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    // Skip flags and their values
    if (token?.startsWith('-')) {
      // If this is a flag that takes a value and the next token exists
      // and isn't a flag, skip that too
      if (i + 1 < tokens.length && !tokens[i + 1]?.startsWith('-')) {
        i++;
      }
      continue;
    }

    // Count this as a parameter
    paramCount++;
  }

  return paramCount;
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
