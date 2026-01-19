import { SyntaxNode } from 'web-tree-sitter';
import { analyzer, EnsuredAnalyzeDocument } from './analyze';
import * as LSP from 'vscode-languageserver';
import { logger } from './logger';
import { FishSymbol } from './parsing/symbol';
import { flattenNested } from './utils/flatten';
import { calculateModifiersMask, createTokensFromMatches, getTextMatchPositions, getVariableModifiers, SemanticToken, SemanticTokenModifier, FishSemanticTokens } from './utils/semantics';
import { isCommandName, isCommandWithName, isEndStdinCharacter, isShebang, isVariableExpansion } from './utils/node-types';
import { LspDocument } from './document';
import { BuiltInList } from './utils/builtins';
import { isDiagnosticComment } from './diagnostics/comments-handler';
import { getRange, isNodeWithinRange } from './utils/tree-sitter';
import { getSymbolModifiers } from './parsing/symbol-modifiers';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { AutoloadedPathVariables } from './utils/process-env';

/**
 * We only want to return the semantic tokens that clients aren't highlighting, since
 * they likely don't use analysis to determine which arguments/words in a script are
 * defining symbols.
 *
 * Cases which we want to return semantic tokens for:
 *   - FishSymbol definitions and references:
 *      - Function definitions (so that function names can be highlighted differently)
 *      - Function calls (so that function calls can be highlighted differently)
 *      - Variable definitions (so that variable names can be highlighted differently)
 *      - Variable references (so that variable references can be highlighted differently)
 *   - Special tokens: `--`
 *   - Special comments:
 *      - Disable diagnostics comments: `# @fish-lsp-disable ...`
 *      - Shebangs: `#!/usr/bin/env fish`
 *
 * We really don't care about modifier support at this time. Since we've already worked
 * pretty significantly to resolve these correctly directly from a FishSymbol, we can
 * determine what/which modifiers to include once more language clients clarify
 * how they would like to handle them.
 */

/**
 * Convert modifier names to bitmask, filtering out unsupported modifiers.
 */
function modifiersToBitmask(modifiers: SemanticTokenModifier[]): number {
  return modifiers.reduce((mask, mod) => {
    const idx = FishSemanticTokens.legend.tokenModifiers.indexOf(mod);
    return idx >= 0 ? mask | 1 << idx : mask;
  }, 0);
}

function symbolToSemanticToken(symbol: FishSymbol): SemanticToken | null {
  if (symbol.isFunction()) {
    // Get modifiers from the symbol using getSymbolModifiers
    // This filters to only supported modifiers (no autoloaded, not-autoloaded, script, etc.)
    const mods = getSymbolModifiers(symbol);

    // Highlight alias names as functions (the alias name itself, not the 'alias' keyword)
    // The 'alias' keyword is handled by the keyword handler
    return {
      line: symbol.selectionRange.start.line,
      startChar: symbol.selectionRange.start.character,
      length: symbol.selectionRange.end.character - symbol.selectionRange.start.character,
      tokenType: FishSemanticTokens.types.function,
      tokenModifiers: modifiersToBitmask(mods),
    };
  } else if (symbol.isVariable()) {
    // Use selectionRange which excludes the $ prefix
    const startChar = symbol.selectionRange.start.character;
    const length = symbol.selectionRange.end.character - startChar;

    // Skip if the length is invalid (could be shebang or other non-variable symbol)
    if (length <= 0) {
      return null;
    }

    // Get modifiers from the symbol
    const mods = getSymbolModifiers(symbol);

    return {
      line: symbol.selectionRange.start.line,
      startChar,
      length,
      tokenType: FishSemanticTokens.types.variable,
      tokenModifiers: modifiersToBitmask(mods),
    };
  }
  return null;
}

/**
 * Structural keywords that modify control flow or define blocks.
 * These are highlighted as keywords, not functions.
 */
const STRUCTURAL_KEYWORDS = [
  'function', 'end',
  'if', 'else',
  'for', 'while', 'in',
  'switch', 'case',
  'and', 'or', 'not',
  'break', 'continue', 'return', 'exit',
  'begin',
  'alias',
];

/**
 * Check if a node is a structural keyword.
 * These are block-modifying keywords like `if`, `for`, `function`, etc.
 */
const isStructuralKeyword = (n: SyntaxNode): boolean => {
  // Direct node type match (e.g., 'function', 'end', 'in')
  if (STRUCTURAL_KEYWORDS.includes(n.type)) {
    return true;
  }

  // For command nodes, check the command name
  if (n.type === 'command' || isCommandName(n)) {
    const cmdName = n.type === 'command' && n.firstNamedChild
      ? n.firstNamedChild.text
      : n.text;
    return STRUCTURAL_KEYWORDS.includes(cmdName);
  }

  return false;
};

/**
 * Check if a command is a builtin function (not a structural keyword).
 * These are commands from `builtin -n` that aren't structural keywords.
 * Examples: echo, set, path, source, fish_key_reader
 */
const isBuiltinFunction = (n: SyntaxNode): boolean => {
  if (n.type !== 'command') return false;

  const cmdName = n.firstNamedChild;
  if (!cmdName) return false;

  // Must be in builtin list and NOT a structural keyword
  return BuiltInList.includes(cmdName.text) && !STRUCTURAL_KEYWORDS.includes(cmdName.text);
};

/**
 * Check if a command is a user-defined or fish-shipped function call.
 * Excludes structural keywords and builtin functions.
 */
const isUserFunction = (n: SyntaxNode): boolean => {
  if (n.type !== 'command') return false;
  if (isStructuralKeyword(n)) return false;
  if (isBuiltinFunction(n)) return false;
  if (isCommandWithName(n, '[')) return false; // Special handling for bracket test
  return true;
};

const isBracketTestCommand = (n: SyntaxNode) => isCommandWithName(n, '[');

type isNodeMatch = (node: SyntaxNode) => boolean;
type nodeToTokenFunc = (node: SyntaxNode, ctx: SemanticTokenContext) => void;
type NodeToToken = [isNodeMatch, nodeToTokenFunc];

const nodeToTokenHandler: NodeToToken[] = [
  // `#!/usr/bin/env fish`
  [isShebang, (n, ctx) => {
    ctx.tokens.push(
      SemanticToken.fromNode(n, FishSemanticTokens.types.decorator, 0),
    );
  }],

  // `# @fish-lsp-disable ...` - only highlight the @fish-lsp-* part
  [isDiagnosticComment, (n, ctx) => {
    ctx.tokens.push(
      ...createTokensFromMatches(
        getTextMatchPositions(n, /@fish-lsp-(enable|disable)(?:-next-line)?/g),
        FishSemanticTokens.types.keyword,
        0,
      ),
    );
  }],

  // Special handling for `[` test command - highlight opening [ and closing ]
  // Example: [ -f /tmp/foo.fish ] or [ -n "string" ]
  // This ensures we don't confuse it with array indexing like $arr[0]
  [isBracketTestCommand, (n, ctx) => {
    const firstChild = n.firstNamedChild;
    if (firstChild && firstChild.type === 'word') {
      // Find the opening [ token within the word node
      const openBracket = firstChild.firstChild;
      if (openBracket && openBracket.type === '[') {
        ctx.tokens.push(
          SemanticToken.fromNode(openBracket, FishSemanticTokens.types.function, calculateModifiersMask('builtin')),
        );
      }
    }

    // Find the closing ] in the last argument
    const lastChild = n.lastNamedChild;
    if (lastChild && lastChild.type === 'word') {
      const closeBracket = lastChild.firstChild;
      if (closeBracket && closeBracket.type === ']') {
        ctx.tokens.push(
          SemanticToken.fromNode(closeBracket, FishSemanticTokens.types.function, calculateModifiersMask('builtin')),
        );
      }
    }
  }],

  // Structural keywords: `if`, `for`, `function`, `alias`, etc.
  [isStructuralKeyword, (n, ctx) => {
    // For command nodes, only highlight the first child (the keyword itself)
    // For non-command nodes (like standalone keywords), highlight the whole node
    const targetNode = n.type === 'command' && n.firstNamedChild ? n.firstNamedChild : n;
    ctx.tokens.push(
      SemanticToken.fromNode(targetNode, FishSemanticTokens.types.keyword, 0),
    );
  }],

  // Builtin functions: `echo`, `set`, `path`, `source`, etc.
  // These are commands from `builtin -n` but not structural keywords
  [isBuiltinFunction, (n, ctx) => {
    const cmd = n.firstNamedChild;
    if (!cmd) return;
    ctx.tokens.push(
      SemanticToken.fromNode(cmd, FishSemanticTokens.types.function, calculateModifiersMask('defaultLibrary')),
    );
  }],

  // User-defined or fish-shipped function calls
  [isUserFunction, (n, ctx) => {
    const cmd = n.firstNamedChild;
    if (!cmd) return;

    // Look up the function symbol to get its modifiers
    let modifiers = 0;
    const localSymbols = analyzer.cache.getFlatDocumentSymbols(ctx.document.uri);
    const funcSymbol = localSymbols.find(s => s.isFunction() && s.name === cmd.text);

    if (funcSymbol) {
      // Use getSymbolModifiers and filter to supported modifiers
      const mods = getSymbolModifiers(funcSymbol).filter(m =>
        FishSemanticTokens.legend.tokenModifiers.includes(m as any),
      );
      modifiers = modifiersToBitmask(mods);
    } else {
      // Check global symbols
      const globalSymbols = analyzer.globalSymbols.find(cmd.text);
      const globalFunc = globalSymbols.find(s => s.isFunction());
      if (globalFunc) {
        const mods = getSymbolModifiers(globalFunc).filter(m =>
          FishSemanticTokens.legend.tokenModifiers.includes(m as any),
        );
        modifiers = modifiersToBitmask(mods);
      } else {
        // Check if it's a fish-shipped function
        const fishShippedDocs = PrebuiltDocumentationMap.getByName(cmd.text);
        const isFishShipped = fishShippedDocs.some(doc => doc.type === 'function');
        if (isFishShipped) {
          modifiers = calculateModifiersMask('defaultLibrary');
        } else {
          // Last resort: check if this could be an autoloaded function
          // by searching fish_function_path directories
          const autoloadedPath = AutoloadedPathVariables.findAutoloadedFunctionPath(cmd.text);
          if (autoloadedPath) {
            modifiers = calculateModifiersMask('global');
          }
        }
      }
    }

    ctx.tokens.push(
      SemanticToken.fromNode(cmd, FishSemanticTokens.types.function, modifiers),
    );
  }],

  // variable expansions
  [isVariableExpansion, (n, ctx) => {
    const variableName = n.text.replace(/^\$/, '');
    const modifiers = getVariableModifiers(variableName, ctx.document.uri);

    ctx.tokens.push(
      ...createTokensFromMatches(
        getTextMatchPositions(n, /[^$]+/),
        FishSemanticTokens.types.variable,
        modifiers,
      ),
    );
  }],

  // special end-of-stdin character `--`
  [isEndStdinCharacter, (n, ctx) => {
    ctx.tokens.push(
      SemanticToken.fromNode(n, FishSemanticTokens.types.operator, 0),
    );
  }],

  // number literals: integers and floats
  [(n) => n.type === 'integer' || n.type === 'float', (n, ctx) => {
    ctx.tokens.push(
      SemanticToken.fromNode(n, FishSemanticTokens.types.number, 0),
    );
  }],

];

export function getSemanticTokensSimplest(analyzedDoc: EnsuredAnalyzeDocument, range: LSP.Range) {
  const nodes = analyzer.getNodes(analyzedDoc.document.uri);
  const symbols = flattenNested(...analyzedDoc.documentSymbols);

  // create hashmap of semantic tokens? or something for O(1)ish lookups so that other
  // types of tokens that we create can immediately be skipped if they already exist.

  const ctx: SemanticTokenContext = SemanticTokenContext.create({ document: analyzedDoc.document });

  for (const symbol of symbols) {
    if (!symbol.focusedNode) continue;
    if (range && !isNodeWithinRange(symbol.focusedNode, range)) continue;

    const token = symbolToSemanticToken(symbol);
    if (token) {
      ctx.add(token);
    }
  }

  // now we're just about done!
  for (const node of nodes) {
    // out of range
    if (!isNodeWithinRange(node, range)) {
      continue;
    }

    // filter out dupes
    if (ctx.hasNode(node)) {
      continue;
    }
    // ^^^ consider avoiding this till the end to limit runtime complexity? ^^^

    nodeToTokenHandler.find(([isMatch, toToken]) => {
      if (isMatch(node)) {
        toToken(node, ctx);
        return true; // Stop searching once we find a match
      }
      return false;
    });
  }

  return ctx.build();
}

const hashToken = (token: SemanticToken): string => {
  return `${token.line}:${token.startChar}:${token.tokenType}`;
};

class SemanticTokenContext {
  private constructor(
    public document: LspDocument,
    public tokens: SemanticToken[] = [],
    private seenTokens: Map<string, SemanticToken> = new Map<string, SemanticToken>(),
  ) { }

  public static create({ document, tokens = [] }: {
    document: LspDocument;
    tokens?: SemanticToken[];
  }): SemanticTokenContext {
    return new SemanticTokenContext(document, tokens);
  }

  public has(token: SemanticToken): boolean {
    return this.seenTokens.has(hashToken(token));
  }
  public hasNode(node: SyntaxNode): boolean {
    const token = SemanticToken.fromNode(node, 0, 0);
    return this.seenTokens.has(hashToken(token));
  }

  public add(...tokens: SemanticToken[]): void {
    for (const token of tokens) {
      if (!this.seenTokens.has(hashToken(token))) {
        this.seenTokens.set(hashToken(token), token);
        this.tokens.push(token);
      }
    }
  }

  public get size(): number {
    return this.tokens.length;
  }

  public getTokens(): SemanticToken[] {
    return this.tokens;
  }

  public clear(): void {
    this.tokens.length = 0;
    this.seenTokens.clear();
    this.tokens = [];
  }

  public show(): void {
    logger.log({
      document: this.document?.uri,
      size: this.size,
      tokens: this.tokens,
      seenTokens: Array.from(this.seenTokens.values()),
    });
  }

  public build() {
    const builder = new LSP.SemanticTokensBuilder();

    // Sort tokens by position
    const sortedTokens = [...this.tokens].sort((a, b) => {
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
}

type SemanticTokensParams = LSP.SemanticTokensParams | LSP.SemanticTokensRangeParams;
/**
 * Type guards for distinguishing between full and range semantic token requests.
 */
export namespace Semantics {
  export const params = {
    isFull(params: SemanticTokensParams): params is LSP.SemanticTokensParams {
      return (
        (params as LSP.SemanticTokensParams).textDocument !== undefined &&
        (params as LSP.SemanticTokensRangeParams).range === undefined
      );
    },
    isRange(params: SemanticTokensParams): params is LSP.SemanticTokensRangeParams {
      return (params as LSP.SemanticTokensRangeParams).range !== undefined;
    },
  };
  export const response = {
    empty: (): LSP.SemanticTokens => ({ data: [] }),
  };
}

/**
 * Main handler for semantic token requests.
 */
export function semanticTokenHandler(params: SemanticTokensParams): LSP.SemanticTokens {
  // retrieve the analyzed document for the requested URI
  const cachedDoc = analyzer.cache.getDocument(params.textDocument.uri)?.ensureParsed();
  if (!cachedDoc) {
    logger.warning(`No analyzed document found for URI: ${params.textDocument.uri}`);
    return Semantics.response.empty();
  }

  /* handle our 2 use cases */

  if (Semantics.params.isRange(params)) {
    return getSemanticTokensSimplest(cachedDoc, params.range);
  } else if (Semantics.params.isFull(params)) {
    return getSemanticTokensSimplest(cachedDoc, getRange(cachedDoc.root));
  }

  return Semantics.response.empty();
}
