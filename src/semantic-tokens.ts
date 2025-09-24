import {
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensParams,
  SemanticTokensRegistrationOptions,
  SemanticTokensLegend,
  SemanticTokensRangeParams,
  Range,
} from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { Analyzer } from './analyze';
import { LspDocument } from './document';
// import { getChildNodes } from './utils/tree-sitter';
import {
  isCommand,
  isCommandName,
  isFunctionDefinition,
  // isFunctionDefinitionName,
  isVariableDefinitionName,
  // isComment,
  // isString,
  isOption,
  // isReturn,
  // isExit,
  // isVariableExpansion,
  // isForLoop,
  // isIfStatement,
  // isTopLevelFunctionDefinition,
  isBuiltin,
} from './utils/node-types';
import { isBuiltin as checkBuiltin } from './utils/builtins';

/**
 * Semantic token types as defined by LSP specification
 * These map to standard editor highlighting categories
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

export type SemanticTokenType = keyof typeof SemanticTokenTypes;

/**
 * Semantic token modifiers as defined by LSP specification
 * These provide additional context about tokens
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
};

/**
 * Fish-specific semantic token types
 * Extends the standard LSP types for Fish shell constructs
 */
export const FishSemanticTokenTypes = {
  // Standard types
  ...Object.keys(SemanticTokenTypes),

  // Fish-specific extensions
  builtin: 'builtin',           // Fish builtin commands
  option: 'option',             // Command options/flags
  optionValue: 'optionValue',   // Option values
  variableExpansion: 'variableExpansion', // $variable
  commandSubstitution: 'commandSubstitution', // (command)
  braceExpansion: 'braceExpansion', // {a,b,c}
  redirection: 'redirection',   // >, <, |
  escape: 'escape',             // \
  pipe: 'pipe',                 // |
} as const;

/**
 * Complete list of semantic token types for Fish LSP
 */
export const SEMANTIC_TOKEN_TYPES = FishSemanticTokenTypes;

/**
 * Complete list of semantic token modifiers for Fish LSP
 */
export const SEMANTIC_TOKEN_MODIFIERS = Object.values(SemanticTokenModifiers);

/**
 * Legend that defines the semantic tokens supported by the Fish LSP
 */
export const FISH_SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: SEMANTIC_TOKEN_TYPES,
  tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
};

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

/**
 * Tree-sitter grammar to semantic token mapping for Fish shell
 */
export const TREE_SITTER_TO_SEMANTIC_TOKENS: Record<string, {
  type: string;
  modifiers?: string[];
  condition?: (node: SyntaxNode) => boolean;
}> = {
  // Comments
  comment: {
    type: SemanticTokenTypes.comment,
  },

  // Strings
  double_quote_string: {
    type: SemanticTokenTypes.string,
  },
  single_quote_string: {
    type: SemanticTokenTypes.string,
  },

  // Numbers
  integer: {
    type: SemanticTokenTypes.number,
  },

  // Functions
  function_definition: {
    type: SemanticTokenTypes.function,
    modifiers: [SemanticTokenModifiers.declaration, SemanticTokenModifiers.definition],
  },

  // Commands - need special handling to distinguish builtins vs user commands
  command: {
    type: SemanticTokenTypes.function,
    condition: (node: SyntaxNode) => {
      if (isCommand(node)) {
        return true;
      }
      const commandName = node.firstNamedChild?.text;
      return !checkBuiltin(commandName || '');
    },
  },

  // Builtin commands
  builtin_command: {
    type: FishSemanticTokenTypes.builtin,
    modifiers: [SemanticTokenModifiers.defaultLibrary],
    condition: (node: SyntaxNode) => {
      if (isBuiltin(node)) {
        return true;
      }
      const commandName = node.firstNamedChild?.text;
      return checkBuiltin(commandName || '');
    },
  },

  // Variables
  variable_name: {
    type: SemanticTokenTypes.variable,
  },
  variable_expansion: {
    type: FishSemanticTokenTypes.variableExpansion,
  },

  // Control flow keywords
  if: {
    type: SemanticTokenTypes.keyword,
  },
  else: {
    type: SemanticTokenTypes.keyword,
  },
  for: {
    type: SemanticTokenTypes.keyword,
  },
  while: {
    type: SemanticTokenTypes.keyword,
  },
  function: {
    type: SemanticTokenTypes.keyword,
  },
  end: {
    type: SemanticTokenTypes.keyword,
  },
  return: {
    type: SemanticTokenTypes.keyword,
  },
  break: {
    type: SemanticTokenTypes.keyword,
  },
  continue: {
    type: SemanticTokenTypes.keyword,
  },
  switch: {
    type: SemanticTokenTypes.keyword,
  },
  case: {
    type: SemanticTokenTypes.keyword,
  },
  begin: {
    type: SemanticTokenTypes.keyword,
  },

  // Options/Flags
  word: {
    type: FishSemanticTokenTypes.option,
    condition: (node: SyntaxNode) => {
      return node.text.startsWith('-') && node.text !== '-';
    },
  },

  // Command substitution
  command_substitution: {
    type: FishSemanticTokenTypes.commandSubstitution,
  },

  // Brace expansion
  brace_expansion: {
    type: FishSemanticTokenTypes.braceExpansion,
  },

  // Pipes and redirections
  pipe: {
    type: FishSemanticTokenTypes.pipe,
    modifiers: [SemanticTokenModifiers.defaultLibrary],
  },
  file_redirect: {
    type: FishSemanticTokenTypes.redirection,
    modifiers: [SemanticTokenModifiers.defaultLibrary],
  },

  // Operators
  '&&': {
    type: SemanticTokenTypes.operator,
  },
  '||': {
    type: SemanticTokenTypes.operator,
  },

  // Escape sequences
  escape_sequence: {
    type: FishSemanticTokenTypes.escape,
  },
};

/**
 * Get semantic token information for a tree-sitter node
 */
function getSemanticTokenForNode(node: SyntaxNode): {
  type: string;
  modifiers: string[];
} | null {
  const mapping = TREE_SITTER_TO_SEMANTIC_TOKENS[node.type];

  if (!mapping) {
    return null;
  }

  // Check condition if present
  if (mapping.condition && !mapping.condition(node)) {
    return null;
  }

  return {
    type: mapping.type,
    modifiers: mapping.modifiers || [],
  };
}

/**
 * Semantic token provider for Fish shell files
 */
export class FishSemanticTokensProvider {
  constructor(private analyzer: Analyzer) { }

  /**
   * Provide semantic tokens for the full document
   */
  provideSemanticTokens(params: SemanticTokensParams): SemanticTokens {
    const document = this.analyzer.getDocument(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }

    const root = this.analyzer.getRootNode(document.uri);
    if (!root) {
      return { data: [] };
    }

    const builder = new SemanticTokensBuilder();
    this.walkNodeAndCollectTokens(root, builder, document);

    return builder.build();
  }

  /**
   * Provide semantic tokens for a specific range
   */
  provideSemanticTokensRange(params: SemanticTokensRangeParams): SemanticTokens {
    const document = this.analyzer.getDocument(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }

    const root = this.analyzer.getRootNode(document.uri);
    if (!root) {
      return { data: [] };
    }

    const builder = new SemanticTokensBuilder();
    this.walkNodeAndCollectTokensInRange(root, builder, document, params.range);

    return builder.build();
  }

  /**
   * Walk the syntax tree and collect semantic tokens
   */
  private walkNodeAndCollectTokens(
    node: SyntaxNode,
    builder: SemanticTokensBuilder,
    document: LspDocument,
  ): void {
    // Handle specific node types with custom logic
    this.handleSpecialNodes(node, builder, document);

    // Handle general node mapping
    const tokenInfo = getSemanticTokenForNode(node);
    if (tokenInfo) {
      const typeIndex = SEMANTIC_TOKEN_TYPES.indexOf(tokenInfo.type as string as any);
      const modifiersMask = this.calculateModifiersMask(tokenInfo.modifiers);

      if (typeIndex !== -1) {
        builder.push(
          node.startPosition.row,
          node.startPosition.column,
          node.endPosition.column - node.startPosition.column,
          typeIndex,
          modifiersMask,
        );
      }
    }

    // Recursively process children
    for (const child of node.children) {
      this.walkNodeAndCollectTokens(child, builder, document);
    }
  }

  /**
   * Walk nodes in a specific range
   */
  private walkNodeAndCollectTokensInRange(
    node: SyntaxNode,
    builder: SemanticTokensBuilder,
    document: LspDocument,
    range: Range,
  ): void {
    // Check if node intersects with the range
    const nodeIntersects =
      node.startPosition.row <= range.end.line &&
      node.endPosition.row >= range.start.line
    ;

    if (!nodeIntersects) {
      return;
    }

    this.walkNodeAndCollectTokens(node, builder, document);
  }

  /**
   * Handle special cases that need custom logic beyond simple mapping
   */
  private handleSpecialNodes(
    node: SyntaxNode,
    builder: SemanticTokensBuilder,
    _document: LspDocument,
  ): void {
    // Handle function definitions
    if (isFunctionDefinition(node)) {
      const nameNode = node.children.find(child =>
        child.type === 'word' && child !== node.firstChild,
      );
      if (nameNode) {
        const typeIndex = SEMANTIC_TOKEN_TYPES.indexOf(SemanticTokenTypes.function);
        const modifiersMask = this.calculateModifiersMask([
          SemanticTokenModifiers.declaration,
          SemanticTokenModifiers.definition,
        ]);

        builder.push(
          nameNode.startPosition.row,
          nameNode.startPosition.column,
          nameNode.text.length,
          typeIndex,
          modifiersMask,
        );
      }
    }

    // Handle command names - distinguish builtins
    if (isCommand(node) && isCommandName(node.firstNamedChild!)) {
      const commandName = node.firstNamedChild!;
      const isBuiltinCmd = checkBuiltin(commandName.text);

      const tokenType = isBuiltinCmd ? FishSemanticTokenTypes.builtin : SemanticTokenTypes.function;
      const typeIndex = SEMANTIC_TOKEN_TYPES.indexOf(tokenType);
      const modifiers = isBuiltinCmd ? [SemanticTokenModifiers.defaultLibrary] : [];
      const modifiersMask = this.calculateModifiersMask(modifiers);

      if (typeIndex !== -1) {
        builder.push(
          commandName.startPosition.row,
          commandName.startPosition.column,
          commandName.text.length,
          typeIndex,
          modifiersMask,
        );
      }
    }

    // Handle variable definitions
    if (isVariableDefinitionName(node)) {
      const typeIndex = SEMANTIC_TOKEN_TYPES.indexOf(SemanticTokenTypes.variable);
      const modifiersMask = this.calculateModifiersMask([SemanticTokenModifiers.declaration]);

      if (typeIndex !== -1) {
        builder.push(
          node.startPosition.row,
          node.startPosition.column,
          node.text.length,
          typeIndex,
          modifiersMask,
        );
      }
    }

    // Handle options/flags
    if (node.type === 'word' && isOption(node)) {
      const typeIndex = SEMANTIC_TOKEN_TYPES.indexOf(FishSemanticTokenTypes.option);
      const modifiersMask = this.calculateModifiersMask([]);

      if (typeIndex !== -1) {
        builder.push(
          node.startPosition.row,
          node.startPosition.column,
          node.text.length,
          typeIndex,
          modifiersMask,
        );
      }
    }
  }

  /**
   * Calculate modifiers bitmask
   */
  private calculateModifiersMask(modifiers: string[]): number {
    let mask = 0;
    for (const modifier of modifiers) {
      const index = SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier as string as any);
      if (index !== -1) {
        mask |= 1 << index;
      }
    }
    return mask;
  }
}
