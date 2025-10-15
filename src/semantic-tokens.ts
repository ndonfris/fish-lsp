import {
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  Range,
  Position,
} from 'vscode-languageserver';
import { QueryCapture, SyntaxNode } from 'web-tree-sitter';
import { analyzer /* Analyzer */ } from './analyze';
import { LspDocument } from './document';
import { highlights } from '@ndonfris/tree-sitter-fish';
import {
  isCommand,
  isCommandName,
  isFishShippedFunctionName,
  isShebang,
  isEndStdinCharacter,
  isExportVariableDefinitionName,
  // isVariableDefinitionName,
  isFunctionDefinition,
} from './utils/node-types';
import { isBuiltin as checkBuiltin } from './utils/builtins';
import { logger } from './logger';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';

/**
 * Internal semantic token representation
 */
interface SemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

export function getQueriesList(queriesRawText: string): string[] {
  const result: string[] = [];

  let openParenCount = 0;
  let openBracketCount = 0;
  let isQuoteCharMet = false;
  let isComment = false;
  let currentQuery = '';

  for (const char of queriesRawText) {
    if (char === '"') isQuoteCharMet = !isQuoteCharMet;
    if (isQuoteCharMet) {
      currentQuery += char;
      continue;
    } else if (!isQuoteCharMet && char === ';') isComment = true;
    else if (isComment && char !== '\n') continue;
    else if (char === '(') openParenCount++;
    else if (char === ')') openParenCount--;
    else if (char === '[') openBracketCount++;
    else if (char === ']') openBracketCount--;
    else if (char === '\n') {
      isComment = false;

      if (!openParenCount && !openBracketCount && currentQuery) {
        // Fix invalid regex patterns before adding to result
        const fixedQuery = currentQuery.trim();

        // Skip the problematic query with invalid regex pattern "^\[$"
        // This query causes "Invalid regular expression: /^[$/: Unterminated character class"
        if (!fixedQuery.includes('"^\\\[$"')) {
          result.push(fixedQuery);
        }
        currentQuery = '';
      }

      continue;
    }

    if (!isComment) currentQuery += char;
  }

  return result;
}

/**
 * Standard LSP semantic token types
 */
export const SemanticTokenTypes = {
  namespace: 'namespace',
  type: 'type',
  class: 'class',
  enum: 'enum',
  interface: 'interface',
  struct: 'struct',
  typeParameter: 'typeParameter',
  parameter: 'parameter',
  variable: 'variable',
  property: 'property',
  enumMember: 'enumMember',
  event: 'event',
  function: 'function',
  method: 'method',
  macro: 'macro',
  keyword: 'keyword',
  modifier: 'modifier',
  comment: 'comment',
  string: 'string',
  number: 'number',
  regexp: 'regexp',
  operator: 'operator',
  decorator: 'decorator',
} as const;

/**
 * Standard LSP semantic token modifiers
 */
export const SemanticTokenModifiers = {
  declaration: 'declaration',
  definition: 'definition',
  readonly: 'readonly',
  static: 'static',
  deprecated: 'deprecated',
  abstract: 'abstract',
  async: 'async',
  modification: 'modification',
  documentation: 'documentation',
  defaultLibrary: 'defaultLibrary',
} as const;

/**
 * Fish-specific semantic token modifiers
 */
export const FishSemanticTokenModifiers = {
  ...SemanticTokenModifiers,
  // Fish-specific modifiers
  local: 'local',
  function: 'function',
  global: 'global',
  universal: 'universal',
  inherit: 'inherit',
  export: 'export',
  autoloaded: 'autoloaded',
  ['not-autoloaded']: 'not-autoloaded',
  builtin: 'builtin',
  script: 'script',
  'fish-lsp-directive': 'fish-lsp-directive',
  // Additional modifiers for new token types
  shebang: 'shebang',
  flag: 'flag',
  argument: 'argument',
  path: 'path',
  filename: 'filename',
} as const;

export type FishSemanticTokenModifier = keyof typeof FishSemanticTokenModifiers;
export type FishSemanticTokenType = keyof typeof SemanticTokenTypes;
/**
 * Complete list of semantic token modifiers for Fish LSP
 */
export const SEMANTIC_TOKEN_MODIFIERS = Object.values(FishSemanticTokenModifiers);

/**
 * Tree-sitter capture name to LSP semantic token type mappings
 */
const CAPTURE_TO_TOKEN_MAPPINGS: Record<string, string> = {
  // Keywords
  keyword: SemanticTokenTypes.keyword,

  // Functions and commands
  function: SemanticTokenTypes.function,

  // Strings
  string: SemanticTokenTypes.string,
  'string.escape': SemanticTokenTypes.string,
  'string.special': SemanticTokenTypes.string,

  // Numbers
  number: SemanticTokenTypes.number,

  // Comments
  comment: SemanticTokenTypes.comment,
  // fish_lsp_* Comment
  // 'comment.toggle': SemanticTokenTypes.comment,

  // Operators and punctuation
  operator: SemanticTokenTypes.operator,
  'punctuation.bracket': SemanticTokenTypes.operator,
  'punctuation.delimiter': SemanticTokenTypes.operator,

  // Variables and constants
  constant: SemanticTokenTypes.variable,
  'constant.builtin': SemanticTokenTypes.variable,
  variable: SemanticTokenTypes.variable,

  // Events
  event: SemanticTokenTypes.event,

  // Additional semantic token types
  parameter: SemanticTokenTypes.parameter,  // For flags and arguments
  property: SemanticTokenTypes.property,    // For file paths
  decorator: SemanticTokenTypes.decorator,  // For shebangs
};

/**
 * Extract capture names from tree-sitter queries
 */
function extractCaptureNames(queriesText: string): Set<string> {
  const captureRegex = /@(\w+(?:\.\w+)*)/g;
  const captureNames = new Set<string>();
  let match;

  while ((match = captureRegex.exec(queriesText)) !== null) {
    if (match[1]) {
      captureNames.add(match[1]);
    }
  }

  return captureNames;
}

/**
 * Map tree-sitter capture name to LSP semantic token type
 */
function mapCaptureToTokenType(captureName: string): string {
  // Check direct mapping
  if (CAPTURE_TO_TOKEN_MAPPINGS[captureName]) {
    return CAPTURE_TO_TOKEN_MAPPINGS[captureName];
  }

  // Check base name for dotted captures (e.g., "string.escape" -> "string")
  const baseName = captureName.split('.')[0];
  if (baseName && CAPTURE_TO_TOKEN_MAPPINGS[baseName]) {
    return CAPTURE_TO_TOKEN_MAPPINGS[baseName];
  }

  // Default fallback
  return SemanticTokenTypes.variable;
}

/**
 * Generate semantic tokens legend from tree-sitter queries
 */
function generateDynamicLegendFromTreeSitter(): SemanticTokensLegend {
  const captureNames = extractCaptureNames(highlights);
  const tokenTypes = new Set<string>();

  // Map all capture names to token types
  for (const captureName of captureNames) {
    const tokenType = mapCaptureToTokenType(captureName);
    tokenTypes.add(tokenType);
  }

  // Add additional semantic token types that we detect programmatically
  // (not captured by tree-sitter queries but detected by our enhanced analysis)
  tokenTypes.add(SemanticTokenTypes.event);      // For emit and --on-event
  tokenTypes.add(SemanticTokenTypes.parameter);  // For function arguments and flags
  tokenTypes.add(SemanticTokenTypes.property);   // For file paths
  tokenTypes.add(SemanticTokenTypes.decorator);  // For shebangs

  return {
    tokenTypes: Array.from(tokenTypes).sort(),
    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
  };
}

/**
 * Legend that defines the semantic tokens supported by the Fish LSP
 */
export const FISH_SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = generateDynamicLegendFromTreeSitter();

/**
 * Get token type index from legend
 */
export function getTokenTypeIndex(tokenType: string): number {
  return FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf(tokenType);
}

/**
 * Get modifier index from legend
 */
export function getModifierIndex(modifier: string): number {
  return FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
}

/**
 * Calculate modifiers bitmask from modifier names
 */
export function calculateModifiersMask(modifiers: string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    const index = getModifierIndex(modifier);
    if (index !== -1) {
      mask |= 1 << index;
    }
  }
  return mask;
}

/**
 * Get modifiers from bitmask (reverse lookup)
 */
export function getModifiersFromMask(mask: number): string[] {
  const modifiers: string[] = [];
  for (let i = 0; i < FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.length; i++) {
    const modifier = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers[i];
    if (modifier && mask & 1 << i) {
      modifiers.push(modifier);
    }
  }
  return modifiers;
}

/**
 * Get capture name to token type mapping for tree-sitter queries
 */
export function getCaptureToTokenMapping(): Record<string, { tokenType: string; index: number; }> {
  const captureNames = extractCaptureNames(highlights);
  const mapping: Record<string, { tokenType: string; index: number; }> = {};

  for (const captureName of captureNames) {
    const tokenType = mapCaptureToTokenType(captureName);
    const index = getTokenTypeIndex(tokenType);

    mapping[captureName] = {
      tokenType,
      index,
    };
  }

  return mapping;
}

/**
 * Check if a string node contains variable expansions or command substitutions
 * that should take precedence over the string token
 */
function containsVariableExpansionsOrCommands(node: SyntaxNode): boolean {
  function hasNestedExpansions(n: SyntaxNode): boolean {
    // Check if this node is a variable expansion or command substitution
    if (n.type === 'variable_expansion' || n.type === 'command_substitution') {
      return true;
    }

    // Recursively check all children
    for (const child of n.namedChildren) {
      if (hasNestedExpansions(child)) {
        return true;
      }
    }

    return false;
  }

  return hasNestedExpansions(node);
}

/**
 * Add partial string tokens for parts of a string that don't contain expansions
 * This allows commands inside strings to be highlighted properly while still
 * highlighting the string parts as strings
 */
function addPartialStringTokens(
  tokens: SemanticToken[],
  stringNode: SyntaxNode,
  document: LspDocument,
  stringTokenTypeIndex: number,
): void {
  // Get all expansion nodes within this string
  const expansions: SyntaxNode[] = [];

  function collectExpansions(node: SyntaxNode) {
    if (node.type === 'variable_expansion' || node.type === 'command_substitution') {
      expansions.push(node);
      return; // Don't recurse into expansions
    }

    for (const child of node.namedChildren) {
      collectExpansions(child);
    }
  }

  collectExpansions(stringNode);

  if (expansions.length === 0) {
    // No expansions found, create a normal string token
    tokens.push({
      line: stringNode.startPosition.row,
      startChar: stringNode.startPosition.column,
      length: stringNode.endIndex - stringNode.startIndex,
      tokenType: stringTokenTypeIndex,
      tokenModifiers: 0,
    });
    return;
  }

  // Sort expansions by position
  expansions.sort((a, b) => {
    if (a.startPosition.row !== b.startPosition.row) {
      return a.startPosition.row - b.startPosition.row;
    }
    return a.startPosition.column - b.startPosition.column;
  });

  // Create string tokens for the gaps between expansions
  let lastEnd = stringNode.startIndex;

  for (const expansion of expansions) {
    // Add string token before this expansion
    if (expansion.startIndex > lastEnd) {
      const gapStart = lastEnd;
      const gapEnd = expansion.startIndex;
      const gapLength = gapEnd - gapStart;

      if (gapLength > 0) {
        // Convert byte offset to line/column position
        const content = document.getText();
        const gapStartPos = getPositionFromOffset(content, gapStart);

        tokens.push({
          line: gapStartPos.line,
          startChar: gapStartPos.character,
          length: gapLength,
          tokenType: stringTokenTypeIndex,
          tokenModifiers: 0,
        });
      }
    }

    lastEnd = expansion.endIndex;
  }

  // Add string token after the last expansion
  if (lastEnd < stringNode.endIndex) {
    const gapStart = lastEnd;
    const gapEnd = stringNode.endIndex;
    const gapLength = gapEnd - gapStart;

    if (gapLength > 0) {
      const content = document.getText();
      const gapStartPos = getPositionFromOffset(content, gapStart);

      tokens.push({
        line: gapStartPos.line,
        startChar: gapStartPos.character,
        length: gapLength,
        tokenType: stringTokenTypeIndex,
        tokenModifiers: 0,
      });
    }
  }
}

/**
 * Convert byte offset to line/column position
 */
function getPositionFromOffset(content: string, offset: number): { line: number; character: number; } {
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

/**
 * Enhanced semantic token provider using tree-sitter queries
 */
export function provideTreeSitterSemanticTokens(
  document: LspDocument,
  range?: Range,
  useOverlappingTokens: boolean = true, // Changed to false to enable conflict resolution
): SemanticTokens {
  // Ensure the document is analyzed
  analyzer.analyze(document);
  const tree = analyzer.cache.getParsedTree(document.uri);
  if (!tree) {
    logger.warning(`No parse tree available for document: ${document.uri}`);
    return { data: [] };
  }

  const lang = tree.getLanguage();
  const queries = getQueriesList(highlights); // Remove the embedded query
  const queryCaptures: QueryCapture[] = [];
  const mapping = getCaptureToTokenMapping();

  // Execute all queries and collect captures
  for (const queryText of queries) {
    try {
      const query = lang.query(queryText);
      const captures = query.captures(tree.rootNode);

      // Filter captures by range if specified
      if (range) {
        queryCaptures.push(...captures.filter((capture: QueryCapture) =>
          nodeIntersectsRange(capture.node, range),
        ));
      } else {
        queryCaptures.push(...captures);
      }
    } catch (error) {
      logger.warning(`Failed to execute query: ${queryText}`, error);
    }
  }

  // Collect all tokens (including overlapping ones if supported)
  const allTokens: SemanticToken[] = [];

  // Process tree-sitter captures with smart string handling
  for (const capture of queryCaptures) {
    const captureMapping = mapping[capture.name];
    if (!captureMapping || captureMapping.index === -1) {
      continue;
    }

    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(capture.node, range)) {
      continue;
    }

    // Smart string token handling: for strings containing expansions, create partial string tokens
    if (capture.name === 'string' && containsVariableExpansionsOrCommands(capture.node)) {
      // Instead of skipping entirely, add partial string tokens for the non-expansion parts
      addPartialStringTokens(allTokens, capture.node, document, captureMapping.index);
      continue;
    }

    // Determine modifiers based on capture name and node context
    const modifiers = getModifiersForCapture(capture, document);
    const modifiersMask = calculateModifiersMask(modifiers);

    allTokens.push({
      line: capture.node.startPosition.row,
      startChar: capture.node.startPosition.column,
      length: capture.node.endIndex - capture.node.startIndex,
      tokenType: captureMapping.index,
      tokenModifiers: modifiersMask,
    });
  }

  // Add tokens for command substitutions (embedded commands)
  addCommandSubstitutionTokensToArray(allTokens, tree.rootNode, document, range);

  // Add variable definition tokens with enhanced detection
  addDefinitionSymbolTokensToArray(allTokens, document, range);

  // Add custom operator tokens (-- and pipe/redirect operators)
  addCustomOperatorTokensToArray(allTokens, tree.rootNode, document, range);

  // Add fish-lsp directive tokens (nested keywords in comments)
  addFishLspDirectiveTokensToArray(allTokens, tree.rootNode, document, range);

  // Add additional semantic tokens
  addShebangTokensToArray(allTokens, tree.rootNode, document, range);
  addPathTokensToArray(allTokens, tree.rootNode, document, range);
  addFlagAndArgumentTokensToArray(allTokens, tree.rootNode, document, range);
  addSemicolonTokensToArray(allTokens, tree.rootNode, document, range);
  addBracketMatchingTokensToArray(allTokens, tree.rootNode, document, range);
  addConcatenatedAssignmentTokensToArray(allTokens, tree.rootNode, document, range);
  addUnrecognizedCommandArgumentsToArray(allTokens, tree.rootNode, document, range);
  addSubcommandTokensToArray(allTokens, tree.rootNode, document, range);

  // Convert tokens to LSP format
  if (useOverlappingTokens) {
    return buildOverlappingSemanticTokens(allTokens);
  } else {
    return buildNonOverlappingSemanticTokens(allTokens);
  }
}

/**
 * Check if a syntax node intersects with a given range
 */
function nodeIntersectsRange(node: SyntaxNode, range: Range): boolean {
  const nodeStart = Position.create(node.startPosition.row, node.startPosition.column);
  const nodeEnd = Position.create(node.endPosition.row, node.endPosition.column);

  // Check if node intersects with the range
  return !(
    nodeEnd.line < range.start.line ||
    nodeEnd.line === range.start.line && nodeEnd.character < range.start.character ||
    nodeStart.line > range.end.line ||
    nodeStart.line === range.end.line && nodeStart.character > range.end.character
  );
}

/**
 * Build overlapping semantic tokens (for clients that support it)
 */
function buildOverlappingSemanticTokens(tokens: SemanticToken[]): SemanticTokens {
  const builder = new SemanticTokensBuilder();

  // Sort tokens by position to ensure proper ordering
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.startChar !== b.startChar) return a.startChar - b.startChar;
    // If same position, sort by length (shorter tokens first for better delta encoding)
    return a.length - b.length;
  });

  for (const token of sortedTokens) {
    builder.push(
      token.line,
      token.startChar,
      token.length,
      token.tokenType,
      token.tokenModifiers,
    );
  }

  return builder.build();
}

/**
 * Get token type priority for conflict resolution
 * Higher numbers = higher priority (more specific tokens)
 * Now considers modifiers for more nuanced priority calculation
 */
function getTokenTypePriority(tokenTypeIndex: number, modifiersMask: number = 0): number {
  const tokenTypesArray = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes;
  const tokenType = tokenTypesArray[tokenTypeIndex];

  if (!tokenType) {
    return 30; // Default priority for unknown types
  }

  // Check modifiers first - they can dramatically change priority
  const pathModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('path');
  const filenameModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('filename');
  const definitionModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');

  // Path/filename modifiers override everything except variables with definition modifier
  if (modifiersMask > 0) {
    // Variables with definition modifier have absolute highest priority
    if (tokenType === 'variable' && definitionModifierIndex !== -1 && modifiersMask & 1 << definitionModifierIndex) {
      return 130;
    }

    // Check if path modifier is set (for any token with path modifier)
    if (pathModifierIndex !== -1 && modifiersMask & 1 << pathModifierIndex) {
      // Paths should have highest priority to override everything except variable definitions
      return 120;
    }

    // Check if filename modifier is set (for any token with filename modifier)
    if (filenameModifierIndex !== -1 && modifiersMask & 1 << filenameModifierIndex) {
      // Files should also have very high priority
      return 115;
    }
  }

  // Define base priority hierarchy - more specific tokens should override generic ones
  const basePriorities: Record<string, number> = {
    // Highest priority: specific semantic elements
    operator: 110,       // Operators should have very high priority
    keyword: 105,        // Keywords (including fish-lsp directives) high priority
    decorator: 103,      // Shebangs high priority
    function: 100,
    method: 100,
    variable: 98,        // Variables should have higher priority than parameter and property tokens
    parameter: 95,       // Flags and arguments - lower than function to allow subcommands
    property: 90,        // File paths base - lower than variables so variables aren't overridden
    type: 80,
    class: 80,
    namespace: 80,
    event: 70,
    number: 50,
    comment: 40,
    // Base priority for generic tokens
    string: 30,          // Increased from 10 to allow string tokens to override some base tokens
    regexp: 10,
  };

  const priority = basePriorities[tokenType] || 30;
  return priority;
}

/**
 * Build non-overlapping semantic tokens using the standard SemanticTokensBuilder
 * with intelligent conflict resolution that prioritizes more specific tokens
 */
function buildNonOverlappingSemanticTokens(tokens: SemanticToken[]): SemanticTokens {
  const builder = new SemanticTokensBuilder();

  // Sort tokens by position
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.startChar - b.startChar;
  });

  // Group overlapping tokens and resolve conflicts by priority
  const resolvedTokens: SemanticToken[] = [];
  let i = 0;

  while (i < sortedTokens.length) {
    const currentToken = sortedTokens[i];
    if (!currentToken) break;

    const overlappingTokens = [currentToken];

    // Find all tokens that overlap with the current token
    let j = i + 1;
    while (j < sortedTokens.length) {
      const nextToken = sortedTokens[j];
      if (!nextToken) break;

      // Check if tokens overlap
      const currentEnd = currentToken.startChar + currentToken.length;
      const nextStart = nextToken.startChar;

      if (nextToken.line === currentToken.line && nextStart < currentEnd) {
        overlappingTokens.push(nextToken);
        j++;
      } else {
        break;
      }
    }

    // If multiple overlapping tokens, choose the one with highest priority
    if (overlappingTokens.length > 1) {
      const bestToken = overlappingTokens.reduce((best, token) => {
        const bestPriority = getTokenTypePriority(best.tokenType, best.tokenModifiers);
        const tokenPriority = getTokenTypePriority(token.tokenType, token.tokenModifiers);

        // If priorities are equal, prefer the longer token
        if (tokenPriority === bestPriority) {
          return token.length > best.length ? token : best;
        }

        return tokenPriority > bestPriority ? token : best;
      });

      resolvedTokens.push(bestToken);
    } else {
      resolvedTokens.push(currentToken);
    }

    // Move to the next non-overlapping position
    i = j > i + 1 ? j : i + 1;
  }

  // Use SemanticTokensBuilder for delta encoding
  for (const token of resolvedTokens) {
    builder.push(
      token.line,
      token.startChar,
      token.length,
      token.tokenType,
      token.tokenModifiers,
    );
  }

  return builder.build();
}

/**
 * Add semantic tokens for command substitutions (embedded commands)
 */
function addCommandSubstitutionTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const commandSubstitutions = findCommandSubstitutions(rootNode);

  for (const cmdSub of commandSubstitutions) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(cmdSub, range)) {
      continue;
    }

    // Get the inner content of the command substitution (between $( and ))
    const innerContent = cmdSub.namedChildren;

    for (const child of innerContent) {
      // Recursively process commands inside the substitution
      addCommandTokensFromNode(tokens, child, document, range);
    }
  }
}

/**
 * Find all command substitution nodes in the syntax tree
 */
function findCommandSubstitutions(node: SyntaxNode): SyntaxNode[] {
  const commandSubstitutions: SyntaxNode[] = [];

  function traverse(n: SyntaxNode) {
    if (n.type === 'command_substitution') {
      commandSubstitutions.push(n);
    }

    for (const child of n.namedChildren) {
      traverse(child);
    }
  }

  traverse(node);
  return commandSubstitutions;
}

/**
 * Add semantic tokens for commands and their components from a node
 * This includes variable definitions that may be inside command substitutions
 */
function addCommandTokensFromNode(
  tokens: SemanticToken[],
  node: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const lang = analyzer.parser.getLanguage();
  if (!lang) return;

  // Use the same tree-sitter queries as the main function
  const queries = getQueriesList(highlights);
  const mapping = getCaptureToTokenMapping();

  for (const queryText of queries) {
    try {
      const query = lang.query(queryText);
      const captures = query.captures(node);

      for (const capture of captures) {
        const captureMapping = mapping[capture.name];
        if (!captureMapping || captureMapping.index === -1) {
          continue;
        }

        // Skip if range is specified and node doesn't intersect
        if (range && !nodeIntersectsRange(capture.node, range)) {
          continue;
        }

        // Determine modifiers based on capture name and node context
        const modifiers = getModifiersForCapture(capture, document);
        const modifiersMask = calculateModifiersMask(modifiers);

        tokens.push({
          line: capture.node.startPosition.row,
          startChar: capture.node.startPosition.column,
          length: capture.node.endIndex - capture.node.startIndex,
          tokenType: captureMapping.index,
          tokenModifiers: modifiersMask,
        });
      }
    } catch (error) {
      logger.warning(`Failed to execute query for command substitution: ${queryText}`, error);
    }
  }

  // Also add definition symbols that may be within this command substitution
  // This ensures variable definitions like "set -lx var value" get proper highlighting
  const symbols = analyzer.cache.getFlatDocumentSymbols(document.uri);
  const variableTypeIndex = getTokenTypeIndex('variable');

  if (variableTypeIndex !== -1) {
    for (const symbol of symbols) {
      // Check if this symbol's focused node is within our command substitution node
      if (isNodeWithinNode(symbol.focusedNode, node)) {
        // Skip if range is specified and symbol doesn't intersect
        if (range && !nodeIntersectsRange(symbol.focusedNode, range)) {
          continue;
        }
        const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
        const modifiers: FishSemanticTokenModifier[] = getSymbolModifiers(symbol);
        const tokenIndex = getTokenTypeIndex(tokenTypeKey);

        if (tokenTypeKey === 'function') {
          const startChar = symbol.focusedNode.startPosition.column;
          let length = symbol.focusedNode.endIndex - symbol.focusedNode.startIndex;

          // Fix export variable definition range: only highlight the variable name, not value
          if (isExportVariableDefinitionName(symbol.focusedNode)) {
            const text = symbol.focusedNode.text;
            const equalIndex = text.indexOf('=');
            if (equalIndex !== -1) {
              length = equalIndex;
            }
          }

          tokens.push({
            line: symbol.focusedNode.startPosition.row,
            startChar: startChar,
            length: length,
            tokenType: tokenIndex,
            tokenModifiers: calculateModifiersMask(modifiers),
          });
        }
      }
    }
  }
}

/**
 * Check if childNode is within parentNode
 */
function isNodeWithinNode(childNode: SyntaxNode, parentNode: SyntaxNode): boolean {
  const childStart = childNode.startIndex;
  const childEnd = childNode.endIndex;
  const parentStart = parentNode.startIndex;
  const parentEnd = parentNode.endIndex;

  return childStart >= parentStart && childEnd <= parentEnd;
}

/**
 * Add variable definition tokens to array (instead of builder)
 * Handles proper range detection for export variables
 */
function addDefinitionSymbolTokensToArray(
  tokens: SemanticToken[],
  document: LspDocument,
  range?: Range,
): void {
  const symbols = analyzer.cache.getFlatDocumentSymbols(document.uri);
  for (const symbol of symbols) {
    // Skip symbols outside the range if range is specified
    if (range && !nodeIntersectsRange(symbol.focusedNode, range)) {
      continue;
    }
    const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
    const modifiers: FishSemanticTokenModifier[] = getSymbolModifiers(symbol);
    const tokenIndex = getTokenTypeIndex(tokenTypeKey);
    if (tokenIndex !== -1) {
      const startChar = symbol.focusedNode.startPosition.column;
      let length = symbol.focusedNode.endIndex - symbol.focusedNode.startIndex;

      // Fix export variable definition range: only highlight the variable name, not value
      if (isExportVariableDefinitionName(symbol.focusedNode)) {
        const text = symbol.focusedNode.text;
        const equalIndex = text.indexOf('=');
        if (equalIndex !== -1) {
          // Only highlight up to the = sign (exclude the value)
          length = equalIndex;
        }
      }

      tokens.push({
        line: symbol.focusedNode.startPosition.row,
        startChar: startChar,
        length: length,
        tokenType: tokenIndex,
        tokenModifiers: calculateModifiersMask(modifiers),
      });
    }
  }
}

/**
 * Get appropriate modifiers for a tree-sitter capture
 */
function getModifiersForCapture(capture: QueryCapture, _document: LspDocument): string[] {
  const modifiers: string[] = [];
  const { name, node } = capture;

  // Add modifiers based on capture name patterns
  if (name.includes('builtin') || name.includes('keyword')) {
    modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
    modifiers.push(FishSemanticTokenModifiers.builtin);
  }

  if (name.includes('definition') || name.includes('declaration')) {
    modifiers.push(FishSemanticTokenModifiers.definition);
  }

  if (name.includes('deprecated')) {
    modifiers.push(FishSemanticTokenModifiers.deprecated);
  }

  if (name.includes('readonly')) {
    modifiers.push(FishSemanticTokenModifiers.readonly);
  }

  // Add modifiers based on node context
  if (name === 'function') {
    // Check if this is a builtin command
    if (isCommand(node.parent!) && checkBuiltin(node.text)) {
      modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
      modifiers.push(FishSemanticTokenModifiers.builtin);
    }

    // Check if this is a function definition
    if (isFunctionDefinition(node.parent!)) {
      modifiers.push(FishSemanticTokenModifiers.definition);
    }

    if (isCommand(node.parent!) && node.parent?.firstNamedChild && isFishShippedFunctionName(node.parent.firstNamedChild)) {
      modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
    }
  }

  return modifiers;
}

/**
 * Check if a command is a Fish builtin with enhanced detection
 */
export function isBuiltinCommand(node: SyntaxNode): boolean {
  if (!isCommand(node)) return false;

  const commandName = node.firstNamedChild;
  if (!commandName || !isCommandName(commandName)) return false;

  return checkBuiltin(commandName.text);
}

/**
 * Add custom operator tokens to array
 * Handles -- operator (end stdin) and ensures pipe/redirect operators are properly tokenized
 */
function addCustomOperatorTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const operatorTypeIndex = getTokenTypeIndex('operator');
  if (operatorTypeIndex === -1) return;

  function findOperators(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    // Look for -- operator (end stdin) using the utility function
    if (isEndStdinCharacter(node)) {
      tokens.push({
        line: node.startPosition.row,
        startChar: node.startPosition.column,
        length: node.endIndex - node.startIndex,
        tokenType: operatorTypeIndex,
        tokenModifiers: 0,
      });
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findOperators(child);
    }
  }

  findOperators(rootNode);
}

/**
 * Add fish-lsp directive tokens to array
 * Handles nested keywords within fish-lsp directive comments
 */
function addFishLspDirectiveTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const keywordTypeIndex = getTokenTypeIndex('keyword');
  const commentTypeIndex = getTokenTypeIndex('comment');
  if (keywordTypeIndex === -1 || commentTypeIndex === -1) return;

  const fishLspDirectiveModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('fish-lsp-directive');
  const fishLspDirectiveModifierMask = fishLspDirectiveModifierIndex !== -1 ? 1 << fishLspDirectiveModifierIndex : 0;

  function findComments(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (node.type === 'comment') {
      const commentText = node.text;

      // Check if this is a fish-lsp directive comment
      const fishLspRegex = /@fish-lsp-(enable|disable)(?:-next-line)?/g;
      let match;

      while ((match = fishLspRegex.exec(commentText)) !== null) {
        const matchText = match[0];
        const matchStart = match.index;

        // Calculate the position of the directive within the comment
        const directiveStartChar = node.startPosition.column + matchStart;

        // Add the directive as a keyword token with fish-lsp-directive modifier
        tokens.push({
          line: node.startPosition.row,
          startChar: directiveStartChar,
          length: matchText.length,
          tokenType: keywordTypeIndex,
          tokenModifiers: fishLspDirectiveModifierMask,
        });
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findComments(child);
    }
  }

  findComments(rootNode);
}

/**
 * Add shebang tokens to array
 * Detects shebangs like #!/usr/bin/env fish using the utility function
 */
function addShebangTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const decoratorTypeIndex = getTokenTypeIndex('decorator');
  if (decoratorTypeIndex === -1) return;

  const shebangModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('shebang');
  const shebangModifierMask = shebangModifierIndex !== -1 ? 1 << shebangModifierIndex : 0;

  function findShebangs(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    // Use the utility function to detect shebangs
    if (isShebang(node)) {
      tokens.push({
        line: node.startPosition.row,
        startChar: node.startPosition.column,
        length: node.endIndex - node.startIndex,
        tokenType: decoratorTypeIndex,
        tokenModifiers: shebangModifierMask,
      });
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findShebangs(child);
    }
  }

  findShebangs(rootNode);
}

/**
 * Add flag and argument tokens to array
 * Detects flags like -la, --color, and their values
 * Also detects parameters in command substitutions
 */
function addFlagAndArgumentTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const parameterTypeIndex = getTokenTypeIndex('parameter');
  const operatorTypeIndex = getTokenTypeIndex('operator');
  // const stringTypeIndex = getTokenTypeIndex('string');
  if (parameterTypeIndex === -1) return;

  const flagModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('flag');
  const argumentModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('argument');
  const flagModifierMask = flagModifierIndex !== -1 ? 1 << flagModifierIndex : 0;
  const argumentModifierMask = argumentModifierIndex !== -1 ? 1 << argumentModifierIndex : 0;

  function findFlags(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (node.type === 'word') {
      const text = node.text;

      // Detect flags: start with - or --
      if (text.match(/^-[a-zA-Z]/)) {
        // Short flag like -la, -m, or -o=value
        const equalIndex = text.indexOf('=');
        if (equalIndex !== -1) {
          // Short flag with value: -o=value
          // Flag part (before =)
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: equalIndex,
            tokenType: parameterTypeIndex,
            tokenModifiers: flagModifierMask,
          });
          // = operator
          if (operatorTypeIndex !== -1) {
            tokens.push({
              line: node.startPosition.row,
              startChar: node.startPosition.column + equalIndex,
              length: 1,
              tokenType: operatorTypeIndex,
              tokenModifiers: 0,
            });
          }
          // Value part (after =) - analyze for type with string fallback
          const valueText = text.substring(equalIndex + 1);
          if (valueText.length > 0) {
            const valueAnalysis = analyzeValueType(valueText);
            const valueTypeIndex = getTokenTypeIndex(valueAnalysis.tokenType);
            let valueModifiersMask = 0;

            if (valueAnalysis.modifiers && valueTypeIndex !== -1) {
              valueModifiersMask = valueAnalysis.modifiers.reduce((mask, modifier) => {
                const modifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
                return modifierIndex !== -1 ? mask | 1 << modifierIndex : mask;
              }, 0);
            }

            if (valueTypeIndex !== -1) {
              tokens.push({
                line: node.startPosition.row,
                startChar: node.startPosition.column + equalIndex + 1,
                length: valueText.length,
                tokenType: valueTypeIndex,
                tokenModifiers: valueModifiersMask,
              });
            }
          }
        } else {
          // Short flag without value
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: node.endIndex - node.startIndex,
            tokenType: parameterTypeIndex,
            tokenModifiers: flagModifierMask,
          });
        }
      } else if (text.match(/^--[a-zA-Z]/)) {
        // Long flag like --color, --debug-level
        // Check if it has a value (contains =)
        const equalIndex = text.indexOf('=');
        if (equalIndex !== -1) {
          // Flag part (before =)
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: equalIndex,
            tokenType: parameterTypeIndex,
            tokenModifiers: flagModifierMask,
          });
          // = operator
          if (operatorTypeIndex !== -1) {
            tokens.push({
              line: node.startPosition.row,
              startChar: node.startPosition.column + equalIndex,
              length: 1,
              tokenType: operatorTypeIndex,
              tokenModifiers: 0,
            });
          }
          // Value part (after =) - analyze for type with string fallback
          const valueText = text.substring(equalIndex + 1);
          if (valueText.length > 0) {
            const valueAnalysis = analyzeValueType(valueText);
            const valueTypeIndex = getTokenTypeIndex(valueAnalysis.tokenType);
            let valueModifiersMask = 0;

            if (valueAnalysis.modifiers && valueTypeIndex !== -1) {
              valueModifiersMask = valueAnalysis.modifiers.reduce((mask, modifier) => {
                const modifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
                return modifierIndex !== -1 ? mask | 1 << modifierIndex : mask;
              }, 0);
            }

            if (valueTypeIndex !== -1) {
              tokens.push({
                line: node.startPosition.row,
                startChar: node.startPosition.column + equalIndex + 1,
                length: valueText.length,
                tokenType: valueTypeIndex,
                tokenModifiers: valueModifiersMask,
              });
            }
          }
        } else {
          // Flag without value
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: node.endIndex - node.startIndex,
            tokenType: parameterTypeIndex,
            tokenModifiers: flagModifierMask,
          });
        }
      }
    }

    // Handle concatenation nodes (flag + string value)
    if (node.type === 'concatenation') {
      const children = node.namedChildren;
      if (children.length >= 2) {
        const firstChild = children[0];
        if (firstChild && firstChild.type === 'word' && firstChild.text.match(/^--[a-zA-Z].*=$/)) {
          // Flag part (remove the trailing =)
          const flagText = firstChild.text.slice(0, -1);
          tokens.push({
            line: firstChild.startPosition.row,
            startChar: firstChild.startPosition.column,
            length: flagText.length,
            tokenType: parameterTypeIndex,
            tokenModifiers: flagModifierMask,
          });

          // = operator
          if (operatorTypeIndex !== -1) {
            tokens.push({
              line: firstChild.startPosition.row,
              startChar: firstChild.startPosition.column + flagText.length,
              length: 1,
              tokenType: operatorTypeIndex,
              tokenModifiers: 0,
            });
          }

          // String value part - already handled as string by tree-sitter
        }
      }
    }

    // Handle command substitutions - detect parameters in subcommands
    if (node.type === 'command_substitution') {
      // Find commands within the substitution
      for (const child of node.namedChildren) {
        if (isCommand(child)) {
          // Skip the first child (command name), mark others as parameters
          const commandChildren = child.namedChildren;
          if (commandChildren.length > 1) {
            for (let i = 1; i < commandChildren.length; i++) {
              const arg = commandChildren[i];
              if (arg && arg.type === 'word' && !arg.text.startsWith('-')) {
                // This is a subcommand argument
                tokens.push({
                  line: arg.startPosition.row,
                  startChar: arg.startPosition.column,
                  length: arg.endIndex - arg.startIndex,
                  tokenType: parameterTypeIndex,
                  tokenModifiers: argumentModifierMask,
                });
              }
            }
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findFlags(child);
    }
  }

  findFlags(rootNode);
}

/**
 * Add file path and filename tokens to array
 * Uses property token type with path/filename modifiers for highest priority
 */
function addPathTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const propertyTypeIndex = getTokenTypeIndex('property');
  if (propertyTypeIndex === -1) return;

  const pathModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('path');
  const filenameModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('filename');
  const pathModifierMask = pathModifierIndex !== -1 ? 1 << pathModifierIndex : 0;
  const filenameModifierMask = filenameModifierIndex !== -1 ? 1 << filenameModifierIndex : 0;

  function findPaths(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (node.type === 'word') {
      const text = node.text;

      // Detect absolute paths - use property token type with path/filename modifier for highest priority
      if (text.match(/^\/[a-zA-Z0-9_\-\/\.]+/)) {
        const isFilename = text.match(/\.[a-zA-Z0-9]+$/) && !text.endsWith('/');

        if (isFilename) {
          // Files with extensions use property type with filename modifier
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: node.endIndex - node.startIndex,
            tokenType: propertyTypeIndex,
            tokenModifiers: filenameModifierMask,
          });
        } else {
          // Directories and paths use property type with path modifier for highest priority
          tokens.push({
            line: node.startPosition.row,
            startChar: node.startPosition.column,
            length: node.endIndex - node.startIndex,
            tokenType: propertyTypeIndex,
            tokenModifiers: pathModifierMask,
          });
        }
      } else if (text.match(/^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/)) {
        // Detect relative paths with file extensions - use property type with filename modifier
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.endIndex - node.startIndex,
          tokenType: propertyTypeIndex,
          tokenModifiers: filenameModifierMask,
        });
      } else if (text.match(/^~(\/[a-zA-Z0-9_\-\/\.]*)?$/)) {
        // Detect home directory paths - use property type with path modifier
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.endIndex - node.startIndex,
          tokenType: propertyTypeIndex,
          tokenModifiers: pathModifierMask,
        });
      }
    }

    // Handle home directory expansions - use property type with path modifier
    if (node.type === 'home_dir_expansion') {
      tokens.push({
        line: node.startPosition.row,
        startChar: node.startPosition.column,
        length: node.endIndex - node.startIndex,
        tokenType: propertyTypeIndex,
        tokenModifiers: pathModifierMask,
      });
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findPaths(child);
    }
  }

  findPaths(rootNode);
}

/**
 * Add semicolon tokens to array
 * Ignores semicolons inside comments
 */
function addSemicolonTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const operatorTypeIndex = getTokenTypeIndex('operator');
  if (operatorTypeIndex === -1) return;

  function findSemicolons(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    // Skip processing if we're inside a comment node
    if (node.type === 'comment') {
      return;
    }

    // Look for semicolon characters in text nodes, but not in comments
    if (node.type === 'word' || node.type === ';') {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ';') {
          // Double-check we're not in a comment by checking parent nodes
          let currentNode = node.parent;
          let inComment = false;
          while (currentNode) {
            if (currentNode.type === 'comment') {
              inComment = true;
              break;
            }
            currentNode = currentNode.parent;
          }

          if (!inComment) {
            tokens.push({
              line: node.startPosition.row,
              startChar: node.startPosition.column + i,
              length: 1,
              tokenType: operatorTypeIndex,
              tokenModifiers: 0,
            });
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findSemicolons(child);
    }
  }

  findSemicolons(rootNode);
}

/**
 * Add bracket matching tokens to array
 * Highlights both [ and ] as function tokens when used as test commands
 */
function addBracketMatchingTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const functionTypeIndex = getTokenTypeIndex('function');
  if (functionTypeIndex === -1) return;

  function findBrackets(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    // Look for test commands using [ ]
    if (isCommand(node)) {
      const commandChildren = node.namedChildren;
      if (commandChildren.length > 0) {
        const firstChild = commandChildren[0];
        // If first child is [ (test command), find matching ]
        if (firstChild && firstChild.type === 'word' && firstChild.text === '[') {
          // Look for closing ] as the last word token in the command
          for (const child of commandChildren) {
            if (child && child.type === 'word' && child.text === ']') {
              // Highlight closing ] as function to match opening [
              tokens.push({
                line: child.startPosition.row,
                startChar: child.startPosition.column,
                length: 1,
                tokenType: functionTypeIndex,
                tokenModifiers: 0,
              });
            }
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findBrackets(child);
    }
  }

  findBrackets(rootNode);
}

/**
 * Add concatenated assignment tokens to array
 * Handles alias f=foo and export p=PATH properly, including complex aliases with quotes
 */
function addConcatenatedAssignmentTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  _document: LspDocument,
  range?: Range,
): void {
  const operatorTypeIndex = getTokenTypeIndex('operator');
  const stringTypeIndex = getTokenTypeIndex('string');
  const parameterTypeIndex = getTokenTypeIndex('parameter');
  if (operatorTypeIndex === -1 || stringTypeIndex === -1 || parameterTypeIndex === -1) return;

  const argumentModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('argument');
  const argumentModifierMask = argumentModifierIndex !== -1 ? 1 << argumentModifierIndex : 0;

  function findAssignments(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (isCommand(node)) {
      const commandChildren = node.namedChildren;
      if (commandChildren.length >= 2) {
        const firstChild = commandChildren[0];
        const secondChild = commandChildren[1];

        // Handle simple assignments: alias f=foo, export p=PATH
        if (firstChild && firstChild.type === 'word' &&
          ['alias', 'export'].includes(firstChild.text) &&
          secondChild && secondChild.type === 'word' &&
          secondChild.text.includes('=')) {
          const assignmentText = secondChild.text;
          const equalIndex = assignmentText.indexOf('=');

          if (equalIndex !== -1) {
            // Variable name part (before =) as parameter
            tokens.push({
              line: secondChild.startPosition.row,
              startChar: secondChild.startPosition.column,
              length: equalIndex,
              tokenType: parameterTypeIndex,
              tokenModifiers: argumentModifierMask,
            });

            // Add = operator
            tokens.push({
              line: secondChild.startPosition.row,
              startChar: secondChild.startPosition.column + equalIndex,
              length: 1,
              tokenType: operatorTypeIndex,
              tokenModifiers: 0,
            });

            // Add value with intelligent type detection (after =)
            const valueText = assignmentText.substring(equalIndex + 1);
            if (valueText.length > 0) {
              const valueAnalysis = analyzeValueType(valueText);
              const valueTypeIndex = getTokenTypeIndex(valueAnalysis.tokenType);
              let valueModifiersMask = 0;

              if (valueAnalysis.modifiers && valueTypeIndex !== -1) {
                valueModifiersMask = valueAnalysis.modifiers.reduce((mask, modifier) => {
                  const modifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
                  return modifierIndex !== -1 ? mask | 1 << modifierIndex : mask;
                }, 0);
              }

              if (valueTypeIndex !== -1) {
                tokens.push({
                  line: secondChild.startPosition.row,
                  startChar: secondChild.startPosition.column + equalIndex + 1,
                  length: valueText.length,
                  tokenType: valueTypeIndex,
                  tokenModifiers: valueModifiersMask,
                });
              }
            }
          }
        } else if (firstChild && firstChild.type === 'word' &&
          // Handle complex assignments with concatenation: alias g='grep --color=auto'
          ['alias', 'export'].includes(firstChild.text) &&
          secondChild && secondChild.type === 'concatenation') {
          const concatChildren = secondChild.namedChildren;
          if (concatChildren.length >= 2) {
            const varPart = concatChildren[0];
            // Check if first part ends with = (like "g=")
            if (varPart && varPart.type === 'word' && varPart.text.endsWith('=')) {
              const varName = varPart.text.slice(0, -1); // Remove =

              // Variable name part as parameter
              tokens.push({
                line: varPart.startPosition.row,
                startChar: varPart.startPosition.column,
                length: varName.length,
                tokenType: parameterTypeIndex,
                tokenModifiers: argumentModifierMask,
              });

              // = operator
              tokens.push({
                line: varPart.startPosition.row,
                startChar: varPart.startPosition.column + varName.length,
                length: 1,
                tokenType: operatorTypeIndex,
                tokenModifiers: 0,
              });

              // The quoted string value is already handled by tree-sitter
            }
          }
        }
      }
    }

    // Handle string continuation with escape sequences (like --opt=str1\ str2)
    if (node.type === 'concatenation') {
      let foundEscapeSequence = false;
      let hasOptionPrefix = false;

      // Check if this concatenation starts with an option (contains =)
      const children = node.namedChildren;
      if (children.length > 0 && children[0] && children[0].type === 'word') {
        const firstText = children[0].text;
        if (firstText.includes('=')) {
          hasOptionPrefix = true;
        }
      }

      // Look for escape sequences in the concatenation
      for (const child of children) {
        if (child && child.type === 'escape_sequence' && child.text.includes(' ')) {
          foundEscapeSequence = true;
          break;
        }
      }

      // If we have both an option prefix and escape sequence, highlight continuation parts as strings
      if (hasOptionPrefix && foundEscapeSequence) {
        let afterEscape = false;
        for (const child of children) {
          if (child && child.type === 'escape_sequence') {
            afterEscape = true;
          } else if (afterEscape && child && child.type === 'word') {
            // This word comes after an escape sequence, so analyze its type
            const valueAnalysis = analyzeValueType(child.text);
            const valueTypeIndex = getTokenTypeIndex(valueAnalysis.tokenType);
            let valueModifiersMask = 0;

            if (valueAnalysis.modifiers && valueTypeIndex !== -1) {
              valueModifiersMask = valueAnalysis.modifiers.reduce((mask, modifier) => {
                const modifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
                return modifierIndex !== -1 ? mask | 1 << modifierIndex : mask;
              }, 0);
            }

            if (valueTypeIndex !== -1) {
              tokens.push({
                line: child.startPosition.row,
                startChar: child.startPosition.column,
                length: child.endIndex - child.startIndex,
                tokenType: valueTypeIndex,
                tokenModifiers: valueModifiersMask,
              });
            }
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findAssignments(child);
    }
  }

  findAssignments(rootNode);
}

/**
 * Add unrecognized command arguments to array
 * Highlights arguments for commands that aren't recognized builtins
 */
function addUnrecognizedCommandArgumentsToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const parameterTypeIndex = getTokenTypeIndex('parameter');
  if (parameterTypeIndex === -1) return;

  const argumentModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('argument');
  const argumentModifierMask = argumentModifierIndex !== -1 ? 1 << argumentModifierIndex : 0;

  function findUnrecognizedCommands(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (isCommand(node)) {
      const commandChildren = node.namedChildren;
      if (commandChildren.length > 1) {
        const commandName = commandChildren[0];

        // Check if this is an unrecognized command (not a builtin/known function)
        if (commandName && commandName.type === 'word') {
          const cmdText = commandName.text;
          // Simple heuristic: if it's not a common builtin and has arguments
          if (!['echo', 'set', 'ls', 'cat', 'grep', 'git', 'cd', 'pwd', 'cp', 'mv', 'rm', 'mkdir', 'fish', 'test', '['].includes(cmdText)) {
            // Highlight all arguments
            for (let i = 1; i < commandChildren.length; i++) {
              const arg = commandChildren[i];
              if (arg && arg.type === 'word' && !arg.text.startsWith('-')) {
                tokens.push({
                  line: arg.startPosition.row,
                  startChar: arg.startPosition.column,
                  length: arg.endIndex - arg.startIndex,
                  tokenType: parameterTypeIndex,
                  tokenModifiers: argumentModifierMask,
                });
              }
            }
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findUnrecognizedCommands(child);
    }
  }

  findUnrecognizedCommands(rootNode);
}

/**
 * Analyze a text value and determine its semantic token type
 * Falls back to string if no specific type is detected
 */
function analyzeValueType(text: string): { tokenType: string; modifiers?: string[]; } {
  // Check for numbers (integer or float)
  if (/^\d+$/.test(text)) {
    return { tokenType: 'number' };
  }
  if (/^\d*\.\d+$/.test(text)) {
    return { tokenType: 'number' };
  }

  // Check for absolute paths - use property tokenType with path/filename modifier for high priority
  if (/^\/[a-zA-Z0-9_\-\/\.]*/.test(text)) {
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(text);
    if (hasExtension && !text.endsWith('/')) {
      // Files with extensions use property with filename modifier
      return {
        tokenType: 'property',
        modifiers: ['filename'],
      };
    } else {
      // Directories and paths use property with path modifier
      return {
        tokenType: 'property',
        modifiers: ['path'],
      };
    }
  }

  // Check for home directory paths - use property with path modifier
  if (/^~(\/[a-zA-Z0-9_\-\/\.]*)?$/.test(text)) {
    return {
      tokenType: 'property',
      modifiers: ['path'],
    };
  }

  // Check for relative paths with extensions (likely files)
  if (/^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/.test(text)) {
    return {
      tokenType: 'property',
      modifiers: ['filename'],
    };
  }

  // Check for URLs
  if (/^https?:\/\//.test(text)) {
    return { tokenType: 'string' }; // URLs as strings for now
  }

  // Check for boolean-like values
  if (/^(true|false|yes|no|on|off)$/i.test(text)) {
    return { tokenType: 'keyword' };
  }

  // Check for environment variable references
  if (/^\$[A-Z_][A-Z0-9_]*$/i.test(text)) {
    return { tokenType: 'variable' };
  }

  // Fallback to string
  return { tokenType: 'string' };
}

/**
 * Add subcommand tokens for special commands
 * Highlights subcommands for builtin/functions/command as function tokens
 */
function addSubcommandTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const functionTypeIndex = getTokenTypeIndex('function');
  if (functionTypeIndex === -1) return;

  // Commands that take subcommands as their first argument
  const subcommandHosts = ['builtin', 'command', 'functions', 'type'];

  function findSubcommands(node: SyntaxNode) {
    // Skip if range is specified and node doesn't intersect
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    if (isCommand(node)) {
      const commandChildren = node.namedChildren;
      if (commandChildren.length >= 2) {
        const firstChild = commandChildren[0];
        const secondChild = commandChildren[1];

        // Check if the first child is a subcommand host
        if (firstChild && firstChild.type === 'word' &&
          subcommandHosts.includes(firstChild.text) &&
          secondChild && secondChild.type === 'word') {
          const subcommandText = secondChild.text;

          // Don't highlight flags as subcommands
          if (!subcommandText.startsWith('-')) {
            tokens.push({
              line: secondChild.startPosition.row,
              startChar: secondChild.startPosition.column,
              length: secondChild.endIndex - secondChild.startIndex,
              tokenType: functionTypeIndex,
              tokenModifiers: 0,
            });
          }
        }
      }
    }

    // Recursively process child nodes
    for (const child of node.namedChildren) {
      findSubcommands(child);
    }
  }

  findSubcommands(rootNode);
}
