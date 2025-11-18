import { FISH_SEMANTIC_TOKENS_LEGEND, getModifiersFromMask } from '../src/utils/semantics';
import type { SemanticTokens } from 'vscode-languageserver';

/**
 * Decoded semantic token with human-readable fields
 */
export interface DecodedToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: string;
  tokenTypeIndex: number;
  modifiers: string[];
  modifiersMask: number;
  text?: string;
}

/**
 * Decode semantic tokens from LSP format to human-readable format
 * @param tokens - The SemanticTokens result from a provider
 * @param content - Optional source code content to extract text
 * @returns Array of decoded tokens
 */
export function decodeSemanticTokens(
  tokens: SemanticTokens,
  content?: string,
): DecodedToken[] {
  const decoded: DecodedToken[] = [];
  const data = tokens.data;

  let line = 0;
  let startChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const lineDelta = data[i]!;
    const charDelta = data[i + 1]!;
    const length = data[i + 2]!;
    const tokenTypeIndex = data[i + 3]!;
    const modifiersMask = data[i + 4]!;

    line += lineDelta;
    startChar = lineDelta === 0 ? startChar + charDelta : charDelta;

    const tokenType = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes[tokenTypeIndex] || `UNKNOWN(${tokenTypeIndex})`;
    const modifiers = getModifiersFromMask(modifiersMask);

    const token: DecodedToken = {
      line,
      startChar,
      length,
      tokenType,
      tokenTypeIndex,
      modifiers,
      modifiersMask,
    };

    if (content) {
      const lines = content.split('\n');
      token.text = lines[line]?.substring(startChar, startChar + length) || '';
    }

    decoded.push(token);
  }

  return decoded;
}

/**
 * Find tokens by text content
 */
export function findTokensByText(tokens: DecodedToken[], text: string): DecodedToken[] {
  return tokens.filter(t => t.text === text);
}

/**
 * Find tokens by type
 */
export function findTokensByType(tokens: DecodedToken[], tokenType: string): DecodedToken[] {
  return tokens.filter(t => t.tokenType === tokenType);
}

/**
 * Find tokens by modifier
 */
export function findTokensByModifier(tokens: DecodedToken[], modifier: string): DecodedToken[] {
  return tokens.filter(t => t.modifiers.includes(modifier));
}

/**
 * Find tokens that have all specified modifiers
 */
export function findTokensWithModifiers(tokens: DecodedToken[], ...modifiers: string[]): DecodedToken[] {
  return tokens.filter(t => modifiers.every(mod => t.modifiers.includes(mod)));
}

/**
 * Assert that a token exists with specific properties
 */
export function expectTokenExists(
  tokens: DecodedToken[],
  criteria: {
    text?: string;
    tokenType?: string;
    modifiers?: string[];
    line?: number;
  },
): DecodedToken {
  const matches = tokens.filter(t => {
    if (criteria.text !== undefined && t.text !== criteria.text) return false;
    if (criteria.tokenType !== undefined && t.tokenType !== criteria.tokenType) return false;
    if (criteria.line !== undefined && t.line !== criteria.line) return false;
    if (criteria.modifiers !== undefined) {
      if (!criteria.modifiers.every(mod => t.modifiers.includes(mod))) return false;
    }
    return true;
  });

  if (matches.length === 0) {
    throw new Error(
      `Expected to find token matching ${JSON.stringify(criteria)}, but found none.\n` +
      `Available tokens: ${JSON.stringify(tokens.map(t => ({ text: t.text, type: t.tokenType, mods: t.modifiers })), null, 2)}`,
    );
  }

  return matches[0]!;
}

/**
 * Count tokens by type
 */
export function countTokensByType(tokens: DecodedToken[], tokenType: string): number {
  return findTokensByType(tokens, tokenType).length;
}

/**
 * Get all unique token types in the result
 */
export function getUniqueTokenTypes(tokens: DecodedToken[]): string[] {
  return [...new Set(tokens.map(t => t.tokenType))];
}

/**
 * Get all unique modifiers in the result
 */
export function getUniqueModifiers(tokens: DecodedToken[]): string[] {
  const allModifiers = tokens.flatMap(t => t.modifiers);
  return [...new Set(allModifiers)];
}

/**
 * Pretty print tokens for debugging
 */
export function printTokens(tokens: DecodedToken[], title?: string): void {
  if (title) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(60));
  }

  tokens.forEach((token, index) => {
    const modsStr = token.modifiers.length > 0 ? ` [${token.modifiers.join(', ')}]` : '';
    const textStr = token.text ? ` "${token.text}"` : '';
    console.log(
      `Token ${index}: ` +
      `line=${token.line}, char=${token.startChar}, len=${token.length}, ` +
      `type=${token.tokenType}${modsStr}${textStr}`,
    );
  });

  if (title) {
    console.log('='.repeat(60) + '\n');
  }
}
