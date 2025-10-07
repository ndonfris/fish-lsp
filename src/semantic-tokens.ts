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
  tokenTypes.add(SemanticTokenTypes.parameter);  // For function arguments

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
  useOverlappingTokens: boolean = true,
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
    return a.startChar - b.startChar;
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
 */
function getTokenTypePriority(tokenTypeIndex: number): number {
  const tokenTypesArray = Object.values(SemanticTokenTypes);
  const tokenType = tokenTypesArray[tokenTypeIndex];

  if (!tokenType) {
    return 30; // Default priority for unknown types
  }

  // Define priority hierarchy - more specific tokens should override generic ones
  const priorities: Record<string, number> = {
    // Highest priority: semantic elements
    function: 100,
    method: 100,
    variable: 90,
    parameter: 90,
    property: 90,
    keyword: 80,
    type: 80,
    class: 80,
    namespace: 80,
    event: 70,
    operator: 60,
    number: 50,
    comment: 40,
    // Lowest priority: generic tokens that should be overridden
    string: 10,
    regexp: 10,
  };

  return priorities[tokenType] || 30; // Default priority for unlisted types
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
        const bestPriority = getTokenTypePriority(best.tokenType);
        const tokenPriority = getTokenTypePriority(token.tokenType);

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
}

/**
 * Add variable definition tokens to array (instead of builder)
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
      tokens.push({
        line: symbol.focusedNode.startPosition.row,
        startChar: symbol.focusedNode.startPosition.column,
        length: symbol.focusedNode.endIndex - symbol.focusedNode.startIndex,
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
