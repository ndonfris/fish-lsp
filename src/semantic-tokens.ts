import * as LSP from 'vscode-languageserver';
import { SyntaxNode, Tree } from 'web-tree-sitter';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import {
  isBuiltinCommand,
  isCommand,
  isCommandWithName,
  isComment,
  isShebang,
  isEscapeSequence,
  isOption,
} from './utils/node-types';
import {
  getTokenTypeIndex,
  SemanticToken,
  calculateModifiersMask,
  getQueriesList,
  getCaptureToTokenMapping,
  getCommandModifiers,
  getCommandModifierInfo,
  getVariableModifiers,
  createTokensFromMatches,
  getTextMatchPositions,
  nodeIntersectsRange,
  isNodeCoveredByTokens,
} from './utils/semantics';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';
import { collectNodesByTypes, getNamedChildNodes } from './utils/tree-sitter';
import { highlights } from '@ndonfris/tree-sitter-fish';
import { BuiltInList } from './utils/builtins';
import { config } from './config';
import { getReferences } from './references';

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
  modes: ('off' | 'mini' | 'full')[],
];

type TokenTypeKey = 'command' | 'function' | 'variable' | 'keyword' | 'decorator' | 'string' | 'operator';
export const TokenTypes: Record<TokenTypeKey, number> = {
  command: getTokenTypeIndex('function'),
  function: getTokenTypeIndex('function'),
  variable: getTokenTypeIndex('variable'),
  keyword: getTokenTypeIndex('keyword'),
  decorator: getTokenTypeIndex('decorator'),
  string: getTokenTypeIndex('string'),
  operator: getTokenTypeIndex('operator'),
};

export const ModifierTypes: Record<TokenTypeKey, number> = {
  command: calculateModifiersMask('builtin'),
  function: 0,
  variable: 0,
  keyword: 0,
  decorator: calculateModifiersMask('shebang'),
  string: 0,
  operator: 0,
};

// ============================================================================
// Predicate Functions
// ============================================================================
const isBracketCommand = (n: SyntaxNode) => isCommandWithName(n, '[');

const commandsToSkip = () => config.fish_lsp_semantic_handler_type === 'mini' ? ['['] : ['alias', '['];
const isCommandCall = (n: SyntaxNode) => isBuiltinCommand(n) && !isCommandWithName(n, ...commandsToSkip());

const isFunctionCall = (n: SyntaxNode) => isCommand(n) && !isBuiltinCommand(n) && !isCommandWithName(n, ...commandsToSkip());

const isKeyword = (n: SyntaxNode) => [
  ...BuiltInList,
].includes(n.type);

const isVariableName = (n: SyntaxNode) => n.type === 'variable_name';

const isAliasNode = (n: SyntaxNode) => n.parent && isCommandWithName(n.parent, 'alias') && n.text === 'alias' && n.type === 'word' || false;

const isSemanticWord = (n: SyntaxNode) => {
  if (n.type !== 'word') return false;

  // Don't highlight if it's a command name (first child of command node)
  const parent = n.parent;
  if (parent && parent.type === 'command' && parent.firstNamedChild === n) {
    return false;
  }

  // Don't highlight if it's the 'alias' keyword (already handled)
  if (n.text === 'alias') return false;

  // Don't highlight if it's an option/flag (like -n, --flag, etc.)
  if (isOption(n)) return false;

  return true;
};

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
    isBracketCommand,
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
    ['full'],
  ],
  // Builtin commands (echo, set, read, etc.) - exclude 'alias' and '['
  [
    isCommandCall,
    (node, ctx) => {
      const type = isBuiltinCommand(node) ? TokenTypes.command : TokenTypes.function;
      const modifiers = getCommandModifiers(node, ctx.document.uri);

      // Builtins always get 'builtin' and 'defaultLibrary' modifiers
      ctx.tokens.push(
        SemanticToken.fromNode(
          node.firstNamedChild!,
          type,
          modifiers,
        ),
      );
    },
    ['full'],
  ],
  // Function calls and user-defined commands - exclude 'alias' and '['
  // In mini mode: only highlight calls to functions/aliases defined in this document
  // In full mode: highlight all function calls
  // All calls use the exact same modifiers as their definitions
  [
    isFunctionCall,
    (node, ctx) => {
      const modifierInfo = getCommandModifierInfo(node, ctx.document.uri);

      // In mini mode, only add token if the symbol is defined in this document
      if (config.fish_lsp_semantic_handler_type === 'mini' && !modifierInfo.isDefinedInDocument) {
        return;
      }

      ctx.tokens.push(
        SemanticToken.fromNode(node.firstNamedChild!, TokenTypes.function, modifierInfo.modifiers),
      );
    },

    ['mini', 'full'],
  ],

  // Shebang lines (#!/usr/bin/env fish)
  [
    isShebang,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.decorator, ModifierTypes.decorator),
      );
    },

    ['full'],
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
    ['full'],
  ],

  // Variable names (excludes leading $)
  [
    isVariableName,
    (node, ctx) => {
      const variableName = node.text.replace(/^\$/, '');
      const modifiers = getVariableModifiers(variableName, ctx.document.uri);

      ctx.tokens.push(
        ...createTokensFromMatches(
          getTextMatchPositions(node, /[^$]+/),
          TokenTypes.variable,
          modifiers,
        ),
      );
    },
    ['mini', 'full'],
  ],

  // Reserved keywords as specific node types (from tree-sitter grammar)
  [
    isKeyword,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.keyword, ModifierTypes.keyword),
      );
    },
    ['full'],
  ],

  // Special case: 'alias' keyword (appears as word node)
  [
    isAliasNode,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.keyword, ModifierTypes.keyword),
      );
    },
    ['full'],
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
    ['full'],
  ],

  // Plain word nodes (arguments, words in concatenations, etc.)
  // These should be highlighted as strings when they're not command names or options
  [
    isSemanticWord,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.string, 0),
      );
    },
    ['full'],
  ],
];

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Full semantic token handler that supports:
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
 * @param document - The document to provide semantic tokens for
 * @param range - Optional range to filter tokens within
 */
export function provideSemanticTokens(
  document: LspDocument,
  range?: LSP.Range,
): LSP.SemanticTokens {
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

  if (config.fish_lsp_semantic_handler_type === 'off') {
    return buildTokens(tokens);
  }

  // Process FishSymbol definitions
  processFishSymbols(context, range);

  // Process all references to symbols defined in this document
  // This ensures references use the same modifiers as their definitions
  processSymbolReferences(context, range);

  // Process all syntax nodes in a single traversal using getNamedChildNodes
  processAllSyntaxNodes(context, tree, range);

  // Apply highlights.scm queries to fill in gaps (full mode only)
  if (config.fish_lsp_semantic_handler_type === 'full') {
    processHighlightQueries(context, tree, range);
  }

  return buildTokens(tokens);
}

/**
 * Process all FishSymbols in the document
 * Note:
 * - Uses selectionRange for precise token positioning
 * - Excludes leading $ from variable names
 * - Excludes trailing = from export/alias definitions
 * @param context - The token transform context
 * @param filterRange - Optional range to filter symbols within
 */
function processFishSymbols(context: TokenTransformContext, filterRange?: LSP.Range): void {
  const symbols = analyzer.cache.getFlatDocumentSymbols(context.document.uri);

  for (const symbol of symbols) {
    // Skip symbols with null focusedNode
    if (!symbol.focusedNode) continue;

    // Skip symbols outside the requested range
    if (filterRange && symbol.focusedNode && !nodeIntersectsRange(symbol.focusedNode, filterRange)) {
      continue;
    }

    const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
    const tokenIndex = getTokenTypeIndex(tokenTypeKey);

    if (tokenIndex === -1) continue;

    const modifiers = getSymbolModifiers(symbol);
    const modifiersMask = calculateModifiersMask(...modifiers);

    // Use selectionRange if available (more precise), otherwise fall back to focusedNode
    const range = symbol.selectionRange;
    const startRow = range.start.line;
    const startCol = range.start.character;
    const length = range.end.character - range.start.character;

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
 * Process all references to symbols defined in the document
 * Each reference gets the same modifiers as its definition
 * In mini mode: only process references for symbols defined in this document
 * @param context - The token transform context
 * @param filterRange - Optional range to filter tokens within
 */
function rangeIntersects(range1: LSP.Range, range2: LSP.Range): boolean {
  return !(
    range1.end.line < range2.start.line ||
    range1.end.line === range2.start.line && range1.end.character < range2.start.character ||
    range1.start.line > range2.end.line ||
    range1.start.line === range2.end.line && range1.start.character > range2.end.character
  );
}

function processSymbolReferences(context: TokenTransformContext, filterRange?: LSP.Range): void {
  const symbols = analyzer.cache.getFlatDocumentSymbols(context.document.uri);

  for (const symbol of symbols) {
    const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
    const tokenIndex = getTokenTypeIndex(tokenTypeKey);

    if (tokenIndex === -1) continue;

    const modifiers = getSymbolModifiers(symbol);
    const modifiersMask = calculateModifiersMask(...modifiers);

    // Get all references for this symbol (only in current document)
    const references = getReferences(context.document, symbol.selectionRange.start, {
      excludeDefinition: true,  // Don't include the definition itself (already handled)
      localOnly: true,           // Only search in current document
      loggingEnabled: false,
    });

    // Add a token for each reference
    for (const ref of references) {
      // Skip references outside the requested range
      if (filterRange && !rangeIntersects(ref.range, filterRange)) {
        continue;
      }

      const startRow = ref.range.start.line;
      const startCol = ref.range.start.character;
      const length = ref.range.end.character - ref.range.start.character;

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
  // Collect expansions using breadth-first iteration
  const expansions = collectNodesByTypes(stringNode, ['variable_expansion', 'command_substitution']);

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

function processAllSyntaxNodes(
  context: TokenTransformContext,
  tree: Tree,
  filterRange?: LSP.Range,
) {
  const allNodes = getNamedChildNodes(tree.rootNode);
  const handlers = semanticTokenHandlers.filter(([, , modes]) =>
    modes.includes(config.fish_lsp_semantic_handler_type),
  );
  for (const node of allNodes) {
    // Skip nodes outside the requested range
    if (filterRange && !nodeIntersectsRange(node, filterRange)) {
      continue;
    }

    for (const [predicate, transform] of handlers) {
      if (predicate(node)) {
        transform(node, context);
      }
    }
  }
}

/**
 * Apply highlights.scm queries to fill in gaps not covered by existing tokens
 * @param context - The token transform context
 * @param tree - The syntax tree
 * @param filterRange - Optional range to filter tokens within
 */
function processHighlightQueries(context: TokenTransformContext, tree: Tree, filterRange?: LSP.Range): void {
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
        // Skip nodes outside the requested range
        if (filterRange && !nodeIntersectsRange(capture.node, filterRange)) {
          continue;
        }

        const captureMapping = mapping[capture.name];
        if (!captureMapping || captureMapping.index === -1) {
          continue;
        }

        // Special handling for strings with variable expansions FIRST
        // (before checking if covered, because the variables inside will overlap)
        if (capture.name === 'string') {
          const expansions = collectNodesByTypes(capture.node, ['variable_expansion', 'command_substitution']);
          if (expansions.length > 0) {
            addPartialStringTokens(context.tokens, capture.node, captureMapping.index, context.document);
            continue;
          }
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
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideSemanticTokens(document, params.range) : { data: [] };
    },
  };
}
