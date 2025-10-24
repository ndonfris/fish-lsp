import {
  SemanticTokensLegend,
  Range,
  Position,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { highlights } from '@ndonfris/tree-sitter-fish';

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
    tokenType: FishSemanticTokenType;
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
  shebang: 'shebang',
  flag: 'flag',
  argument: 'argument',
  path: 'path',
  filename: 'filename',
} as const;

export type FishSemanticTokenModifier = keyof typeof FishSemanticTokenModifiers;
export type FishSemanticTokenType = keyof typeof SemanticTokenTypes;

export const SEMANTIC_TOKEN_MODIFIERS = Object.values(FishSemanticTokenModifiers);

/**
 * Tree-sitter capture name to LSP semantic token type mappings
 */
const CAPTURE_TO_TOKEN_MAPPINGS: Record<string, string> = {
  keyword: SemanticTokenTypes.keyword,
  function: SemanticTokenTypes.function,
  string: SemanticTokenTypes.string,
  'string.escape': SemanticTokenTypes.string,
  'string.special': SemanticTokenTypes.string,
  number: SemanticTokenTypes.number,
  comment: SemanticTokenTypes.comment,
  operator: SemanticTokenTypes.operator,
  'punctuation.bracket': SemanticTokenTypes.operator,
  'punctuation.delimiter': SemanticTokenTypes.operator,
  constant: SemanticTokenTypes.variable,
  'constant.builtin': SemanticTokenTypes.variable,
  variable: SemanticTokenTypes.variable,
  event: SemanticTokenTypes.event,
  parameter: SemanticTokenTypes.parameter,
  property: SemanticTokenTypes.property,
  decorator: SemanticTokenTypes.decorator,
};

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
        const fixedQuery = currentQuery.trim();
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

function mapCaptureToTokenType(captureName: string): string {
  if (CAPTURE_TO_TOKEN_MAPPINGS[captureName]) {
    return CAPTURE_TO_TOKEN_MAPPINGS[captureName];
  }

  const baseName = captureName.split('.')[0];
  if (baseName && CAPTURE_TO_TOKEN_MAPPINGS[baseName]) {
    return CAPTURE_TO_TOKEN_MAPPINGS[baseName];
  }

  return SemanticTokenTypes.variable;
}

function generateDynamicLegendFromTreeSitter(): SemanticTokensLegend {
  const captureNames = extractCaptureNames(highlights);
  const tokenTypes = new Set<string>();

  for (const captureName of captureNames) {
    const tokenType = mapCaptureToTokenType(captureName);
    tokenTypes.add(tokenType);
  }

  tokenTypes.add(SemanticTokenTypes.event);
  tokenTypes.add(SemanticTokenTypes.parameter);
  tokenTypes.add(SemanticTokenTypes.property);
  tokenTypes.add(SemanticTokenTypes.decorator);

  return {
    tokenTypes: Array.from(tokenTypes).sort(),
    tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
  };
}

export const FISH_SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = generateDynamicLegendFromTreeSitter();

export function getTokenTypeIndex(tokenType: string): number {
  return FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf(tokenType);
}

export function getModifierIndex(modifier: string): number {
  return FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(modifier);
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
  const tokenTypesArray = FISH_SEMANTIC_TOKENS_LEGEND.tokenTypes;
  const tokenType = tokenTypesArray[tokenTypeIndex];

  if (!tokenType) {
    return 30;
  }

  const pathModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('path');
  const filenameModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('filename');
  const definitionModifierIndex = FISH_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('definition');

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
