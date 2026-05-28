import { SyntaxNode } from 'web-tree-sitter';

/**
 * Resolves a single fish shell escape sequence token to its character value.
 *
 * In unquoted fish strings `\X` where X is not a recognised special character
 * resolves to just `X`.  Recognised specials follow the standard C/fish
 * convention (`\n`, `\t`, `\e`, `\u`, …).
 *
 * @param seq - raw escape-sequence text, e.g. `\n`, `\m`, `\uXXXX`
 * @returns the resolved character(s)
 */
function unescapeSequence(seq: string): string {
  if (!seq.startsWith('\\') || seq.length < 2) return seq;
  const char = seq[1]!;
  switch (char) {
    case 'a': return '\x07';   // bell
    case 'b': return '\x08';   // backspace
    case 'e': return '\x1B';   // escape
    case 'f': return '\x0C';   // form feed
    case 'n': return '\n';     // newline
    case 'r': return '\r';     // carriage return
    case 't': return '\t';     // tab
    case 'v': return '\x0B';   // vertical tab
    case '\\': return '\\';
    case ' ': return ' ';
    case 'u': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'U': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'x': {
      const cp = parseInt(seq.slice(2), 16);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'o': {
      const cp = parseInt(seq.slice(2), 8);
      return isNaN(cp) ? seq : String.fromCodePoint(cp);
    }
    case 'c': {
      const ctrl = seq[2];
      return ctrl ? String.fromCharCode(ctrl.toUpperCase().charCodeAt(0) - 64) : seq;
    }
    default:
      // Any other \X → X  (backslash is simply dropped)
      return char;
  }
}

/**
 * Utilities for extracting the bare string value from any fish shell string
 * surface form — quoted, escaped, or plain.
 *
 * Fish strings can appear in multiple forms that all denote the same value:
 *
 *   `mas`       → `word` node / plain text     → `"mas"`
 *   `'mas'`     → `single_quote_string` node   → `"mas"`
 *   `"mas"`     → `double_quote_string` node   → `"mas"`
 *   `\mas`      → `concatenation` node         → `"mas"`
 *   `\ma\s`     → `concatenation` node         → `"mas"`
 *   `ma\s`      → `concatenation` node         → `"mas"`
 *
 * @see https://github.com/ndonfris/fish-lsp/issues/140
 */
export namespace FishString {
  export interface CommandExtractConfig {
    /** Whether to parse command substitutions like $(cmd) */
    readonly parseCommandSubstitutions: boolean;
    /** Whether to parse parenthesized expressions like (cmd; and cmd2) */
    readonly parseParenthesized: boolean;
    /** Whether to remove fish keywords and operators */
    readonly cleanKeywords: boolean;
  }

  export const DEFAULT_COMMAND_EXTRACT_CONFIG: CommandExtractConfig = {
    parseCommandSubstitutions: true,
    parseParenthesized: true,
    cleanKeywords: true,
  };

  /**
   * Extracts the bare string value from a fish shell SyntaxNode.
   * Strips surrounding quotes and resolves escape sequences.
   */
  export function fromNode(node: SyntaxNode): string {
    switch (node.type) {
      case 'single_quote_string':
      case 'double_quote_string':
        return node.text.slice(1, -1);
      case 'concatenation':
        return node.children
          .map(child =>
            child.type === 'escape_sequence'
              ? unescapeSequence(child.text)
              : child.text)
          .join('');
      default:
        // Covers plain `word` nodes and any future node types.
        return node.text;
    }
  }

  /**
   * Extracts the bare string value from a raw fish shell text string.
   * Strips surrounding quotes and resolves escape sequences.
   * Use `fromNode` instead when a SyntaxNode is available.
   */
  export function fromText(text: string): string {
    if (text.length >= 2) {
      if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
      if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
    }
    // Resolve escape sequences in unquoted / concatenation-style text.
    // Alternation is ordered longest-first so \uXXXX is matched before the
    // catch-all single-character branch.
    return text.replace(
      /\\(u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|x[0-9a-fA-F]{1,2}|o[0-7]{1,3}|c[a-zA-Z]|[\s\S])/g,
      (seq) => unescapeSequence(seq),
    );
  }

  /**
   * Convenience overload — dispatches to `fromNode` or `fromText` based on
   * the type of `input`.
   */
  export function parse(input: SyntaxNode | string): string {
    return typeof input === 'string' ? fromText(input) : fromNode(input);
  }

  /**
   * Extract command names from fish string input.
   *
   * This is the text-oriented counterpart to `nested-strings.ts`, which still
   * owns precise range extraction. Use this when you only need the command
   * names, not their exact positions.
   */
  export function extractCommands(
    input: SyntaxNode | string,
    config: CommandExtractConfig = DEFAULT_COMMAND_EXTRACT_CONFIG,
  ): string[] {
    const rawText = typeof input === 'string' ? input : input.text;
    if (!rawText?.trim()) return [];

    const optionCommand = parseOptionArgument(rawText);
    if (optionCommand) {
      return [optionCommand];
    }

    const cleanedText = parse(input);
    const commands = new Set<string>();

    const directCommands = parseDirectCommands(cleanedText, config);
    directCommands.forEach(cmd => commands.add(cmd));

    const substitutionCommands = [];
    const parenthesizedCommands = [];

    if (config.parseCommandSubstitutions) {
      substitutionCommands.push(...parseCommandSubstitutions(cleanedText));
      substitutionCommands.forEach(cmd => commands.add(cmd));
    }

    if (config.parseParenthesized) {
      parenthesizedCommands.push(...parseParenthesizedExpressions(cleanedText));
      parenthesizedCommands.forEach(cmd => commands.add(cmd));
    }

    return Array.from(commands).filter(cmd => cmd.length > 0);
  }
}

const FISH_KEYWORDS = new Set([
  'and', 'or', 'not', 'begin', 'end', 'if', 'else', 'switch', 'case',
  'for', 'in', 'while', 'function', 'return', 'break', 'continue',
  'set', 'test', 'true', 'false',
]);

const FISH_OPERATORS = new Set([
  '&&', '||', '|', ';', '&', '>', '<', '>>', '<<', '>&', '<&',
  '2>', '2>>', '2>&1', '1>&2', '/dev/null', '$',
]);

function parseOptionArgument(text: string): string | null {
  const optionArgRegex = /^(?:-[a-zA-Z]|--[a-zA-Z][a-zA-Z0-9-]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_-]*)/;
  const match = text.match(optionArgRegex);

  if (match && match[1]) {
    const command = match[1].trim();
    if (command.length > 1 && !isNumeric(command)) {
      return command;
    }
  }

  return null;
}

function parseDirectCommands(input: string, config: FishString.CommandExtractConfig): string[] {
  return extractCommandsFromText(input, config.cleanKeywords);
}

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

function extractCommandsFromText(input: string, cleanKeywords = true): string[] {
  const statements = input.split(/[;&|]+/)
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0)
    .filter(stmt => !stmt.startsWith('(') && !stmt.startsWith('$('));

  const commands: string[] = [];

  for (let statement of statements) {
    if (statement.includes('=')) statement = statement.split('=').slice(1).join('=').trim();
    const tokens = tokenizeStatement(statement);
    const filteredTokens = cleanKeywords
      ? tokens.filter(token => !FISH_KEYWORDS.has(token) && !FISH_OPERATORS.has(token))
      : tokens;

    const command = filteredTokens.at(0);
    if (command && !isNumeric(command) && command.length > 1) {
      commands.push(command);
    }
    // if (filteredTokens.length > 0 && filteredTokens.at(0)) commands.push(filteredTokens.at(0))
    // for (const token of filteredTokens) {
    //   if (token && !isNumeric(token) && token.length > 1) {
    //     commands.push(token);
    //   }
    // }
  }

  return commands.filter(Boolean);
}

function tokenizeStatement(statement: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < statement.length; i++) {
    const char = statement[i];
    if (!char) continue;

    if (!inQuotes && (char === '"' || char === '\'')) {
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

function isNumeric(str: string): boolean {
  return /^[0-9]+$/.test(str);
}
