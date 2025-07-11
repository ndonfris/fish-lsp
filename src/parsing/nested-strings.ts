import { SyntaxNode } from 'web-tree-sitter';
import { DocumentUri, Range, Location } from 'vscode-languageserver';
import { getRange } from '../utils/tree-sitter';

/**
 * Configuration for command extraction
 */
export interface ExtractConfig {
  /** Whether to parse command substitutions like $(cmd) */
  readonly parseCommandSubstitutions: boolean;
  /** Whether to parse parenthesized expressions like (cmd; and cmd2) */
  readonly parseParenthesized: boolean;
  /** Whether to remove fish keywords and operators */
  readonly cleanKeywords: boolean;
}

/**
 * Command reference with location information
 */
export interface CommandReference {
  /** The extracted command name */
  readonly command: string;
  /** Location in the document */
  readonly location: Location;
}

const DEFAULT_CONFIG: ExtractConfig = {
  parseCommandSubstitutions: true,
  parseParenthesized: true,
  cleanKeywords: true,
};

/**
 * Fish shell keywords and operators that should be filtered out
 */
const FISH_KEYWORDS = new Set([
  'and', 'or', 'not', 'begin', 'end', 'if', 'else', 'switch', 'case',
  'for', 'in', 'while', 'function', 'return', 'break', 'continue',
  'set', 'test', 'true', 'false',
]);

const FISH_OPERATORS = new Set([
  '&&', '||', '|', ';', '&', '>', '<', '>>', '<<', '>&', '<&',
  '2>', '2>>', '2>&1', '1>&2', '/dev/null',
]);

/**
 * Extract commands from fish shell string nodes
 */
export function extractCommands(
  node: SyntaxNode,
  config: ExtractConfig = DEFAULT_CONFIG,
): string[] {
  if (!node.text?.trim()) return [];

  const nodeText = node.text;

  // Handle option arguments like --wraps=command
  const optionCommand = parseOptionArgument(nodeText);
  if (optionCommand) {
    return [optionCommand];
  }

  const cleanedText = cleanQuotes(nodeText);
  const commands = new Set<string>();

  // Always parse direct commands first
  const directCommands = parseDirectCommands(cleanedText, config);
  directCommands.forEach(cmd => commands.add(cmd));

  // Parse command substitutions: $(cmd args)
  if (config.parseCommandSubstitutions) {
    const substitutionCommands = parseCommandSubstitutions(cleanedText);
    substitutionCommands.forEach(cmd => commands.add(cmd));
  }

  // Parse parenthesized expressions: (cmd; and cmd2)
  if (config.parseParenthesized) {
    const parenthesizedCommands = parseParenthesizedExpressions(cleanedText);
    parenthesizedCommands.forEach(cmd => commands.add(cmd));
  }

  return Array.from(commands).filter(cmd => cmd.length > 0);
}

/**
 * Extract command references with precise location information
 */
export function extractCommandLocations(
  node: SyntaxNode,
  documentUri: DocumentUri,
  config: ExtractConfig = DEFAULT_CONFIG,
): CommandReference[] {
  if (!node.text?.trim()) return [];

  const nodeRange = getRange(node);
  const nodeText = node.text;
  // Handle option arguments like --wraps=command
  const optionCommand = parseOptionArgument(nodeText);
  if (optionCommand) {
    const offset = nodeText.indexOf(optionCommand);
    return [{
      command: optionCommand,
      location: Location.create(
        documentUri,
        createPreciseRange(optionCommand, offset, nodeRange),
      ),
    }];
  }

  const cleanedText = cleanQuotes(nodeText);
  const quoteOffset = getQuoteOffset(nodeText);

  return findCommandsWithOffsets(cleanedText, config)
    .map(({ command, offset }) => ({
      command,
      location: Location.create(
        documentUri,
        createPreciseRange(command, offset + quoteOffset, nodeRange),
      ),
    }));
}

/**
 * Extract locations for a specific command name
 */
export function extractMatchingCommandLocations(
  symbol: { name: string; },
  node: SyntaxNode,
  documentUri: DocumentUri,
  config: ExtractConfig = DEFAULT_CONFIG,
): Location[] {
  return extractCommandLocations(node, documentUri, config)
    .filter(ref => ref.command === symbol.name)
    .map(ref => ref.location);
}

/**
 * Remove surrounding quotes and return offset adjustment
 */
function cleanQuotes(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') ||
      trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Get the offset adjustment for quotes
 */
function getQuoteOffset(input: string): number {
  const trimmed = input.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') ||
      trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return 1; // Account for opening quote
  }
  return 0;
}

/**
 * Find all commands with their precise offsets in the text
 */
function findCommandsWithOffsets(
  text: string,
  config: ExtractConfig,
): Array<{ command: string; offset: number; }> {
  const results: Array<{ command: string; offset: number; }> = [];

  // Always parse direct commands first
  results.push(...findDirectCommandOffsets(text, config));

  // Parse command substitutions
  if (config.parseCommandSubstitutions) {
    results.push(...findCommandSubstitutionOffsets(text));
  }

  // Parse parenthesized expressions
  if (config.parseParenthesized) {
    results.push(...findParenthesizedCommandOffsets(text));
  }

  return results;
}

/**
 * Find command substitutions with offsets
 */
function findCommandSubstitutionOffsets(text: string): Array<{ command: string; offset: number; }> {
  const results: Array<{ command: string; offset: number; }> = [];
  const regex = /\$\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const commandText = match[1];
    const innerOffset = match.index + 2; // Skip '$('

    if (commandText?.trim()) {
      const firstCommand = getFirstCommand(commandText);
      if (firstCommand) {
        results.push({
          command: firstCommand,
          offset: innerOffset + commandText.indexOf(firstCommand),
        });
      }
    }
  }

  return results;
}

/**
 * Find parenthesized commands with offsets
 */
function findParenthesizedCommandOffsets(text: string): Array<{ command: string; offset: number; }> {
  const results: Array<{ command: string; offset: number; }> = [];
  const stack: number[] = [];
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      if (stack.length === 0) start = i;
      stack.push(i);
    } else if (text[i] === ')' && stack.length > 0) {
      stack.pop();

      if (stack.length === 0 && start !== -1) {
        const innerText = text.slice(start + 1, i);
        const innerOffset = start + 1;

        if (innerText.trim()) {
          const commands = extractCommandsFromText(innerText);
          for (const command of commands) {
            const commandOffset = innerText.indexOf(command);
            if (commandOffset !== -1) {
              results.push({
                command,
                offset: innerOffset + commandOffset,
              });
            }
          }
        }
        start = -1;
      }
    }
  }

  return results;
}

/**
 * Find direct commands with offsets
 */
function findDirectCommandOffsets(
  text: string,
  config: ExtractConfig,
): Array<{ command: string; offset: number; }> {
  const results: Array<{ command: string; offset: number; }> = [];
  const statements = text.split(/[;&|]+/);
  let currentOffset = 0;

  for (const statement of statements) {
    const trimmedStatement = statement.trim();
    const statementStart = text.indexOf(trimmedStatement, currentOffset);

    if (trimmedStatement) {
      const tokens = tokenizeStatement(trimmedStatement);

      // Filter tokens if cleaning is enabled
      const relevantTokens = config.cleanKeywords
        ? tokens.filter(token => !FISH_KEYWORDS.has(token) && !FISH_OPERATORS.has(token))
        : tokens;

      // Find offset for each relevant token
      for (const token of relevantTokens) {
        if (token && !isNumeric(token) && token.length > 1) {
          const tokenOffset = trimmedStatement.indexOf(token);
          if (tokenOffset !== -1) {
            results.push({
              command: token,
              offset: statementStart + tokenOffset,
            });
          }
        }
      }
    }

    currentOffset = statementStart + statement.length;
  }

  return results;
}

/**
 * Get the first command from a text string
 */
function getFirstCommand(text: string): string | null {
  const tokens = tokenizeStatement(text);
  return tokens.length > 0 && tokens[0] && tokens[0].length > 1 ? tokens[0] : null;
}

/**
 * Extract individual commands from a text string
 */
function extractCommandsFromText(input: string, cleanKeywords = true): string[] {
  const statements = input.split(/[;&|]+/)
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  const commands: string[] = [];

  for (const statement of statements) {
    const tokens = tokenizeStatement(statement);

    // Filter out fish keywords if enabled
    const filteredTokens = cleanKeywords
      ? tokens.filter(token => !FISH_KEYWORDS.has(token) && !FISH_OPERATORS.has(token))
      : tokens;

    // Get all potential commands from the statement
    for (const token of filteredTokens) {
      if (token && !isNumeric(token) && token.length > 1) {
        commands.push(token);
      }
    }
  }

  return commands;
}

/**
 * Parse command substitutions
 */
function parseCommandSubstitutions(input: string): string[] {
  const commands: string[] = [];
  const regex = /\$\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    const commandText = match[1];
    if (commandText?.trim()) {
      commands.push(...extractCommandsFromText(commandText, true));
    }
  }

  return commands;
}

/**
 * Parse parenthesized expressions
 */
function parseParenthesizedExpressions(input: string): string[] {
  const commands: string[] = [];
  const stack: number[] = [];
  let start = -1;

  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') {
      if (stack.length === 0) start = i;
      stack.push(i);
    } else if (input[i] === ')' && stack.length > 0) {
      stack.pop();

      if (stack.length === 0 && start !== -1) {
        const innerText = input.slice(start + 1, i);
        if (innerText.trim()) {
          commands.push(...extractCommandsFromText(innerText, true));
        }
        start = -1;
      }
    }
  }

  return commands;
}

/**
 * Parse option arguments like --wraps=command, --command=cmd, etc.
 */
function parseOptionArgument(text: string): string | null {
  // Match patterns like --wraps=command, --command=cmd, -c=cmd
  const optionArgRegex = /^(?:-[a-zA-Z]|--[a-zA-Z][a-zA-Z0-9-]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_-]*)/;
  const match = text.match(optionArgRegex);

  if (match && match[1]) {
    const command = match[1].trim();
    // Only return if it looks like a valid command (not a number or single char)
    if (command.length > 1 && !isNumeric(command)) {
      return command;
    }
  }

  return null;
}

/**
 * Parse direct commands
 */
function parseDirectCommands(input: string, config: ExtractConfig): string[] {
  return extractCommandsFromText(input, config.cleanKeywords);
}

/**
 * Tokenize a statement respecting quotes
 */
function tokenizeStatement(statement: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < statement.length; i++) {
    const char = statement[i];
    if (!char) continue;

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
      current += char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      current += char;
      quoteChar = '';
    } else if (!inQuotes && /\s/.test(char)) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Create a precise range for a command at a specific offset
 */
function createPreciseRange(command: string, offset: number, nodeRange: Range): Range {
  const startChar = nodeRange.start.character + offset;

  return {
    start: {
      line: nodeRange.start.line,
      character: startChar,
    },
    end: {
      line: nodeRange.start.line,
      character: startChar + command.length,
    },
  };
}

/**
 * Check if a string is numeric
 */
function isNumeric(str: string): boolean {
  return /^[0-9]+$/.test(str);
}
