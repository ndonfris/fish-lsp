import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from './document';
import { analyzer } from './analyze';
import { isBuiltinCommand, isCommand, isComment, isShebang } from './utils/node-types';
import { getTokenTypeIndex, SemanticToken, calculateModifiersMask } from './utils/semantics';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';
import { getChildNodes } from './utils/tree-sitter';

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

const TokenTypes: Record<'function' | 'variable' | 'keyword' | 'decorator', number> = {
  function: getTokenTypeIndex('function')!,
  variable: getTokenTypeIndex('variable')!,
  keyword: getTokenTypeIndex('keyword')!,
  decorator: getTokenTypeIndex('decorator')!,
};

const ModifierTypes: Record<'function' | 'variable' | 'keyword' | 'decorator', number> = {
  function: calculateModifiersMask('builtin', 'defaultLibrary'),
  variable: 0,
  keyword: 0,
  decorator: calculateModifiersMask('shebang'),
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

// ============================================================================
// Token Transform Handlers Map
// ============================================================================

/**
 * Array of all semantic token transforms
 * Each entry is [predicate, transform]
 */
const semanticTokenHandlers: NodeTokenHandler[] = [
  // Builtin commands (echo, set, read, etc.)
  [
    isBuiltinCommand,
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node.firstNamedChild!, TokenTypes.function, ModifierTypes.function),
      );
    },
  ],
  // Builtin commands (echo, set, read, etc.)
  [
    (node) => isCommand(node) && !isBuiltinCommand(node),
    (node, ctx) => {
      ctx.tokens.push(
        SemanticToken.fromNode(node.firstNamedChild!, TokenTypes.function, ModifierTypes.function),
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
];

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Mini semantic token handler that only supports:
 * 1. FishSymbol highlighting
 * 2. SyntaxNode.type === 'command' for checking if keyword or builtin
 * 3. Comment support with shebang and `# @fish-lsp` inline comment highlights
 * 4. Variable name highlighting (variable_name nodes, excluding leading $)
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

  return buildTokens(tokens);
}

/**
 * Process all FishSymbols in the document
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

    let text = symbol.focusedNode.text;
    const startRow = symbol.focusedNode.startPosition.row;
    const startCol = symbol.focusedNode.startPosition.column;
    let length = symbol.focusedNode.endIndex - symbol.focusedNode.startIndex;

    // For variables, exclude leading $ from the token
    let actualStartCol = startCol;
    while (symbol.isVariable() && text.startsWith('$')) {
      actualStartCol += 1;
      length -= 1;
      text = text.slice(1);
    }

    // Only add token if there's actual content
    if (length > 0) {
      context.tokens.push(
        SemanticToken.create(
          startRow,
          actualStartCol,
          length,
          tokenIndex,
          modifiersMask,
        ),
      );
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
