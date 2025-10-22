import * as LSP from 'vscode-languageserver';
import { SemanticTokens, SemanticTokensBuilder, Range } from 'vscode-languageserver';
import { QueryCapture, SyntaxNode } from 'web-tree-sitter';
import { analyzer } from './analyze';
import { LspDocument } from './document';
import { highlights } from '@ndonfris/tree-sitter-fish';
import {
  isCommand,
  isBuiltinCommand,
  isFishShippedFunctionName,
  isShebang,
  isEndStdinCharacter,
  isExportVariableDefinitionName,
  isAliasDefinitionName,
  isFunctionDefinition,
  isOption,
  isComment,
  isDirectoryPath,
  isFilepath,
} from './utils/node-types';
import { isNodeWithinOtherNode } from './utils/tree-sitter';
import { isBuiltin as checkBuiltin } from './utils/builtins';
import { logger } from './logger';
import { FishSymbolToSemanticToken, getSymbolModifiers } from './parsing/symbol-modifiers';
import {
  SemanticToken,
  FishSemanticTokenModifier,
  FishSemanticTokenModifiers,
  FISH_SEMANTIC_TOKENS_LEGEND,
  getQueriesList,
  getCaptureToTokenMapping,
  getTokenTypeIndex,
  calculateModifiersMask,
  nodeIntersectsRange,
  getPositionFromOffset,
  getTokenTypePriority,
  analyzeValueType,
  getModifiersFromMask,
} from './utils/semantics';
import { FishSymbolKind } from './parsing/symbol-kinds';

// Re-export for tests
export {
  FISH_SEMANTIC_TOKENS_LEGEND,
  FishSemanticTokenModifiers,
  getModifiersFromMask,
  getTokenTypeIndex,
  getQueriesList,
  isBuiltinCommand,
};

type RecurseFn = (node: SyntaxNode) => SemanticToken[];

type TokenHandler = {
  predicate: (node: SyntaxNode) => boolean;
  transform: (node: SyntaxNode, recurse: RecurseFn, context: HandlerContext) => SemanticToken[];
};

type HandlerContext = {
  document: LspDocument;
  range?: Range;
  tokens: SemanticToken[];
};

// ============================================================================
// Helper Types for Refactored Handlers
// ============================================================================

interface TokenIndices {
  operator: number;
  keyword: number;
  decorator: number;
  parameter: number;
  property: number;
  function: number;
  string: number;
}

interface ModifierMasks {
  fishLspDirective: number;
  shebang: number;
  flag: number;
  argument: number;
  path: number;
  filename: number;
}

interface CommandChildren {
  first: SyntaxNode;
  second?: SyntaxNode;
  rest: SyntaxNode[];
}

// ============================================================================
// Handler Factory Functions
// ============================================================================

const simpleToken = (
  predicate: (n: SyntaxNode) => boolean,
  tokenType: number,
  getModifiers?: (n: SyntaxNode) => number,
): TokenHandler => ({
  predicate,
  transform: (node) => {
    const modifiers = getModifiers ? getModifiers(node) : 0;
    return [SemanticToken.fromNode(node, tokenType, modifiers)];
  },
});

const customHandler = (
  predicate: (n: SyntaxNode) => boolean,
  transform: (n: SyntaxNode, r: RecurseFn, ctx: HandlerContext) => SemanticToken[],
): TokenHandler => ({ predicate, transform });

// ============================================================================
// Helper Functions for Token Creation
// ============================================================================

/**
 * Validate that required token type indices exist
 */
function validateIndices(required: (keyof TokenIndices)[], indices: TokenIndices): boolean {
  return required.every(key => indices[key] !== -1);
}

/**
 * Parse text containing '=' and create tokens for: name, =, value
 * Centralized logic for consistent = handling across flags, alias, export
 */
function parseEqualsExpression(
  text: string,
  startRow: number,
  startCol: number,
  indices: TokenIndices,
  modifiers: { name: number; value?: number; },
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const eqIndex = text.indexOf('=');

  if (eqIndex === -1 || eqIndex === 0) return tokens;

  // Name token (before =)
  tokens.push(SemanticToken.create(
    startRow,
    startCol,
    eqIndex,
    indices.parameter,
    modifiers.name,
  ));

  // = operator token
  if (indices.operator !== -1) {
    tokens.push(SemanticToken.create(
      startRow,
      startCol + eqIndex,
      1,
      indices.operator,
      0,
    ));
  }

  // Value token (after =)
  const valueText = text.substring(eqIndex + 1);
  if (valueText.length > 0) {
    const valueAnalysis = analyzeValueType(valueText);
    const valueTypeIdx = getTokenTypeIndex(valueAnalysis.tokenType);
    if (valueTypeIdx !== -1) {
      const valueMods = modifiers.value !== undefined
        ? modifiers.value
        : valueAnalysis.modifiers ? calculateModifiersMask(...valueAnalysis.modifiers) : 0;

      tokens.push(SemanticToken.create(
        startRow,
        startCol + eqIndex + 1,
        valueText.length,
        valueTypeIdx,
        valueMods,
      ));
    }
  }

  return tokens;
}

/**
 * Safely extract command children with type guards
 */
function getCommandChildren(node: SyntaxNode): CommandChildren | null {
  if (!isCommand(node)) return null;

  const children = node.namedChildren;
  if (children.length === 0) return null;

  return {
    first: children[0]!,
    second: children[1],
    rest: children.slice(2),
  };
}

/**
 * Check if command starts with any of the specified words
 */
function commandStartsWith(node: SyntaxNode, words: string[]): boolean {
  const children = getCommandChildren(node);
  return children !== null &&
    children.first.type === 'word' &&
    words.includes(children.first.text);
}

// ============================================================================
// Token Handlers
// ============================================================================

const createTokenHandlers = (): TokenHandler[] => {
  // Gather all token type indices
  const indices: TokenIndices = {
    operator: getTokenTypeIndex('operator'),
    keyword: getTokenTypeIndex('keyword'),
    decorator: getTokenTypeIndex('decorator'),
    parameter: getTokenTypeIndex('parameter'),
    property: getTokenTypeIndex('property'),
    function: getTokenTypeIndex('function'),
    string: getTokenTypeIndex('string'),
  };

  // Gather all modifier masks
  const modifiers: ModifierMasks = {
    fishLspDirective: calculateModifiersMask('fish-lsp-directive'),
    shebang: calculateModifiersMask('shebang'),
    flag: calculateModifiersMask('flag'),
    argument: calculateModifiersMask('argument'),
    path: calculateModifiersMask('path'),
    filename: calculateModifiersMask('filename'),
  };

  return [
    // ========================================================================
    // Operators
    // ========================================================================

    // End stdin operator (--)
    simpleToken(isEndStdinCharacter, indices.operator),

    // ========================================================================
    // Comments & Directives
    // ========================================================================

    // Fish-lsp directive comments
    customHandler(
      isComment,
      (node) => {
        if (!validateIndices(['keyword'], indices)) return [];
        return extractFishLspDirectives(node, indices.keyword, modifiers.fishLspDirective);
      },
    ),

    // ========================================================================
    // Shebangs
    // ========================================================================

    customHandler(
      isShebang,
      (node) => {
        if (!validateIndices(['decorator'], indices)) return [];
        const shebangMask = modifiers.shebang !== -1 ? 1 << modifiers.shebang : 0;
        return [SemanticToken.fromNode(node, indices.decorator, shebangMask)];
      },
    ),

    // ========================================================================
    // Flags
    // ========================================================================

    // Flags with inline values (--opt=value, -o=value)
    customHandler(
      (n) => isOption(n) && n.text.includes('='),
      (node) => {
        if (!validateIndices(['parameter'], indices)) return [];
        const flagMask = modifiers.flag !== -1 ? 1 << modifiers.flag : 0;
        return parseEqualsExpression(
          node.text,
          node.startPosition.row,
          node.startPosition.column,
          indices,
          { name: flagMask },
        );
      },
    ),

    // Simple flags (without =)
    simpleToken(
      (n) => isOption(n) && !n.text.includes('='),
      indices.parameter,
      () => modifiers.flag !== -1 ? 1 << modifiers.flag : 0,
    ),

    // ========================================================================
    // Paths
    // ========================================================================

    customHandler(
      (n) => isFilepath(n) || isDirectoryPath(n),
      (node) => {
        if (!validateIndices(['property'], indices)) return [];
        const modifierMask = isFilepath(node) && modifiers.filename !== -1
          ? 1 << modifiers.filename
          : modifiers.path !== -1 ? 1 << modifiers.path : 0;
        return [SemanticToken.fromNode(node, indices.property, modifierMask)];
      },
    ),

    // ========================================================================
    // Commands
    // ========================================================================

    // Bracket matching for test commands
    customHandler(
      (n) => isCommand(n),
      (node) => {
        if (!validateIndices(['function'], indices)) return [];
        const tokens: SemanticToken[] = [];
        const children = node.namedChildren;
        if (children.length > 0 && children[0]?.type === 'word' && children[0].text === '[') {
          for (const child of children) {
            if (child?.type === 'word' && child.text === ']') {
              tokens.push(SemanticToken.fromNode(child, indices.function));
            }
          }
        }
        return tokens;
      },
    ),

    // ========================================================================
    // Assignments (alias, export)
    // ========================================================================

    // Concatenated assignments (alias f=foo, export p=PATH)
    customHandler(
      (n) => commandStartsWith(n, ['alias', 'export']),
      (node) => {
        if (!validateIndices(['parameter', 'operator'], indices)) return [];

        const children = getCommandChildren(node);
        if (!children || !children.second) return [];

        const argMask = modifiers.argument !== -1 ? 1 << modifiers.argument : 0;

        // Case 1: Simple word with = (export PATH=/usr/bin)
        if (children.second.type === 'word' && children.second.text.includes('=')) {
          return parseEqualsExpression(
            children.second.text,
            children.second.startPosition.row,
            children.second.startPosition.column,
            indices,
            { name: argMask },
          );
        }

        // Case 2: Concatenation with = (alias f=bar\ baz)
        if (children.second.type === 'concatenation') {
          return handleConcatenatedAssignment(children.second, indices, argMask);
        }

        return [];
      },
    ),

    // Subcommands for special commands
    customHandler(
      (n) => commandStartsWith(n, ['builtin', 'command', 'functions', 'type']),
      (node) => {
        if (!validateIndices(['function'], indices)) return [];
        const children = getCommandChildren(node);
        if (!children || !children.second) return [];

        if (children.second.type === 'word' && !children.second.text.startsWith('-')) {
          return [SemanticToken.fromNode(children.second, indices.function, 0)];
        }
        return [];
      },
    ),

    // ========================================================================
    // Semicolons (outside comments)
    // ========================================================================

    customHandler(
      (n) => (n.type === 'word' || n.type === ';') && n.text.includes(';'),
      (node) => {
        if (!validateIndices(['operator'], indices)) return [];
        const tokens: SemanticToken[] = [];

        // Check if we're inside a comment
        let currentNode: SyntaxNode | null = node.parent;
        while (currentNode) {
          if (isComment(currentNode)) return [];
          currentNode = currentNode.parent;
        }

        // Add token for each semicolon
        for (let i = 0; i < node.text.length; i++) {
          if (node.text[i] === ';') {
            tokens.push(SemanticToken.create(
              node.startPosition.row,
              node.startPosition.column + i,
              1,
              indices.operator,
            ));
          }
        }
        return tokens;
      },
    ),

    // Command arguments for all commands
    customHandler(
      (n) => isCommand(n),
      (node) => {
        if (!validateIndices(['parameter'], indices)) return [];
        const children = getCommandChildren(node);
        if (!children) return [];

        const cmdText = children.first.text;

        // Skip commands that have complex argument handling elsewhere
        // set: variable names are handled by symbol system
        // export: variable names are handled by symbol system
        // cd: paths are handled by path handler
        // test/[: operators need special handling
        const skipCommands = ['set', 'cd', 'test', '['];
        if (skipCommands.includes(cmdText)) return [];

        const argMask = modifiers.argument !== -1 ? 1 << modifiers.argument : 0;
        const tokens: SemanticToken[] = [];

        // Tokenize non-flag arguments
        const allArgs = children.second ? [children.second, ...children.rest] : children.rest;
        for (const arg of allArgs) {
          if (arg.type === 'word' && !arg.text.startsWith('-')) {
            tokens.push(SemanticToken.fromNode(arg, indices.parameter, argMask));
          }
        }

        return tokens;
      },
    ),

    // ========================================================================
    // Concatenation with escape sequences
    // ========================================================================

    customHandler(
      (n) => n.type === 'concatenation',
      (node) => {
        if (!validateIndices(['string'], indices)) return [];
        return handleEscapedConcatenation(node, indices);
      },
    ),
  ];
};

// ============================================================================
// Handler Implementation Helpers
// ============================================================================

/**
 * Extract fish-lsp directive comments and create keyword tokens
 */
function extractFishLspDirectives(
  node: SyntaxNode,
  keywordIdx: number,
  directiveModifier: number,
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const fishLspRegex = /@fish-lsp-(enable|disable)(?:-next-line)?/g;
  let match;

  while ((match = fishLspRegex.exec(node.text)) !== null) {
    tokens.push(SemanticToken.fromPosition(
      { line: node.startPosition.row, character: node.startPosition.column + match.index },
      match[0].length,
      keywordIdx,
      directiveModifier,
    ));
  }

  return tokens;
}

/**
 * Handle concatenated assignment with = operator
 * For cases like: alias f=bar\ baz
 */
function handleConcatenatedAssignment(
  concatNode: SyntaxNode,
  indices: TokenIndices,
  argMask: number,
): SemanticToken[] {
  const concatChildren = concatNode.children;

  if (concatChildren.length >= 1 &&
    concatChildren[0]?.type === 'word' &&
    concatChildren[0].text.includes('=')) {
    const firstWord = concatChildren[0];
    return parseEqualsExpression(
      firstWord.text,
      firstWord.startPosition.row,
      firstWord.startPosition.column,
      indices,
      { name: argMask },
    );
  }

  return [];
}

/**
 * Create a token from analyzed value (avoids duplication)
 */
function createTokenFromValue(
  text: string,
  row: number,
  col: number,
  length?: number,
): SemanticToken | null {
  const valueAnalysis = analyzeValueType(text);
  const valueTypeIdx = getTokenTypeIndex(valueAnalysis.tokenType);
  if (valueTypeIdx === -1) return null;

  const modifiers = valueAnalysis.modifiers ? calculateModifiersMask(...valueAnalysis.modifiers) : 0;
  return SemanticToken.create(row, col, length || text.length, valueTypeIdx, modifiers);
}

/**
 * Create a token from a node using value analysis
 */
function createTokenFromNode(node: SyntaxNode): SemanticToken | null {
  const valueAnalysis = analyzeValueType(node.text);
  const valueTypeIdx = getTokenTypeIndex(valueAnalysis.tokenType);
  if (valueTypeIdx === -1) return null;

  const modifiers = valueAnalysis.modifiers ? calculateModifiersMask(...valueAnalysis.modifiers) : 0;
  return SemanticToken.fromNode(node, valueTypeIdx, modifiers);
}

/**
 * Calculate the correct length for a symbol token
 * For export/alias definitions, only highlight up to the '=' character
 */
function getSymbolTokenLength(node: SyntaxNode): number {
  if (isExportVariableDefinitionName(node) || isAliasDefinitionName(node)) {
    const text = node.text;
    const equalIndex = text.indexOf('=');
    if (equalIndex !== -1) {
      return equalIndex;
    }
  }
  return node.endIndex - node.startIndex;
}

/**
 * Create a semantic token from a FishSymbol
 * Handles special cases like export/alias definitions
 */
function createSymbolToken(
  symbol: { focusedNode: SyntaxNode; fishKind: FishSymbolKind; },
  range?: Range,
): SemanticToken | null {
  if (range && !nodeIntersectsRange(symbol.focusedNode, range)) {
    return null;
  }

  const tokenTypeKey = FishSymbolToSemanticToken[symbol.fishKind];
  const modifiers: FishSemanticTokenModifier[] = getSymbolModifiers(symbol as any);
  const tokenIndex = getTokenTypeIndex(tokenTypeKey);

  if (tokenIndex === -1) return null;

  const length = getSymbolTokenLength(symbol.focusedNode);

  return SemanticToken.create(
    symbol.focusedNode.startPosition.row,
    symbol.focusedNode.startPosition.column,
    length,
    tokenIndex,
    calculateModifiersMask(...modifiers),
  );
}

/**
 * Handle concatenation nodes with escaped spaces
 * For cases like: alias f=bar\ baz\ qux
 */
function handleEscapedConcatenation(
  node: SyntaxNode,
  _indices: TokenIndices,
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const children = node.namedChildren;

  // Check if this is an option-like concatenation (has =)
  const hasOptionPrefix = children.length > 0 &&
    children[0]?.type === 'word' &&
    children[0].text.includes('=');

  // Check if there are escape sequences
  const foundEscapeSequence = children.some(
    child => child?.type === 'escape_sequence' && child.text.includes(' '),
  );

  if (!hasOptionPrefix || !foundEscapeSequence) return tokens;

  // Handle the first word which contains "=" (e.g., "f=bar" in "alias f=bar\ baz")
  const firstChild = children[0];
  if (firstChild?.type === 'word' && firstChild.text.includes('=')) {
    const eqIndex = firstChild.text.indexOf('=');
    const valueAfterEq = firstChild.text.substring(eqIndex + 1);

    if (valueAfterEq.length > 0) {
      const token = createTokenFromValue(
        valueAfterEq,
        firstChild.startPosition.row,
        firstChild.startPosition.column + eqIndex + 1,
      );
      if (token) tokens.push(token);
    }
  }

  // Handle remaining words after escape sequences
  let afterEscape = false;
  for (const child of children) {
    if (child?.type === 'escape_sequence') {
      afterEscape = true;
    } else if (afterEscape && child?.type === 'word') {
      const token = createTokenFromNode(child);
      if (token) tokens.push(token);
    }
  }

  return tokens;
}

// ============================================================================
// Main traversal function
// ============================================================================
function traverseWithHandlers(
  node: SyntaxNode,
  handlers: TokenHandler[],
  context: HandlerContext,
  tokens: SemanticToken[] = [],
): SemanticToken[] {
  const recurse: RecurseFn = (n) => traverseWithHandlers(n, handlers, context, []);

  // Skip if outside range
  if (context.range && !nodeIntersectsRange(node, context.range)) {
    return tokens;
  }

  // Try each handler
  for (const handler of handlers) {
    if (handler.predicate(node)) {
      const handlerTokens = handler.transform(node, recurse, context);
      tokens.push(...handlerTokens);
    }
  }

  // Recurse through children
  for (const child of node.namedChildren) {
    traverseWithHandlers(child, handlers, context, tokens);
  }

  return tokens;
}

// Helper: check if string contains expansions
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

// Helper: add partial string tokens
function addPartialStringTokens(
  tokens: SemanticToken[],
  stringNode: SyntaxNode,
  document: LspDocument,
  stringTokenTypeIndex: number,
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
    tokens.push(SemanticToken.fromNode(stringNode, stringTokenTypeIndex, 0));
    return;
  }

  expansions.sort((a, b) => {
    if (a.startPosition.row !== b.startPosition.row) {
      return a.startPosition.row - b.startPosition.row;
    }
    return a.startPosition.column - b.startPosition.column;
  });

  let lastEnd = stringNode.startIndex;
  const content = document.getText();

  for (const expansion of expansions) {
    if (expansion.startIndex > lastEnd) {
      const gapLength = expansion.startIndex - lastEnd;
      if (gapLength > 0) {
        const gapStartPos = getPositionFromOffset(content, lastEnd);
        tokens.push(SemanticToken.create(
          gapStartPos.line,
          gapStartPos.character,
          gapLength,
          stringTokenTypeIndex,
          0,
        ));
      }
    }
    lastEnd = expansion.endIndex;
  }

  if (lastEnd < stringNode.endIndex) {
    const gapLength = stringNode.endIndex - lastEnd;
    if (gapLength > 0) {
      const gapStartPos = getPositionFromOffset(content, lastEnd);
      tokens.push(SemanticToken.create(
        gapStartPos.line,
        gapStartPos.character,
        gapLength,
        stringTokenTypeIndex,
        0,
      ));
    }
  }
}

/**
 * Execute tree-sitter queries on a node and add tokens
 * Centralized query execution pattern
 */
function executeQueriesOnNode(
  tokens: SemanticToken[],
  node: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  const lang = analyzer.parser.getLanguage();
  if (!lang) return;

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

        if (range && !nodeIntersectsRange(capture.node, range)) {
          continue;
        }

        // Handle strings with expansions specially
        if (capture.name === 'string' && containsVariableExpansionsOrCommands(capture.node)) {
          addPartialStringTokens(tokens, capture.node, document, captureMapping.index);
          continue;
        }

        const modifiers = getModifiersForCapture(capture, document);
        const modifiersMask = calculateModifiersMask(...modifiers);

        tokens.push(SemanticToken.fromNode(capture.node, captureMapping.index, modifiersMask));
      }
    } catch (error) {
      logger.warning(`Failed to execute query: ${queryText}`, error);
    }
  }
}

// Helper: get modifiers for tree-sitter captures
function getModifiersForCapture(capture: QueryCapture, _document: LspDocument): string[] {
  const modifiers: string[] = [];
  const { name, node } = capture;

  if (name.includes('builtin') || name.includes('keyword')) {
    modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
    modifiers.push(FishSemanticTokenModifiers.builtin);
  }

  // Don't add declaration/definition modifiers to parameters
  if ((name.includes('definition') || name.includes('declaration')) && name !== 'parameter') {
    modifiers.push(FishSemanticTokenModifiers.definition);
  }

  if (name.includes('deprecated')) {
    modifiers.push(FishSemanticTokenModifiers.deprecated);
  }

  if (name.includes('readonly')) {
    modifiers.push(FishSemanticTokenModifiers.readonly);
  }

  if (name === 'function') {
    if (isCommand(node.parent!) && checkBuiltin(node.text)) {
      modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
      modifiers.push(FishSemanticTokenModifiers.builtin);
    }

    if (isFunctionDefinition(node.parent!)) {
      modifiers.push(FishSemanticTokenModifiers.definition);
    }

    if (isCommand(node.parent!) && node.parent?.firstNamedChild && isFishShippedFunctionName(node.parent.firstNamedChild)) {
      modifiers.push(FishSemanticTokenModifiers.defaultLibrary);
    }
  }

  return modifiers;
}

// Add tree-sitter query captures
function addTreeSitterCaptures(
  tokens: SemanticToken[],
  tree: any,
  document: LspDocument,
  range?: Range,
): void {
  executeQueriesOnNode(tokens, tree.rootNode, document, range);
}

// Add definition symbols
function addDefinitionSymbols(
  tokens: SemanticToken[],
  document: LspDocument,
  range?: Range,
): void {
  const symbols = analyzer.cache.getFlatDocumentSymbols(document.uri);

  for (const symbol of symbols) {
    const token = createSymbolToken(symbol, range);
    if (token) {
      tokens.push(token);
    }
  }
}

// Add command substitution tokens
function addCommandSubstitutionTokens(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  function findCommandSubstitutions(node: SyntaxNode): SyntaxNode[] {
    const result: SyntaxNode[] = [];

    function traverse(n: SyntaxNode) {
      if (n.type === 'command_substitution') {
        result.push(n);
      }

      for (const child of n.namedChildren) {
        traverse(child);
      }
    }

    traverse(node);
    return result;
  }

  const commandSubstitutions = findCommandSubstitutions(rootNode);

  for (const cmdSub of commandSubstitutions) {
    if (range && !nodeIntersectsRange(cmdSub, range)) {
      continue;
    }

    const innerContent = cmdSub.namedChildren;
    for (const child of innerContent) {
      addCommandTokensFromNode(tokens, child, document, range);
    }
  }
}

// Helper for command substitution processing
function addCommandTokensFromNode(
  tokens: SemanticToken[],
  node: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  // Execute queries on the node
  executeQueriesOnNode(tokens, node, document, range);

  // Add symbols within this node
  const symbols = analyzer.cache.getFlatDocumentSymbols(document.uri);
  for (const symbol of symbols) {
    if (isNodeWithinOtherNode(symbol.focusedNode, node)) {
      const token = createSymbolToken(symbol, range);
      if (token) {
        tokens.push(token);
      }
    }
  }
}

// Build semantic tokens with conflict resolution
function buildSemanticTokens(tokens: SemanticToken[], useOverlapping: boolean): SemanticTokens {
  const builder = new SemanticTokensBuilder();

  if (useOverlapping) {
    const sortedTokens = [...tokens].sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      if (a.startChar !== b.startChar) return a.startChar - b.startChar;
      return a.length - b.length;
    });

    for (const token of sortedTokens) {
      builder.push(token.line, token.startChar, token.length, token.tokenType, token.tokenModifiers);
    }
  } else {
    const sortedTokens = [...tokens].sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.startChar - b.startChar;
    });

    const resolvedTokens: SemanticToken[] = [];
    let i = 0;

    while (i < sortedTokens.length) {
      const currentToken = sortedTokens[i];
      if (!currentToken) break;

      const overlappingTokens = [currentToken];
      let j = i + 1;

      while (j < sortedTokens.length) {
        const nextToken = sortedTokens[j];
        if (!nextToken) break;

        const currentEnd = currentToken.startChar + currentToken.length;
        const nextStart = nextToken.startChar;

        if (nextToken.line === currentToken.line && nextStart < currentEnd) {
          overlappingTokens.push(nextToken);
          j++;
        } else {
          break;
        }
      }

      if (overlappingTokens.length > 1) {
        const bestToken = overlappingTokens.reduce((best, token) => {
          const bestPriority = getTokenTypePriority(best.tokenType, best.tokenModifiers);
          const tokenPriority = getTokenTypePriority(token.tokenType, token.tokenModifiers);

          if (tokenPriority === bestPriority) {
            return token.length > best.length ? token : best;
          }

          return tokenPriority > bestPriority ? token : best;
        });

        resolvedTokens.push(bestToken);
      } else {
        resolvedTokens.push(currentToken);
      }

      i = j > i + 1 ? j : i + 1;
    }

    for (const token of resolvedTokens) {
      builder.push(token.line, token.startChar, token.length, token.tokenType, token.tokenModifiers);
    }
  }

  return builder.build();
}

// Main provider function
export function provideTreeSitterSemanticTokens(
  document: LspDocument,
  range?: Range,
  useOverlappingTokens: boolean = true,
): SemanticTokens {
  analyzer.analyze(document);
  const tree = analyzer.cache.getParsedTree(document.uri);

  if (!tree) {
    logger.warning(`No parse tree available for document: ${document.uri}`);
    return { data: [] };
  }

  const tokens: SemanticToken[] = [];
  const context: HandlerContext = { document, range, tokens };

  // Add tree-sitter query captures
  addTreeSitterCaptures(tokens, tree, document, range);

  // Add command substitutions
  addCommandSubstitutionTokens(tokens, tree.rootNode, document, range);

  // Add definition symbols
  addDefinitionSymbols(tokens, document, range);

  // Apply custom handlers
  const handlers = createTokenHandlers();
  traverseWithHandlers(tree.rootNode, handlers, context, tokens);

  return buildSemanticTokens(tokens, useOverlappingTokens);
}

export function semanticTokensHandlerCallback() {
  return {
    semanticTokensHandler: (params: LSP.SemanticTokensParams) => {
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideTreeSitterSemanticTokens(document) : { data: [] };
    },
    semanticTokensRangeHandler: (params: LSP.SemanticTokensRangeParams) => {
      const document = analyzer.getDocument(params.textDocument.uri);
      return document ? provideTreeSitterSemanticTokens(document, params.range) : { data: [] };
    },
  };
}
