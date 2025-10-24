import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { isBuiltinCommand, isCommand, isCommandWithName, isComment, isShebang, isEscapeSequence, isOption } from './utils/node-types';
import { getTokenTypeIndex, SemanticToken, calculateModifiersMask, getQueriesList, getCaptureToTokenMapping, FISH_SEMANTIC_TOKENS_LEGEND } from './utils/semantics';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';
import { getChildNodes } from './utils/tree-sitter';
import { highlights } from '@ndonfris/tree-sitter-fish';
import { isBuiltin } from './utils/builtins';
import { config } from './config';

// Re-export for tests and external usage
export { FISH_SEMANTIC_TOKENS_LEGEND };

// ============================================================================
// Type Definitions
// ============================================================================

type TokenTransformContext = {
  tokens: SemanticToken[];
  document: LspDocument;
};

type NodeTokenHandler = [
  predicate: (node: SyntaxNode) => boolean,
  transform: (node: SyntaxNode, context: TokenTransformContext) => void,
];

type TextMatchPosition = {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  matchLength: number;
  matchText: string;
};


type TokenTypeKey = 'command' | 'function' | 'variable' | 'keyword' | 'decorator' | 'string' | 'operator';
const TokenTypes: Record<TokenTypeKey, number> = {
  command: getTokenTypeIndex('function')!,
  function: getTokenTypeIndex('function')!,
  variable: getTokenTypeIndex('variable')!,
  keyword: getTokenTypeIndex('keyword')!,
  decorator: getTokenTypeIndex('decorator')!,
  string: getTokenTypeIndex('string')!,
  operator: getTokenTypeIndex('operator')!,
};

const ModifierTypes: Record<TokenTypeKey, number> = {
  command: calculateModifiersMask('builtin', 'defaultLibrary')!,
  function: 0,
  variable: 0,
  keyword: 0,
  decorator: calculateModifiersMask('shebang'),
  string: 0,
  operator: 0,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Search for text within a SyntaxNode and return position information for matches
 * @param node - The SyntaxNode to search within
 * @param filter - String or RegExp to search for
 * @returns Array of TextMatchPosition objects for all matches
 */
function getTextMatchPositions(node: SyntaxNode, filter: string | RegExp): TextMatchPosition[] {
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
function calculatePositionFromOffset(
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
function createTokensFromMatches(
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
 * Get semantic token modifiers for a command based on its definition
 * @param commandName - The name of the command
 * @returns Bitmask of token modifiers
 */
function getCommandModifiers(commandName: string): number {
  // Check if it's a builtin command
  if (isBuiltin(commandName)) {
    // Note: We can't check isBuiltinCommand without a node, so builtins are handled separately
    return calculateModifiersMask('builtin', 'defaultLibrary');
  }

  // Look up the command in global symbols
  const symbols = analyzer.globalSymbols.find(commandName);

  if (symbols.length === 0) {
    // No definition found - could be an external command or not found
    return 0;
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

    return calculateModifiersMask(...modifiers);
  }

  // Check if it's an alias
  if (symbol.fishKind === 'ALIAS') {
    const modifiers: string[] = [];
    if (symbol.document.isAutoloaded() && symbol.scope.scopeTag === 'global') {
      modifiers.push('global');
    }
    modifiers.push('script');
    return calculateModifiersMask(...modifiers);
  }

  return 0;
}

// ============================================================================
// Token Transform Handlers Map
// ============================================================================

/**
 * Array of all semantic token transforms
 * Each entry is [predicate, transform]
 */
const semanticTokenHandlers: NodeTokenHandler[] = [
  // Special handling for `[` test command - highlight opening [ and closing ]
  [
    (node) => isCommandWithName(node, '['),
    (node, ctx) => {
      const firstChild = node.firstNamedChild;
      if (firstChild && firstChild.type === 'word') {
        // Find the opening [ and closing ] tokens within the word node
        const openBracket = firstChild.firstChild;
        if (openBracket && openBracket.type === '[') {
          ctx.tokens.push(
            SemanticToken.fromNode(openBracket, TokenTypes.function, ModifierTypes.function),
          );
        }
      }

      // Find the closing ] in the last argument
      const lastChild = node.lastNamedChild;
      if (lastChild && lastChild.type === 'word') {
        const closeBracket = lastChild.firstChild;
        if (closeBracket && closeBracket.type === ']') {
          ctx.tokens.push(
            SemanticToken.fromNode(closeBracket, TokenTypes.function, ModifierTypes.function),
          );
        }
      }
    },
  ],
  // Builtin commands (echo, set, read, etc.) - exclude 'alias' and '['
  [
    (node) => isBuiltinCommand(node) && !isCommandWithName(node, 'alias') && !isCommandWithName(node, '['),
    (node, ctx) => {
      // Builtins always get 'builtin' and 'defaultLibrary' modifiers
      ctx.tokens.push(
        SemanticToken.fromNode(
          node.firstNamedChild!,
          TokenTypes.function,
          calculateModifiersMask('builtin', 'defaultLibrary'),
        ),
      );
    },
  ],
  // Function calls and user-defined commands - exclude 'alias' and '['
  [
    (node) => isCommand(node) && !isBuiltinCommand(node) && !isCommandWithName(node, 'alias') && !isCommandWithName(node, '['),
    (node, ctx) => {
      const commandName = node.firstNamedChild?.text || '';
      const modifiers = getCommandModifiers(commandName);
      ctx.tokens.push(
        SemanticToken.fromNode(node.firstNamedChild!, TokenTypes.function, modifiers),
      );
    },
  ],

  // Shebang lines (#!/usr/bin/env fish)
  [
    isShebang,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.decorator, ModifierTypes.decorator),
      );
    },
  ],

  // @fish-lsp directives in comments
  [
    isComment,
    (node, ctx) => {
      ctx.tokens.push(
        ...createTokensFromMatches(
          getTextMatchPositions(node, /@fish-lsp-(enable|disable)(?:-next-line)?/g),
          TokenTypes.keyword,
          ModifierTypes.keyword,
        ),
      );
    },
  ],

  // Variable names (excludes leading $)
  [
    (node) => node.type === 'variable_name',
    (node, ctx) => {
      ctx.tokens.push(
        ...createTokensFromMatches(
          getTextMatchPositions(node, /[^$]+/),
          TokenTypes.variable,
        ),
      );
    },
  ],

  // Reserved keywords as specific node types (from tree-sitter grammar)
  [
    (node) => {
      const keywordNodeTypes = new Set([
        'if', 'else', 'end',
        'for', 'in',
        'while',
        'switch', 'case',
        'begin',
        'function',
        'and', 'or', 'not',
        'return', 'break', 'continue',
      ]);
      return keywordNodeTypes.has(node.type);
    },
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.keyword, ModifierTypes.keyword),
      );
    },
  ],

  // Special case: 'alias' keyword (appears as word node)
  [
    (node) => node.type === 'word' && node.text === 'alias',
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.keyword, ModifierTypes.keyword),
      );
    },
  ],

  // Escape sequences - distinguish line continuations from other escapes
  [
    isEscapeSequence,
    (node, ctx) => {
      // Line continuation is a backslash followed by newline: \\\n
      const isLineContinuation = node.text.includes('\n');
      const tokenType = isLineContinuation ? TokenTypes.operator : TokenTypes.string;

      ctx.tokens.push(
        SemanticToken.fromNode(node, tokenType, 0),
      );
    },
  ],

  // Plain word nodes (arguments, words in concatenations, etc.)
  // These should be highlighted as strings when they're not command names or options
  [
    (node) => {
      if (node.type !== 'word') return false;

      // Don't highlight if it's a command name (first child of command node)
      const parent = node.parent;
      if (parent && parent.type === 'command' && parent.firstNamedChild === node) {
        return false;
      }

      // Don't highlight if it's the 'alias' keyword (already handled)
      if (node.text === 'alias') return false;

      // Don't highlight if it's an option/flag (like -n, --flag, etc.)
      if (isOption(node)) return false;

      return true;
    },
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.string, 0),
      );
    },
  ]
];

/**
 * Mini mode handlers - only commands and keywords
 * Used when fish_lsp_semantic_handler_type is set to 'mini'
 */
const semanticTokenHandlersMini: NodeTokenHandler[] = [
  // Special handling for `[` test command
  semanticTokenHandlers[0],
  // Builtin commands
  semanticTokenHandlers[1],
  // User-defined commands
  semanticTokenHandlers[2],
];

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Semantic token handler that supports multiple modes based on config:
 *
 * **Full mode** (fish_lsp_semantic_handler_type = 'full'):
 * 1. FishSymbol highlighting (functions, variables, etc.)
 * 2. Builtin commands and user-defined commands
 * 3. Reserved keywords (if, else, end, for, while, switch, begin, and, or, not, etc.)
 * 4. Comment support with shebang and `# @fish-lsp` inline comment highlights
 * 5. Variable name highlighting (variable_name nodes, excluding leading $)
 * 6. Special keyword 'alias' for alias definitions
 * 7. Special handling for `[` test command (highlights brackets, not content)
 * 8. Fallback to highlights.scm queries for additional token types (operators, strings, etc.)
 * 9. String interpolation - highlights variables/commands within strings separately from string parts
 * 10. Escape sequences:
 *     - Line continuations (\<newline>) highlighted as operators
 *     - Other escapes (\n, \t, \', \", \\) highlighted as strings
 *
 * **Mini mode** (fish_lsp_semantic_handler_type = 'mini'):
 * 1. FishSymbol highlighting (functions, variables, etc.) - definitions only
 * 2. Commands (builtins and user-defined)
 * 3. Special handling for `[` test command
 *
 * **Off mode** (fish_lsp_semantic_handler_type = 'off'):
 * Returns empty tokens
 */
export function provideSemanticTokens(document: LspDocument): LSP.SemanticTokens {
  const mode = config.fish_lsp_semantic_handler_type;

  // Off mode - return empty tokens
  if (mode === 'off') {
    return { data: [] };
  }

  analyzer.analyze(document);
  const tree = analyzer.cache.getParsedTree(document.uri);

  if (!tree) {
    return { data: [] };
  }

  const tokens: SemanticToken[] = [];
  const context: TokenTransformContext = {
    tokens,
    document,
  };

  // Process FishSymbols
  processFishSymbols(context);

  // Choose handlers based on mode
  const handlers = mode === 'mini' ? semanticTokenHandlersMini : semanticTokenHandlers;

  // Process all syntax nodes in a single traversal
  const allNodes = getChildNodes(tree.rootNode);
  for (const node of allNodes) {
    for (const [predicate, transform] of handlers) {
      if (predicate(node)) {
        transform(node, context);
      }
    }
  }

  // Apply highlights.scm queries to fill in gaps (only in full mode)
  if (mode === 'full') {
    applyHighlightQueries(context, tree);
  }

  return buildTokens(tokens);
}

// Keep old name for backward compatibility
export const provideMiniSemanticTokens = provideSemanticTokens;

/**
 * Process all FishSymbols in the document
 * Note:
 * - Uses selectionRange for precise token positioning
 * - Excludes leading $ from variable names
 * - Excludes trailing = from export/alias definitions
 */
function processFishSymbols(context: TokenTransformContext): void {
  const symbols = analyzer.cache.getFlatDocumentSymbols(context.document.uri);

  for (const symbol of symbols) {
    // Skip symbols with null focusedNode
    if (!symbol.focusedNode) continue;

    const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
    const tokenIndex = getTokenTypeIndex(tokenTypeKey);

    if (tokenIndex === -1) continue;

    const modifiers = getSymbolModifiers(symbol);
    const modifiersMask = calculateModifiersMask(...modifiers);

    // Use selectionRange if available (more precise), otherwise fall back to focusedNode
    const range = symbol.selectionRange;
    const startRow = range.start.line;
    const startCol = range.start.character;
    let length = range.end.character - range.start.character;

    // Only add token if there's actual content
    if (length > 0) {
      context.tokens.push(
        SemanticToken.create(
          startRow,
          startCol,
          length,
          tokenIndex,
          modifiersMask,
        ),
      );
    }
  }
}

/**
 * Check if a string node contains variable expansions or command substitutions
 */
function containsVariableExpansionsOrCommands(node: SyntaxNode): boolean {
  if (node.type === 'variable_expansion' || node.type === 'command_substitution') {
    return true;
  }

  for (const child of node.namedChildren) {
    if (containsVariableExpansionsOrCommands(child)) {
      return true;
    }
  }

  return false;
}

/**
 * Add partial string tokens for strings containing variable expansions
 * This highlights the string parts separately from the variables
 */
function addPartialStringTokens(
  tokens: SemanticToken[],
  stringNode: SyntaxNode,
  stringTokenType: number,
  document: LspDocument,
): void {
  const expansions: SyntaxNode[] = [];

  function collectExpansions(node: SyntaxNode) {
    if (node.type === 'variable_expansion' || node.type === 'command_substitution') {
      expansions.push(node);
      return;
    }

    for (const child of node.namedChildren) {
      collectExpansions(child);
    }
  }

  collectExpansions(stringNode);

  if (expansions.length === 0) {
    tokens.push(SemanticToken.fromNode(stringNode, stringTokenType, 0));
    return;
  }

  // Sort expansions by position
  expansions.sort((a, b) => {
    if (a.startPosition.row !== b.startPosition.row) {
      return a.startPosition.row - b.startPosition.row;
    }
    return a.startPosition.column - b.startPosition.column;
  });

  const content = document.getText();
  let lastEnd = stringNode.startIndex;

  // Add string tokens for gaps between expansions
  for (const expansion of expansions) {
    if (expansion.startIndex > lastEnd) {
      const gapLength = expansion.startIndex - lastEnd;
      if (gapLength > 0) {
        const lines = content.substring(0, lastEnd).split('\n');
        const line = lines.length - 1;
        const char = lines[lines.length - 1]!.length;

        tokens.push(SemanticToken.create(
          line,
          char,
          gapLength,
          stringTokenType,
          0,
        ));
      }
    }
    lastEnd = expansion.endIndex;
  }

  // Add final string token after last expansion
  if (lastEnd < stringNode.endIndex) {
    const gapLength = stringNode.endIndex - lastEnd;
    if (gapLength > 0) {
      const lines = content.substring(0, lastEnd).split('\n');
      const line = lines.length - 1;
      const char = lines[lines.length - 1]!.length;

      tokens.push(SemanticToken.create(
        line,
        char,
        gapLength,
        stringTokenType,
        0,
      ));
    }
  }
}

/**
 * Check if a node's position is already covered by existing tokens
 */
function isNodeCoveredByTokens(node: SyntaxNode, tokens: SemanticToken[]): boolean {
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

/**
 * Apply highlights.scm queries to fill in gaps not covered by existing tokens
 */
function applyHighlightQueries(context: TokenTransformContext, tree: any): void {
  const lang = analyzer.parser.getLanguage();
  if (!lang) return;

  const queries = getQueriesList(highlights);
  const mapping = getCaptureToTokenMapping();

  for (const queryText of queries) {
    // Skip test/[ command operator queries - we don't want to highlight test flags as operators
    // These queries match test command flags like -f, -d, -eq, etc. as operators
    // Patterns: (command name: ... argument: (word) @operator (#match? @operator "^(!?=|-[a-zA-Z]+)$"))
    if (queryText.includes('argument:') && queryText.includes('@operator') &&
        (queryText.includes('@function') || queryText.includes('@punctuation.bracket'))) {
      continue;
    }

    try {
      const query = lang.query(queryText);
      const captures = query.captures(tree.rootNode);

      for (const capture of captures) {
        const captureMapping = mapping[capture.name];
        if (!captureMapping || captureMapping.index === -1) {
          continue;
        }

        // Special handling for strings with variable expansions FIRST
        // (before checking if covered, because the variables inside will overlap)
        if (capture.name === 'string' && containsVariableExpansionsOrCommands(capture.node)) {
          addPartialStringTokens(context.tokens, capture.node, captureMapping.index, context.document);
          continue;
        }

        // Skip if this node is already covered by existing tokens
        if (isNodeCoveredByTokens(capture.node, context.tokens)) {
          continue;
        }

        // Add token from query
        context.tokens.push(
          SemanticToken.fromNode(capture.node, captureMapping.index, 0),
        );
      }
    } catch (_error) {
      // Silently skip failed queries
    }
  }
}

/**
 * Build the final SemanticTokens result
 */
function buildTokens(tokens: SemanticToken[]): LSP.SemanticTokens {
  const builder = new LSP.SemanticTokensBuilder();

  // Sort tokens by position
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.startChar !== b.startChar) return a.startChar - b.startChar;
    return a.length - b.length;
  });

  // Remove duplicates and overlaps (keep first occurrence)
  const uniqueTokens: SemanticToken[] = [];
  let lastEnd = { line: -1, char: -1 };

  for (const token of sortedTokens) {
    const tokenEnd = token.startChar + token.length;

    // Skip if this token overlaps with the previous one on the same line
    if (token.line === lastEnd.line && token.startChar < lastEnd.char) {
      continue;
    }

    uniqueTokens.push(token);
    lastEnd = { line: token.line, char: tokenEnd };
  }

  // Push tokens to builder
  for (const token of uniqueTokens) {
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
 * Create handler callbacks for LSP semantic tokens requests
 */
export function semanticTokensHandlerCallback() {
  return {
    semanticTokensHandler: (params: LSP.SemanticTokensParams) => {
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideSemanticTokens(document) : { data: [] };
    },
    semanticTokensRangeHandler: (params: LSP.SemanticTokensRangeParams) => {
      // Note: Handler doesn't support range-based tokens, so we return full document tokens
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideSemanticTokens(document) : { data: [] };
    },
  };
}

// Keep old name for backward compatibility
export const miniSemanticTokensHandlerCallback = semanticTokensHandlerCallback;
