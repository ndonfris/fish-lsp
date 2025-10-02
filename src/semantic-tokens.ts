import {
  SemanticTokens,
  SemanticTokensBuilder,
  // SemanticTokensParams,
  SemanticTokensRegistrationOptions,
  SemanticTokensLegend,
  // SemanticTokensRangeParams,
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
  isFunctionDefinition,
  isFunctionDefinitionName,
  isVariableDefinitionName,
  isVariableExpansion,
  // isVariableDefinitionName,
  // isOption,
  // isBuiltin,
} from './utils/node-types';
import { isSetVariableDefinitionName, SetModifiers } from './parsing/set';
import { isReadVariableDefinitionName, ReadModifiers } from './parsing/read';
import {
  isFunctionVariableDefinitionName, /* FunctionOptions */
  processFunctionDefinition,
} from './parsing/function';
import { isAliasDefinitionName } from './parsing/alias';
import { isExportVariableDefinitionName } from './parsing/export';
import { isEmittedEventDefinitionName, isGenericFunctionEventHandlerDefinitionName } from './parsing/emit';
import { findOptions, findMatchingOptions } from './parsing/options';
import { isBuiltin as checkBuiltin } from './utils/builtins';
import { logger } from './logger';

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
  global: 'global',
  universal: 'universal',
  export: 'export',
  autoloaded: 'autoloaded',
  builtin: 'builtin',
} as const;

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
 * Enhanced semantic token provider using tree-sitter queries
 */
export function provideTreeSitterSemanticTokens(
  document: LspDocument,
  range?: Range,
  useOverlappingTokens: boolean = false,
): SemanticTokens {
  const tree = analyzer.cache.getParsedTree(document.uri);
  if (!tree) return { data: [] };

  const lang = tree.getLanguage();
  const queries = getQueriesList(highlights);
  const queryCaptures: QueryCapture[] = [];
  const mapping = getCaptureToTokenMapping();

  // Execute all queries and collect captures
  for (const queryText of queries) {
    try {
      const query = lang.query(queryText);
      const captures = query.captures(tree.rootNode);

      // Filter captures by range if specified
      if (range) {
        queryCaptures.push(...captures.filter(capture =>
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

  // Process tree-sitter captures
  for (const capture of queryCaptures) {
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

    allTokens.push({
      line: capture.node.startPosition.row,
      startChar: capture.node.startPosition.column,
      length: capture.node.endIndex - capture.node.startIndex,
      tokenType: captureMapping.index,
      tokenModifiers: modifiersMask,
    });
  }

  // Add variable definition tokens with enhanced detection
  addVariableDefinitionTokensToArray(allTokens, tree.rootNode, document, range);

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
  // Sort tokens by position to ensure proper ordering
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.startChar - b.startChar;
  });

  // For overlapping tokens, we use absolute positions
  const data: number[] = [];
  for (const token of sortedTokens) {
    data.push(
      token.line,
      token.startChar,
      token.length,
      token.tokenType,
      token.tokenModifiers,
    );
  }

  return { data };
}

/**
 * Build non-overlapping semantic tokens using the standard SemanticTokensBuilder
 */
function buildNonOverlappingSemanticTokens(tokens: SemanticToken[]): SemanticTokens {
  const builder = new SemanticTokensBuilder();

  // Sort tokens by position
  const sortedTokens = [...tokens].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.startChar - b.startChar;
  });

  // Remove overlapping tokens (keep the first one at each position)
  const nonOverlappingTokens: SemanticToken[] = [];
  let lastEndPos = { line: -1, char: -1 };

  for (const token of sortedTokens) {
    const tokenStart = { line: token.line, char: token.startChar };
    const tokenEnd = { line: token.line, char: token.startChar + token.length };

    // Check if this token overlaps with the previous one
    const overlaps =
      tokenStart.line < lastEndPos.line ||
      tokenStart.line === lastEndPos.line && tokenStart.char < lastEndPos.char
      ;

    if (!overlaps) {
      nonOverlappingTokens.push(token);
      lastEndPos = tokenEnd;
    }
  }

  // Use SemanticTokensBuilder for delta encoding
  for (const token of nonOverlappingTokens) {
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
 * Add variable definition tokens to array (instead of builder)
 */
function addVariableDefinitionTokensToArray(
  tokens: SemanticToken[],
  rootNode: SyntaxNode,
  document: LspDocument,
  range?: Range,
): void {
  // Traverse the tree to find variable definitions
  function traverse(node: SyntaxNode): void {
    // Skip nodes outside the range if range is specified
    if (range && !nodeIntersectsRange(node, range)) {
      return;
    }

    // use variable definition checks to add tokens
    if (isVariableDefinitionName(node)) {
      /// get the modifiers based on the type of variable definition
      const modifiers = getVariableDefinitionModifiers(node, document);
      const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
      if (tokenIndex !== -1) {
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.text.length,
          tokenType: tokenIndex,
          tokenModifiers: calculateModifiersMask(modifiers || []),
        });
      }
    } else if (isVariableExpansion(node)) {
      const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
      if (tokenIndex !== -1) {
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.text.length,
          tokenType: tokenIndex,
          tokenModifiers: 0, // No special modifiers for variable expansions
        });
      }
    }
    if (isFunctionDefinitionName(node) || isAliasDefinitionName(node)) {
      const modifiers = getFunctionDefinitionModifiers(node, document);
      const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.function);
      if (tokenIndex !== -1) {
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.text.length,
          tokenType: tokenIndex,
          tokenModifiers: calculateModifiersMask(modifiers),
        });
      }
    }
    if (isGenericFunctionEventHandlerDefinitionName(node)) {
      const modifiers = getFunctionEventHandlerModifiers(node);
      const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.event);
      if (tokenIndex !== -1) {
        tokens.push({
          line: node.startPosition.row,
          startChar: node.startPosition.column,
          length: node.text.length,
          tokenType: tokenIndex,
          tokenModifiers: calculateModifiersMask(modifiers),
        });
      }
    }

    // Check for set variable definitions
    // if (isSetVariableDefinitionName(node)) {
    //   const modifiers = getSetVariableModifiers(node, document);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //   // Check for read variable definitions
    // } else if (isReadVariableDefinitionName(node)) {
    //   const modifiers = getReadVariableModifiers(node, document);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //
    //   // Check for function argument definitions
    // } else if (isFunctionVariableDefinitionName(node)) {
    //   const modifiers = getFunctionArgumentModifiers(node);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.parameter);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //
    //   // Check for alias definitions
    // } else if (isAliasDefinitionName(node)) {
    //   const modifiers = getAliasDefinitionModifiers(node);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.function);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //   // Check for export variable definitions
    // } else if (isExportVariableDefinitionName(node)) {
    //   const modifiers = getExportVariableModifiers(node);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //   // Check for emitted event definitions (emit command)
    // } else if (isEmittedEventDefinitionName(node)) {
    //   const modifiers = getEmittedEventModifiers(node);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.event);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    //   // Check for function event handler definitions (function --on-event)
    // } else if (isGenericFunctionEventHandlerDefinitionName(node)) {
    //   const modifiers = getFunctionEventHandlerModifiers(node);
    //   const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.event);
    //   if (tokenIndex !== -1) {
    //     tokens.push({
    //       line: node.startPosition.row,
    //       startChar: node.startPosition.column,
    //       length: node.text.length,
    //       tokenType: tokenIndex,
    //       tokenModifiers: calculateModifiersMask(modifiers),
    //     });
    //   }
    // }

    // Traverse children
    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(rootNode);
}

function getVariableDefinitionModifiers(node: SyntaxNode, document: LspDocument) {
  if (isSetVariableDefinitionName(node)) {
    return getSetVariableModifiers(node, document);
  }
  if (isReadVariableDefinitionName(node)) {
    return getReadVariableModifiers(node, document);
  }
  if (isFunctionVariableDefinitionName(node)) {
    return getFunctionArgumentModifiers(node);
  }
  if (isAliasDefinitionName(node)) {
    return getAliasDefinitionModifiers(node);
  }
  if (isExportVariableDefinitionName(node)) {
    return getExportVariableModifiers(node);
  }
  if (isEmittedEventDefinitionName(node)) {
    return getEmittedEventModifiers(node);
  }
  if (isGenericFunctionEventHandlerDefinitionName(node)) {
    return getFunctionEventHandlerModifiers(node);
  }
}

export function getFunctionDefinitionModifiers(node: SyntaxNode, document: LspDocument) {
  if (isFunctionDefinitionName(node)) {
    const fishToken = processFunctionDefinition(document, node).at(0);
    if (fishToken?.isLocal()) {
      return [
        FishSemanticTokenModifiers.definition,
        FishSemanticTokenModifiers.local,
      ];
    } else if (fishToken?.isGlobal()) {
      return [
        FishSemanticTokenModifiers.definition,
        FishSemanticTokenModifiers.global,
        FishSemanticTokenModifiers.export,
      ];
    }
  }
  if (isAliasDefinitionName(node)) {
    return getAliasDefinitionModifiers(node);
  }
  return [
    FishSemanticTokenModifiers.definition,
  ];
}

/**
 * Add variable definition tokens with enhanced scope detection (legacy function for backward compatibility)
 */
// function _addVariableDefinitionTokens(
//   builder: SemanticTokensBuilder,
//   rootNode: SyntaxNode,
//   document: LspDocument,
//   range?: Range,
// ): void {
//   // Traverse the tree to find variable definitions
//   function traverse(node: SyntaxNode): void {
//     // Skip nodes outside the range if range is specified
//     if (range && !nodeIntersectsRange(node, range)) {
//       return;
//     }
//     // Check for set variable definitions
//     if (isSetVariableDefinitionName(node)) {
//       const modifiers = getSetVariableModifiers(node, document);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for read variable definitions
//     else if (isReadVariableDefinitionName(node)) {
//       const modifiers = getReadVariableModifiers(node, document);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for function argument definitions
//     else if (isFunctionVariableDefinitionName(node)) {
//       const modifiers = getFunctionArgumentModifiers(node);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.parameter);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for alias definitions
//     else if (isAliasDefinitionName(node)) {
//       const modifiers = getAliasDefinitionModifiers(node);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.function);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for export variable definitions
//     else if (isExportVariableDefinitionName(node)) {
//       const modifiers = getExportVariableModifiers(node);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.variable);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for emitted event definitions (emit command)
//     else if (isEmittedEventDefinitionName(node)) {
//       const modifiers = getEmittedEventModifiers(node);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.event);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Check for function event handler definitions (function --on-event)
//     else if (isGenericFunctionEventHandlerDefinitionName(node)) {
//       const modifiers = getFunctionEventHandlerModifiers(node);
//       const tokenIndex = getTokenTypeIndex(SemanticTokenTypes.event);
//       if (tokenIndex !== -1) {
//         builder.push(
//           node.startPosition.row,
//           node.startPosition.column,
//           node.text.length,
//           tokenIndex,
//           calculateModifiersMask(modifiers),
//         );
//       }
//     }
//
//     // Traverse children
//     for (const child of node.children) {
//       traverse(child);
//     }
//   }
//
//   traverse(rootNode);
// }

/**
 * Get modifiers for set command variable definitions
 */
function getSetVariableModifiers(node: SyntaxNode, _document: LspDocument): string[] {
  const modifiers: (keyof typeof FishSemanticTokenModifiers)[] = [FishSemanticTokenModifiers.definition];
  const command = node.parent;

  if (!command) return modifiers;

  const args = command.childrenForFieldName('argument');
  const options = findOptions(args, SetModifiers);

  // Add scope modifiers based on set flags
  for (const optionMatch of options.found) {
    const option = optionMatch.option;
    if (option.isOption('-l', '--local')) {
      modifiers.push(FishSemanticTokenModifiers.local);
    } else if (option.isOption('-g', '--global')) {
      modifiers.push(FishSemanticTokenModifiers.global);
    } else if (option.isOption('-U', '--universal')) {
      modifiers.push(FishSemanticTokenModifiers.universal);
    } else if (option.isOption('-f', '--function')) {
      // Function scope is similar to local but within function context
      modifiers.push(FishSemanticTokenModifiers.local);
    } else if (option.isOption('-x', '--export')) {
      // Export flag implies global scope
      modifiers.push(FishSemanticTokenModifiers.export);
    }
  }

  return modifiers;
}

/**
 * Get modifiers for read command variable definitions
 */
function getReadVariableModifiers(node: SyntaxNode, _document: LspDocument): string[] {
  const modifiers: (keyof typeof FishSemanticTokenModifiers)[] = [FishSemanticTokenModifiers.definition];
  const command = node.parent;

  if (!command) return modifiers;

  const args = command.childrenForFieldName('argument');

  // Find scope modifiers
  for (const arg of args) {
    const matchedOption = findMatchingOptions(arg, ...ReadModifiers);
    if (matchedOption) {
      if (matchedOption.isOption('-l', '--local')) {
        modifiers.push(FishSemanticTokenModifiers.local);
      } else if (matchedOption.isOption('-g', '--global')) {
        modifiers.push(FishSemanticTokenModifiers.global);
      } else if (matchedOption.isOption('-U', '--universal')) {
        modifiers.push(FishSemanticTokenModifiers.universal);
      } else if (matchedOption.isOption('-f', '--function')) {
        modifiers.push(FishSemanticTokenModifiers.local);
      }
      break;
    }
  }

  // Check for export flags
  if (args.some(arg => arg.text === '-x' || arg.text === '--export')) {
    modifiers.push(FishSemanticTokenModifiers.export);
  }

  return modifiers;
}

/**
 * Get modifiers for function argument definitions
 */
function getFunctionArgumentModifiers(_node: SyntaxNode): string[] {
  const modifiers = [
    FishSemanticTokenModifiers.definition,
    FishSemanticTokenModifiers.local, // Function arguments are always local to the function
  ];

  return modifiers;
}

/**
 * Get modifiers for alias definitions (aliases are like globally exported functions)
 */
function getAliasDefinitionModifiers(_node: SyntaxNode): string[] {
  const modifiers = [
    FishSemanticTokenModifiers.definition,
    FishSemanticTokenModifiers.global, // Aliases are globally available
    FishSemanticTokenModifiers.export,  // Aliases are exported to subshells
  ];

  return modifiers;
}

/**
 * Get modifiers for export variable definitions (export creates global exported variables)
 */
function getExportVariableModifiers(_node: SyntaxNode): string[] {
  const modifiers = [
    FishSemanticTokenModifiers.definition,
    FishSemanticTokenModifiers.global, // Export creates global variables
    FishSemanticTokenModifiers.export,  // Export variables are exported to subshells
  ];

  return modifiers;
}

/**
 * Get modifiers for emitted event definitions (emit command)
 */
function getEmittedEventModifiers(_node: SyntaxNode): string[] {
  const modifiers = [
    FishSemanticTokenModifiers.definition,
    FishSemanticTokenModifiers.global, // Events are globally broadcast
  ];

  return modifiers;
}

/**
 * Get modifiers for function event handler definitions (function --on-event)
 */
function getFunctionEventHandlerModifiers(_node: SyntaxNode): string[] {
  const modifiers = [
    FishSemanticTokenModifiers.definition,
    FishSemanticTokenModifiers.global, // Event handlers respond to global events
    FishSemanticTokenModifiers.readonly, // Event names in handlers are readonly references
  ];

  return modifiers;
}

/**
 * Get appropriate modifiers for a tree-sitter capture
 */
function getModifiersForCapture(capture: QueryCapture, _document: LspDocument): string[] {
  const modifiers: string[] = [];
  const { name, node } = capture;

  // Add modifiers based on capture name patterns
  if (name.includes('builtin')) {
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
 * Registration options for semantic tokens
 */
export const FISH_SEMANTIC_TOKENS_REGISTRATION: SemanticTokensRegistrationOptions = {
  documentSelector: [{ language: 'fish' }],
  legend: FISH_SEMANTIC_TOKENS_LEGEND,
  range: true,
  full: {
    delta: false,
  },
};

