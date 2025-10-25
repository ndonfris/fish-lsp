import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { isBuiltinCommand, isCommand, isCommandWithName, isComment, isShebang, isEscapeSequence, isOption } from './utils/node-types';
import { getTokenTypeIndex, SemanticToken, calculateModifiersMask, getQueriesList, getCaptureToTokenMapping, getCommandModifiers, createTokensFromMatches, getTextMatchPositions } from './utils/semantics';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';
import { getChildNodes } from './utils/tree-sitter';
import { highlights } from '@ndonfris/tree-sitter-fish';
import { BuiltInList, isBuiltin } from './utils/builtins';

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

const isCommandCall = (n: SyntaxNode) => isBuiltinCommand(n) && !isCommandWithName(n, 'alias', '[')

const isFunctionCall = (n: SyntaxNode) => isCommand(n) && !isBuiltinCommand(n) && !isCommandWithName(n, 'alias', '[')

// const isBuiltinCommandName = (n: SyntaxNode)  =>  isCommandWithName(n, ...BuiltInList)
const isKeyword = (n: SyntaxNode) => [
  ...BuiltInList,
].includes(n.type)

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
  ],
  // Builtin commands (echo, set, read, etc.) - exclude 'alias' and '['
  [
    isCommandCall,
    (node, ctx) => {
      const type = isBuiltinCommand(node) ? TokenTypes.command : TokenTypes.function;
      const modifiers = getCommandModifiers(node);

      // Builtins always get 'builtin' and 'defaultLibrary' modifiers
      ctx.tokens.push(
        SemanticToken.fromNode(
          node.firstNamedChild!,
          type,
          modifiers,
        ),
      );
    },
  ],
  // Function calls and user-defined commands - exclude 'alias' and '['
  [
    isFunctionCall,
    (node, ctx) => {
      const modifiers = getCommandModifiers(node);
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
    isVariableName,
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
    isKeyword,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.keyword, ModifierTypes.keyword),
      );
    },
  ],

  // Special case: 'alias' keyword (appears as word node)
  [
    isAliasNode,
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
    isSemanticWord,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node, TokenTypes.string, 0),
      );
    },
  ],
];

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Mini semantic token handler that supports:
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
 */
export function provideMiniSemanticTokens(document: LspDocument): LSP.SemanticTokens {
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

  // Process all syntax nodes in a single traversal
  const allNodes = getChildNodes(tree.rootNode);
  for (const node of allNodes) {
    for (const [predicate, transform] of semanticTokenHandlers) {
      if (predicate(node)) {
        transform(node, context);
      }
    }
  }

  // Apply highlights.scm queries to fill in gaps
  applyHighlightQueries(context, tree);

  return buildTokens(tokens);
}

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
export function miniSemanticTokensHandlerCallback() {
  return {
    semanticTokensHandler: (params: LSP.SemanticTokensParams) => {
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideMiniSemanticTokens(document) : { data: [] };
    },
    semanticTokensRangeHandler: (params: LSP.SemanticTokensRangeParams) => {
      // Note: Mini handler doesn't support range-based tokens, so we return full document tokens
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideMiniSemanticTokens(document) : { data: [] };
    },
  };
}
