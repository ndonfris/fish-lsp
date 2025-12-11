import {
  SemanticTokensLegend,
  Range,
  Position,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { isBuiltin } from './builtins';
import { PrebuiltDocumentationMap } from './snippets';
import { analyzer } from '../analyze';
import { cachedCompletionMap } from '../server';

/**
 * Internal semantic token representation
 */
export interface SemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

export namespace SemanticToken {
  export function create(
    line: number,
    startChar: number,
    length: number,
    tokenType: number,
    tokenModifiers: number | string[] = 0,
  ): SemanticToken {
    let mods = 0;
    if (Array.isArray(tokenModifiers)) {
      mods = calculateModifiersMask(...tokenModifiers);
    } else if (typeof tokenModifiers === 'number') {
      mods = tokenModifiers;
    }
    return {
      line,
      startChar,
      length,
      tokenType,
      tokenModifiers: mods,
    };
  }

  export function fromNode(
    node: SyntaxNode,
    tokenType: number,
    tokenModifiers: number | string[] = 0,
  ) {
    return create(
      node.startPosition.row,
      node.startPosition.column,
      node.endIndex - node.startIndex,
      tokenType,
      tokenModifiers,
    );
  }

  export function fromPosition(
    pos: {
      line: number;
      character: number;
    },
    length: number,
    tokenType: number,
    tokenModifiers: number | string[] = 0,
  ) {
    return create(
      pos.line,
      pos.character,
      length,
      tokenType,
      tokenModifiers,
    );
  }

  export function fromRange(params: {
    range: Range;
    tokenType: SemanticTokenType;
    tokenModifiers: number | string[];
  }) {
    const range = params.range;
    const tokenType = getTokenTypeIndex(params.tokenType);
    const tokenModifiers = params.tokenModifiers;
    return create(
      range.start.line,
      range.start.character,
      range.end.line === range.start.line
        ? range.end.character - range.start.character
        : 0,
      tokenType,
      tokenModifiers,
    );
  }
}

export const SemanticTokenTypes = {
  ['function']: 'function',     // User-defined functions and fish-shipped functions
  ['variable']: 'variable',     // Variables
  ['keyword']: 'keyword',       // Built-in commands from `builtin -n`
  ['operator']: 'operator',     // Operators like `--`, `;`
  ['decorator']: 'decorator',   // Shebangs
  ['string']: 'string',         // Strings (future use)
  ['number']: 'number',         // Numbers (integers and floats)
  ['event']: 'event',           // Events (future use)
} as const;
export type SemanticTokenType = (typeof SemanticTokenTypes)[keyof typeof SemanticTokenTypes];

export const SemanticTokenModifiers = {
  ['local']: 'local',                    // Local scope variables/functions
  ['inherit']: 'inherit',                // Inherited variables
  ['function']: 'function',              // Function modifier
  ['global']: 'global',                  // Global scope variables/functions
  ['universal']: 'universal',            // Universal scope variables
  ['export']: 'export',                  // Exported variables
  ['defaultLibrary']: 'defaultLibrary',  // Fish-shipped functions
  ['builtin']: 'builtin',                // Built-in commands
} as const;
export type SemanticTokenModifier = (typeof SemanticTokenModifiers)[keyof typeof SemanticTokenModifiers];

export namespace FishSemanticTokens {
  export const types = Object.values(SemanticTokenTypes)
    .reduce((acc, value, index) => {
      acc[value as SemanticTokenType] = index;
      return acc;
    }, {} as Record<SemanticTokenType, number>);
  export const mods = Object.values(SemanticTokenModifiers)
    .reduce((acc, value, index) => {
      acc[value as SemanticTokenModifier] = index;
      return acc;
    }, {} as Record<SemanticTokenModifier, number>);

  export const legend: SemanticTokensLegend = {
    tokenTypes: Object.values(SemanticTokenTypes),
    tokenModifiers: Object.values(SemanticTokenModifiers),
  };

  export function modMaskToStringArray(mask: number): string[] {
    const result: string[] = [];
    for (const [mod, index] of Object.entries(mods)) {
      if (mask & 1 << index) {
        result.push(mod);
      }
    }
    return result;
  }

}

// export const FISH_SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
//   tokenTypes: SemanticTokenTypes ? Object.values(SemanticTokenTypes) : [],
//   tokenModifiers: SemanticTokenModifiers ? Object.values(SemanticTokenModifiers) : [],
// } as SemanticTokensLegend;

export function getTokenTypeIndex(tokenType: string): number {
  return FishSemanticTokens.types[tokenType as SemanticTokenType] || 0;
}

export function getModifierIndex(modifier: string): number {
  return FishSemanticTokens.mods[modifier as SemanticTokenModifier] || 0;
}

export function calculateModifiersMask(...modifiers: string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    const index = getModifierIndex(modifier);
    if (index !== -1) {
      mask |= 1 << index;
    }
  }
  return mask;
}
//
// export function hasModifier(mask: number, modifier: string): boolean {
//   const index = getModifierIndex(modifier);
//   if (index === -1) return false;
//   return (mask & 1 << index) !== 0;
// }
//
export function getModifiersFromMask(mask: number): string[] {
  const modifiers: string[] = [];
  for (let i = 0; i < Object.values(FishSemanticTokens.mods).length; i++) {
    const modifier = Object.keys(FishSemanticTokens.mods)[i];
    if (modifier && mask & 1 << i) {
      modifiers.push(modifier);
    }
  }
  return modifiers;
}

// export function getCaptureToTokenMapping(): Record<string, { tokenType: string; index: number; }> {
//   const captureNames = extractCaptureNames(highlights);
//   const mapping: Record<string, { tokenType: string; index: number; }> = {};
//
//   for (const captureName of captureNames) {
//     const tokenType = mapCaptureToTokenType(captureName);
//     const index = getTokenTypeIndex(tokenType);
//
//     mapping[captureName] = {
//       tokenType,
//       index,
//     };
//   }
//
//   return mapping;
// }

export function nodeIntersectsRange(node: SyntaxNode, range: Range): boolean {
  const nodeStart = Position.create(node.startPosition.row, node.startPosition.column);
  const nodeEnd = Position.create(node.endPosition.row, node.endPosition.column);

  return !(
    nodeEnd.line < range.start.line ||
    nodeEnd.line === range.start.line && nodeEnd.character < range.start.character ||
    nodeStart.line > range.end.line ||
    nodeStart.line === range.end.line && nodeStart.character > range.end.character
  );
}

export function getPositionFromOffset(content: string, offset: number): { line: number; character: number; } {
  let line = 0;
  let character = 0;

  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }

  return { line, character };
}

export function getTokenTypePriority(tokenTypeIndex: number, modifiersMask: number = 0): number {
  const tokenTypesArray = FishSemanticTokens.legend.tokenTypes;
  const tokenType = tokenTypesArray[tokenTypeIndex];

  if (!tokenType) {
    return 30;
  }

  const pathModifierIndex = FishSemanticTokens.legend.tokenModifiers.indexOf('path');
  const filenameModifierIndex = FishSemanticTokens.legend.tokenModifiers.indexOf('filename');
  const definitionModifierIndex = FishSemanticTokens.legend.tokenModifiers.indexOf('definition');

  if (modifiersMask > 0) {
    if (tokenType === 'variable' && definitionModifierIndex !== -1 && modifiersMask & 1 << definitionModifierIndex) {
      return 130;
    }

    if (pathModifierIndex !== -1 && modifiersMask & 1 << pathModifierIndex) {
      return 120;
    }

    if (filenameModifierIndex !== -1 && modifiersMask & 1 << filenameModifierIndex) {
      return 115;
    }
  }

  const basePriorities: Record<string, number> = {
    operator: 110,
    keyword: 105,
    decorator: 103,
    function: 100,
    method: 100,
    variable: 98,
    parameter: 95,
    property: 90,
    type: 80,
    class: 80,
    namespace: 80,
    event: 70,
    number: 50,
    comment: 40,
    string: 30,
    regexp: 10,
  };

  return basePriorities[tokenType] || 30;
}

export function analyzeValueType(text: string): { tokenType: string; modifiers?: string[]; } {
  if (/^\d+$/.test(text)) {
    return { tokenType: 'number' };
  }
  if (/^\d*\.\d+$/.test(text)) {
    return { tokenType: 'number' };
  }

  if (/^\/[a-zA-Z0-9_\-\/\.]*/.test(text)) {
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(text);
    if (hasExtension && !text.endsWith('/')) {
      return { tokenType: 'property', modifiers: ['filename'] };
    } else {
      return { tokenType: 'property', modifiers: ['path'] };
    }
  }

  if (/^~(\/[a-zA-Z0-9_\-\/\.]*)?$/.test(text)) {
    return { tokenType: 'property', modifiers: ['path'] };
  }

  if (/^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/.test(text)) {
    return { tokenType: 'property', modifiers: ['filename'] };
  }

  if (/^https?:\/\//.test(text)) {
    return { tokenType: 'string' };
  }

  if (/^(true|false)$/i.test(text)) {
    return { tokenType: 'keyword' };
  }

  if (/^\$[A-Z_][A-Z0-9_]*$/i.test(text)) {
    return { tokenType: 'variable' };
  }

  return { tokenType: 'string' };
}

/**
 * Get semantic token modifiers for a command based on its definition
 * @param commandName - The name of the command
 * @returns Bitmask of token modifiers
 */
/**
 * Get semantic token modifiers for a variable based on its definition
 * @param variableName - The name of the variable (without $)
 * @param documentUri - Optional document URI to search for local symbols
 * @returns Bitmask of token modifiers
 */
export function getVariableModifiers(variableName: string, documentUri?: string): number {
  // Look up the variable in both local and global symbols
  let symbols = analyzer.globalSymbols.find(variableName);

  // If we have a document URI, also check local symbols
  if (documentUri && symbols.length === 0) {
    const localSymbols = analyzer.cache.getFlatDocumentSymbols(documentUri);
    const localMatches = localSymbols.filter(s => s.name === variableName &&
      (s.fishKind === 'SET' || s.fishKind === 'READ' || s.fishKind === 'VARIABLE' ||
        s.fishKind === 'FUNCTION_VARIABLE' || s.fishKind === 'EXPORT' ||
        s.fishKind === 'FOR' || s.fishKind === 'ARGPARSE' || s.fishKind === 'INLINE_VARIABLE'));
    if (localMatches.length > 0) {
      symbols = localMatches;
    }
  }

  if (symbols.length === 0) {
    // No definition found
    return 0;
  }

  // Use the first symbol found (most relevant)
  const symbol = symbols[0]!;

  // Get modifiers based on the symbol's scope
  const modifiers: string[] = [];

  if (symbol.isGlobal()) {
    modifiers.push('global');
  } else if (symbol.isLocal()) {
    modifiers.push('local');
  }

  // Add export modifier if applicable
  if (symbol.fishKind === 'EXPORT' || symbol.fishKind === 'SET' || symbol.fishKind === 'FUNCTION_VARIABLE') {
    const options = symbol.options || [];
    for (const opt of options) {
      if (opt.isOption('-x', '--export')) {
        modifiers.push('export');
        break;
      }
    }
  }

  return calculateModifiersMask(...modifiers);
}

/**
 * Information about a command's definition and modifiers
 */
export type CommandModifierInfo = {
  modifiers: number;
  isDefinedInDocument: boolean;
};

/**
 * Get semantic token modifiers for a command and check if it's defined in the current document
 * @param commandNode - The command node
 * @param documentUri - Optional document URI to search for local symbols
 * @returns Object with modifiers bitmask and whether symbol is defined in this document
 */
export function getCommandModifierInfo(commandNode: SyntaxNode, documentUri?: string): CommandModifierInfo {
  const commandName = commandNode.firstNamedChild?.text;

  if (!commandName) {
    return { modifiers: 0, isDefinedInDocument: false };
  }

  // Check if it's a builtin command
  if (isBuiltin(commandName)) {
    return { modifiers: calculateModifiersMask('builtin'), isDefinedInDocument: false };
  }

  const allCommands = PrebuiltDocumentationMap.getByType('command');
  if (allCommands.some(s => commandName === s.name)) {
    return { modifiers: calculateModifiersMask('global'), isDefinedInDocument: false };
  }

  // Look up the command in both local and global symbols
  let symbols = analyzer.globalSymbols.find(commandName);
  let isDefinedInDocument = false;

  // If we have a document URI, also check local symbols
  if (documentUri) {
    const localSymbols = analyzer.cache.getFlatDocumentSymbols(documentUri);
    const localMatches = localSymbols.filter(s =>
      s.name === commandName && (s.fishKind === 'FUNCTION' || s.fishKind === 'ALIAS'),
    );
    if (localMatches.length > 0) {
      symbols = localMatches;
      isDefinedInDocument = true;
    }
  }

  const firstGlobal = cachedCompletionMap?.get('function')?.find(c => c.label === commandName);

  if (symbols.length === 0) {
    // No definition found - could be an external command or not found
    if (firstGlobal) {
      return { modifiers: calculateModifiersMask('global'), isDefinedInDocument: false };
    }
    return { modifiers: 0, isDefinedInDocument: false };
  }

  // Use the first symbol found (most relevant)
  const symbol = symbols[0]!;

  // Check if it's a function
  if (symbol.fishKind === 'FUNCTION') {
    const modifiers: string[] = [];

    // Check if it's autoloaded
    if (symbol.isGlobal() && symbol.document.isAutoloaded() &&
      symbol.name === symbol.document.getAutoLoadName()) {
      modifiers.push('global', 'autoloaded');
    } else if (symbol.isGlobal()) {
      // Global but not autoloaded
      modifiers.push('global', 'script');
    } else if (symbol.isLocal()) {
      modifiers.push('local');
    }

    return { modifiers: calculateModifiersMask(...modifiers), isDefinedInDocument };
  }

  // Check if it's an alias
  if (symbol.fishKind === 'ALIAS') {
    const modifiers: string[] = [];
    if (symbol.document.isAutoloaded() && symbol.scope.scopeTag === 'global') {
      modifiers.push('global');
    }
    modifiers.push('script');
    return { modifiers: calculateModifiersMask(...modifiers), isDefinedInDocument };
  }

  return { modifiers: 0, isDefinedInDocument };
}

export function getCommandModifiers(commandNode: SyntaxNode, documentUri?: string): number {
  return getCommandModifierInfo(commandNode, documentUri).modifiers;
}

// ============================================================================
// Helper Functions
// ============================================================================
export type TextMatchPosition = {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  matchLength: number;
  matchText: string;
};

/**
 * Search for text within a SyntaxNode and return position information for matches
 * @param node - The SyntaxNode to search within
 * @param filter - String or RegExp to search for
 * @returns Array of TextMatchPosition objects for all matches
 */
export function getTextMatchPositions(node: SyntaxNode, filter: string | RegExp): TextMatchPosition[] {
  const matches: TextMatchPosition[] = [];
  const text = node.text;
  const nodeStartLine = node.startPosition.row;
  const nodeStartCol = node.startPosition.column;

  if (typeof filter === 'string') {
    // Simple string search
    let index = 0;
    while ((index = text.indexOf(filter, index)) !== -1) {
      const matchPosition = calculatePositionFromOffset(
        text,
        index,
        nodeStartLine,
        nodeStartCol,
      );

      matches.push({
        startLine: matchPosition.line,
        startChar: matchPosition.char,
        endLine: matchPosition.line, // Single line match for string search
        endChar: matchPosition.char + filter.length,
        matchLength: filter.length,
        matchText: filter,
      });

      index += filter.length;
    }
  } else {
    // RegExp search
    const regex = new RegExp(filter.source, filter.flags.includes('g') ? filter.flags : filter.flags + 'g');
    let match;

    while ((match = regex.exec(text)) !== null) {
      const matchPosition = calculatePositionFromOffset(
        text,
        match.index,
        nodeStartLine,
        nodeStartCol,
      );

      const matchText = match[0];
      const newlineCount = (matchText.match(/\n/g) || []).length;

      const endLine = matchPosition.line + newlineCount;
      let endChar: number;

      if (newlineCount > 0) {
        // Multi-line match - calculate end position from last line
        const lastLineStart = matchText.lastIndexOf('\n') + 1;
        endChar = matchText.length - lastLineStart;
      } else {
        // Single line match
        endChar = matchPosition.char + matchText.length;
      }

      matches.push({
        startLine: matchPosition.line,
        startChar: matchPosition.char,
        endLine,
        endChar,
        matchLength: matchText.length,
        matchText,
      });
    }
  }

  return matches;
}

/**
 * Calculate line and character position from text offset
 */
export function calculatePositionFromOffset(
  text: string,
  offset: number,
  baseLineNumber: number,
  baseColumnNumber: number,
): { line: number; char: number; } {
  const textUpToOffset = text.substring(0, offset);
  const lines = textUpToOffset.split('\n');
  const lineOffset = lines.length - 1;

  if (lineOffset === 0) {
    // Same line as node start
    return {
      line: baseLineNumber,
      char: baseColumnNumber + offset,
    };
  } else {
    // Different line - calculate from last newline
    return {
      line: baseLineNumber + lineOffset,
      char: lines[lines.length - 1]!.length,
    };
  }
}

/**
 * Create SemanticTokens from TextMatchPosition results
 * @param matches - Array of TextMatchPosition results from getTextMatchPositions
 * @param tokenType - Token type index
 * @param modifiers - Token modifiers mask (default: 0)
 * @returns Array of SemanticTokens
 */
export function createTokensFromMatches(
  matches: TextMatchPosition[],
  tokenType: number,
  modifiers: number = 0,
): SemanticToken[] {
  return matches.map(match =>
    SemanticToken.create(
      match.startLine,
      match.startChar,
      match.matchLength,
      tokenType,
      modifiers,
    ),
  );
}

/**
 * Check if a node's position is already covered by existing tokens
 * @param node - The syntax node to check
 * @param tokens - Array of existing semantic tokens
 * @returns True if the node is covered by any existing token
 */
export function isNodeCoveredByTokens(node: SyntaxNode, tokens: SemanticToken[]): boolean {
  const nodeStart = { line: node.startPosition.row, char: node.startPosition.column };
  const nodeEnd = { line: node.endPosition.row, char: node.endPosition.column };

  for (const token of tokens) {
    const tokenEnd = token.startChar + token.length;

    // Check if the node overlaps with this token
    if (token.line === nodeStart.line) {
      // Same line - check character ranges
      if (token.startChar <= nodeStart.char && tokenEnd >= nodeEnd.char) {
        return true; // Node is completely covered by this token
      }
      if (token.startChar < nodeEnd.char && tokenEnd > nodeStart.char) {
        return true; // Partial overlap
      }
    }
  }

  return false;
}

