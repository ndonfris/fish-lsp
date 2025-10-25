import { getTokenTypeIndex, SemanticToken, calculateModifiersMask, getQueriesList, getCaptureToTokenMapping } from '../utils/semantics';
import { LspDocument } from '../document';
import { SyntaxNode } from 'web-tree-sitter';
import { isBuiltinCommand, isCommand, isCommandWithName, isComment, isShebang, isEscapeSequence, isOption } from '../utils/node-types';
import { BuiltInList, isBuiltin } from '../utils/builtins';
import { TokenTypes, ModifierTypes } from './types';
import { getCommandModifiers } from './command-modifiers';
import { getTextMatchPositions, createTokensFromMatches } from '../utils/semantics';
import { bracketTransormer } from './transformers';

export type TokenTransformContext = {
  tokens: SemanticToken[];
  document: LspDocument;
};

type NodeTokenHandler = [
  predicate: (node: SyntaxNode) => boolean,
  transform: (node: SyntaxNode, context: TokenTransformContext) => void,
];


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
export const semanticTokenHandlers: NodeTokenHandler[] = [
  // Special handling for `[` test command - highlight opening [ and closing ]
  [
    isBracketCommand,
    bracketTransormer
   
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
