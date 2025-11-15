import { LspDocument } from '../document';
import { Analyzer, analyzer } from '../analyze';
import { logger } from '../logger';
import { SyncFileHelper } from './file-operations';
import path from 'path';
import chalk from 'chalk';
import { CommanderSubcommand } from './commander-cli-subcommands';
import { semanticTokenHandler } from '../semantic-tokens-simple';
import { FISH_SEMANTIC_TOKENS_LEGEND, FishSemanticTokens } from './semantics';
import { createInterface } from 'node:readline';
import { startServer } from './startup';

interface ParseTreeOutput {
  source: string;
  parseTree: string;
}

interface SemanticTokensOutput {
  source: string;
  tokens: string;
}

/**
 * Reads all content from stdin, line by line.
 * It works for both piped input and manual terminal input.
 * @returns Promise<string> - The content from stdin, or an empty string if there is no input.
 */
async function readFromStdin(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    terminal: false, // Set to false to avoid issues with piped input
  });

  let data = '';
  for await (const line of rl) {
    data += line + '\n';
  }
  return data.trim(); // Trim trailing newline for cleaner output
}

/**
 * Debug utility that acts like tree-sitter-cli on a source file.
 * Shows both the raw source code and the tree-sitter parse tree.
 *
 * @param document - The LspDocument to debug
 * @returns Object containing both source and parse tree as strings
 */
export function debugWorkspaceDocument(document: LspDocument, useColors: boolean = true): ParseTreeOutput {
  const source = document.getText();

  // Parse the document using the existing analyzer's parser
  const tree = analyzer.parser.parse(source);

  // Convert the parse tree to a readable string format
  const parseTree = formatSyntaxTree(tree.rootNode, 0, useColors);

  return {
    source,
    parseTree,
  };
}

/**
 * Color scheme for different node types
 */
const nodeTypeColors = {
  // Fish-specific node types
  command: chalk.blue,
  command_name: chalk.blue.bold,
  argument: chalk.green,
  option: chalk.yellow,
  redirection: chalk.magenta,
  pipe: chalk.cyan,
  variable_expansion: chalk.red,
  variable_name: chalk.red.bold,
  string: chalk.green,
  quoted_string: chalk.green,
  double_quote_string: chalk.green,
  single_quote_string: chalk.green,
  concatenation: chalk.yellow,
  word: chalk.yellow,
  comment: chalk.yellow.dim,
  function_definition: chalk.blue.bold,
  if_statement: chalk.cyan.bold,
  for_statement: chalk.cyan.bold,
  while_statement: chalk.cyan.bold,
  switch_statement: chalk.cyan.bold,
  case_clause: chalk.cyan,
  begin_statement: chalk.magenta.bold,
  end: chalk.magenta.bold,
  program: chalk.white.bold,
  integer: chalk.yellow,
  float: chalk.yellow,
  boolean: chalk.yellow,
  identifier: chalk.white.bgBlack,
  ERROR: chalk.red.bold,
  // Symbols and operators
  '(': chalk.white.bold.italic,
  ')': chalk.white.bold.italic,
  '[': chalk.white.bold.italic,
  ']': chalk.white.bold.italic,
  '{': chalk.white.bold.italic,
  '}': chalk.white.bold.italic,
  '|': chalk.cyan.bold,
  '&&': chalk.cyan,
  '||': chalk.cyan,
  ';': chalk.white.bold.italic,
  '\n': chalk.white.bold.italic,
  // Default fallback
  default: chalk.white.bgBlack,
};

/**
 * Color scheme for parentheses based on nesting depth
 */
const parenthesesColors = [
  chalk.white,
  chalk.yellow,
  chalk.cyan,
  chalk.magenta,
  chalk.green,
  chalk.blue,
  chalk.red,
];

/**
 * Get color function for a given node type
 */
function getNodeTypeColor(nodeType: string): (text: string) => string {
  return nodeTypeColors[nodeType as keyof typeof nodeTypeColors] || nodeTypeColors.default;
}

/**
 * Get color function for parentheses based on depth
 */
function getParenthesesColor(depth: number): (text: string) => string {
  return parenthesesColors[depth % parenthesesColors.length] || chalk.yellowBright;
}

/**
 * Recursively formats a syntax tree node into a readable string representation
 * similar to tree-sitter-cli output, with comprehensive color highlighting.
 */
function formatSyntaxTree(node: any, depth: number = 0, useColors: boolean = true): string {
  const indent = '  '.repeat(depth);
  const rawNodeType = node.type || 'unknown';
  // If node type is just whitespace, escape it for visibility
  const nodeType = rawNodeType.trim() === '' ? escapeWhitespace(rawNodeType) : rawNodeType;
  const startPos = `${node.startPosition?.row || 0}:${node.startPosition?.column || 0}`;
  const endPos = `${node.endPosition?.row || 0}:${node.endPosition?.column || 0}`;

  // Get colors for this depth and node type (or no-op functions if colors disabled)
  const parenColor = useColors ? getParenthesesColor(depth) : (text: string) => text;
  const typeColor = useColors ? getNodeTypeColor(nodeType) : (text: string) => text;
  const rangeColor = useColors ? chalk.dim.white.dim : (text: string) => text;

  let result = `${indent}${parenColor('(')}${typeColor(nodeType)} ${rangeColor(`[${startPos}, ${endPos}]`)}`;

  // If it's a leaf node with text, show the text with proper escaping
  if (node.children.length === 0 && node.text) {
    const escapedText = escapeWhitespace(node.text);
    if (useColors) {
      result += ` ${chalk.dim('"')}${chalk.italic.green(escapedText)}${chalk.dim('"')}`;
    } else {
      result += ` "${escapedText}"`;
    }
  }

  // Handle children
  if (node.children.length > 0) {
    result += '\n';
    // Recursively format children
    for (const child of node.children) {
      result += formatSyntaxTree(child, depth + 1, useColors);
    }
    result += `${indent}${parenColor(')')}`;
  } else {
    result += parenColor(')');
  }

  // Always end with a newline, regardless of whether this node has children
  result += '\n';

  return result;
}

/**
 * Escapes whitespace characters in text for readable display
 * Uses JSON.stringify for proper escaping similar to tree-sitter-cli
 */
function escapeWhitespace(text: string): string {
  // Use JSON.stringify to properly escape the string, then remove the outer quotes
  const escaped = JSON.stringify(text);
  return escaped.slice(1, -1); // Remove the surrounding quotes
}

/**
 * Pretty prints the debug output to console in a readable format.
 *
 * @param document - The LspDocument to debug
 */
export function logTreeSitterDocumentDebug(document: LspDocument): void {
  const { source, parseTree } = debugWorkspaceDocument(document);

  logger.log('='.repeat(80));
  logger.log(`DEBUG: ${document.getFileName()}`);
  logger.log('='.repeat(80));
  logger.log('SOURCE:');
  logger.log('-'.repeat(40));

  // Print source with line numbers
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    logger.log(`${(index + 1).toString().padStart(3)}: ${line}`);
  });

  logger.log('\n' + '-'.repeat(40));
  logger.log('PARSE TREE:');
  logger.log('-'.repeat(40));
  logger.log(parseTree);
  logger.log('='.repeat(80));
}

export function returnParseTreeString(document: LspDocument, useColors: boolean = true): string {
  const { parseTree } = debugWorkspaceDocument(document, useColors);
  return parseTree;
}

export function expandParseCliTreeFile(input: string | undefined): string {
  if (!input || !input.trim()) {
    return '';
  }

  const resultPath = SyncFileHelper.expandEnvVars(input);
  if (SyncFileHelper.isAbsolutePath(resultPath)) {
    return resultPath;
  }
  return path.resolve(resultPath);
}

export async function cliDumpParseTree(document: LspDocument, useColors: boolean = true): Promise<0 | 1> {
  await Analyzer.initialize();
  const { parseTree } = debugWorkspaceDocument(document, useColors);

  // Output the parse tree to stdout
  logger.logToStdout(parseTree);
  if (parseTree.trim().length === 0) {
    const errorMsg = useColors ? chalk.red('No parse tree available for this document.') : 'No parse tree available for this document.';
    logger.logToStderr(errorMsg);
    return 1;
  }
  return 0;
}

// Entire wrapper for `src/cli.ts` usage of this function
export async function handleCLiDumpParseTree(args: CommanderSubcommand.info.schemaType): Promise<0 | 1> {
  startServer();

  // Initialize the analyzer without starting the full server
  await Analyzer.initialize();

  const useColors = !args.noColor; // Use colors unless --no-color flag is set

  // If no file path provided (either empty string, true boolean, or undefined), read from stdin
  if (!args.dumpParseTree || args.dumpParseTree === true || typeof args.dumpParseTree === 'string' && args.dumpParseTree.trim() === '') {
    const stdinContent = await readFromStdin();
    if (stdinContent.trim() === '') {
      logger.logToStderr('Error: No input provided. Please provide either a file path or pipe content to stdin.');
      return 1;
    }
    const doc = LspDocument.createTextDocumentItem('stdin.fish', stdinContent);
    return await cliDumpParseTree(doc, useColors);
  }

  // Original file-based logic
  const filePath = expandParseCliTreeFile(args.dumpParseTree);
  if (!SyncFileHelper.isFile(filePath)) {
    logger.logToStderr(`Error: Cannot read file at ${filePath}. Please check the file path and permissions.`);
    process.exit(1);
  }
  const doc = LspDocument.createFromPath(filePath);
  return await cliDumpParseTree(doc, useColors);
}

// ============================================================================
// Semantic Tokens Dumping Functions
// ============================================================================

/**
 * Color scheme for semantic token types
 */
const tokenTypeColors = {
  function: chalk.blue.bold,
  variable: chalk.red,
  keyword: chalk.magenta.bold,
  decorator: chalk.yellow,
  string: chalk.green,
  operator: chalk.cyan,
  comment: chalk.gray,
  default: chalk.white,
};

/**
 * Get color function for a given token type
 */
function getTokenTypeColor(tokenType: string, useColors: boolean): (text: string) => string {
  if (!useColors) return (text: string) => text;
  return tokenTypeColors[tokenType as keyof typeof tokenTypeColors] || tokenTypeColors.default;
}

/**
 * Decode modifiers from bitmask
 */
function decodeModifiers(modifiersMask: number): string[] {
  const modifiers: string[] = [];
  const legend = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers;

  for (let i = 0; i < legend.length; i++) {
    if (modifiersMask & 1 << i) {
      modifiers.push(legend[i]!);
    }
  }

  return modifiers;
}

/**
 * Formats semantic tokens into a human-readable string representation.
 * Shows each token with its position, length, type, and modifiers.
 */
function formatSemanticTokens(data: number[], source: string, useColors: boolean): string {
  if (data.length === 0) {
    return useColors ? chalk.gray('(no semantic tokens)') : '(no semantic tokens)';
  }

  const lines = source.split('\n');
  const legend = FishSemanticTokens.legend;
  const results: string[] = [];

  // Semantic tokens are encoded as a flat array of integers
  // [deltaLine, deltaStart, length, tokenType, modifiers, ...]
  let currentLine = 0;
  let currentChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i]!;
    const deltaStart = data[i + 1]!;
    const length = data[i + 2]!;
    const tokenTypeIndex = data[i + 3]!;
    const modifiersMask = data[i + 4]!;

    // Update position
    currentLine += deltaLine;
    if (deltaLine > 0) {
      currentChar = deltaStart;
    } else {
      currentChar += deltaStart;
    }

    // Get token information
    const tokenType = legend.tokenTypes[tokenTypeIndex] || 'unknown';
    const modifiers = decodeModifiers(modifiersMask);

    // Extract the actual text from the source
    const line = lines[currentLine] || '';
    const tokenText = line.substring(currentChar, currentChar + length);

    // Format the output
    const posStr = `${currentLine}:${currentChar}`;
    const typeColor = getTokenTypeColor(tokenType, useColors);
    const dimColor = useColors ? chalk.dim : (text: string) => text;
    const boldColor = useColors ? chalk.bold : (text: string) => text;

    let tokenInfo = `${dimColor(posStr.padEnd(10))} `;
    tokenInfo += `${typeColor(tokenType.padEnd(12))} `;
    tokenInfo += `${dimColor('len=')}${length.toString().padEnd(3)} `;

    if (modifiers.length > 0) {
      const modStr = `[${modifiers.join(', ')}]`;
      tokenInfo += `${dimColor(modStr.padEnd(30))} `;
    } else {
      tokenInfo += `${dimColor(''.padEnd(30))} `;
    }

    tokenInfo += `${boldColor('"')}${tokenText}${boldColor('"')}`;

    results.push(tokenInfo);
  }

  return results.join('\n');
}

/**
 * Debug utility that shows semantic tokens for a source file.
 * Displays the source code and the semantic tokens.
 *
 * @param document - The LspDocument to debug
 * @param useColors - Whether to use color output
 * @returns Object containing both source and semantic tokens as strings
 */
export function debugSemanticTokens(document: LspDocument, useColors: boolean = true): SemanticTokensOutput {
  const source = document.getText();

  // Get semantic tokens for the document using the simplified handler
  const semanticTokens = semanticTokenHandler({
    textDocument: { uri: document.uri },
  });

  // Format the semantic tokens into a readable string
  const tokens = formatSemanticTokens(semanticTokens.data, source, useColors);

  return {
    source,
    tokens,
  };
}

/**
 * CLI handler for dumping semantic tokens
 */
export async function cliDumpSemanticTokens(document: LspDocument, useColors: boolean = true): Promise<0 | 1> {
  await Analyzer.initialize();

  // Analyze the document to ensure the analyzer cache is populated
  analyzer.analyze(document);

  const { tokens } = debugSemanticTokens(document, useColors);

  // Output the semantic tokens to stdout
  logger.logToStdout(tokens);
  if (tokens.trim().length === 0 || tokens.includes('(no semantic tokens)')) {
    const errorMsg = useColors ? chalk.red('No semantic tokens available for this document.') : 'No semantic tokens available for this document.';
    logger.logToStderr(errorMsg);
    return 1;
  }
  return 0;
}

/**
 * Main wrapper for `src/cli.ts` usage of semantic tokens dumping
 */
export async function handleCLiDumpSemanticTokens(args: CommanderSubcommand.info.schemaType): Promise<0 | 1> {
  // This initializes the server
  startServer();

  const useColors = !args.noColor; // Use colors unless --no-color flag is set

  // If no file path provided (either empty string, true boolean, or undefined), read from stdin
  if (!args.dumpSemanticTokens || args.dumpSemanticTokens === true || typeof args.dumpSemanticTokens === 'string' && args.dumpSemanticTokens.trim() === '') {
    const stdinContent = await readFromStdin();
    if (stdinContent.trim() === '') {
      logger.logToStderr('Error: No input provided. Please provide either a file path or pipe content to stdin.');
      return 1;
    }
    const doc = LspDocument.createTextDocumentItem('stdin.fish', stdinContent);
    return await cliDumpSemanticTokens(doc, useColors);
  }

  // Original file-based logic
  const filePath = expandParseCliTreeFile(args.dumpSemanticTokens);
  if (!SyncFileHelper.isFile(filePath)) {
    logger.logToStderr(`Error: Cannot read file at ${filePath}. Please check the file path and permissions.`);
    process.exit(1);
  }
  const doc = LspDocument.createFromPath(filePath);
  return await cliDumpSemanticTokens(doc, useColors);
}
