import { SyntaxNode } from 'web-tree-sitter';
import { analyzer, EnsuredAnalyzeDocument } from './analyze';
import * as LSP from 'vscode-languageserver';
import { logger } from './logger';
import { FishSymbol } from './parsing/symbol';
import { flattenNested } from './utils/flatten';
import { createTokensFromMatches, getTextMatchPositions, getTokenTypeIndex, getVariableModifiers, SemanticToken, SemanticTokenTypes } from './utils/semantics';
import { isCommandName, isCommandWithName, isEndStdinCharacter, isShebang, isVariableExpansion } from './utils/node-types';
import { LspDocument } from './document';
import { ModifierTypes, TokenTypes } from './semantic-tokens';
import { BuiltInList } from './utils/builtins';
import { isDiagnosticComment } from './diagnostics/comments-handler';
import { getRange, isNodeWithinRange } from './utils/tree-sitter';
import { rangeContainsSyntaxNode } from './parsing/equality-utils';

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

function symbolToSemanticToken(symbol: FishSymbol): SemanticToken | null {
  if (symbol.isFunction()) {
    // Highlight alias names as functions (the alias name itself, not the 'alias' keyword)
    // The 'alias' keyword is handled by the keyword handler
    return {
      line: symbol.selectionRange.start.line,
      startChar: symbol.selectionRange.start.character,
      length: symbol.selectionRange.end.character - symbol.selectionRange.start.character,
      tokenType: getTokenTypeIndex(SemanticTokenTypes.function),
      tokenModifiers: 0,
    };
  } else if (symbol.isVariable()) {
    // Use selectionRange which excludes the $ prefix
    const startChar = symbol.selectionRange.start.character;
    const length = symbol.selectionRange.end.character - startChar;

    // Skip if the length is invalid (could be shebang or other non-variable symbol)
    if (length <= 0) {
      return null;
    }

    return {
      line: symbol.selectionRange.start.line,
      startChar,
      length,
      tokenType: getTokenTypeIndex(SemanticTokenTypes.variable),
      tokenModifiers: 0,
    };
  }
  return null;
}

const isKeyword = (n: SyntaxNode) => [
  ...BuiltInList,
  'in', // for loop keyword: "for item in list"
].includes(n.type) || isCommandWithName(n, 'alias');

const isCommandCall = (n: SyntaxNode) => {
  if (isKeyword(n)) return false;
  // Don't match [ test command here - it has special handling
  if (isCommandWithName(n, '[')) return false;
  if (isCommandName(n)) return true;
  return false;
};

const isBracketTestCommand = (n: SyntaxNode) => isCommandWithName(n, '[');

type isNodeMatch = (node: SyntaxNode) => boolean;
type nodeToTokenFunc = (node: SyntaxNode, ctx: SemanticTokenContext) => void;
type NodeToToken = [isNodeMatch, nodeToTokenFunc];

const nodeToTokenHandler: NodeToToken[] = [
  // `#!/usr/bin/env fish`
  [isShebang, (n, ctx) => {
    ctx.tokens.push(
      SemanticToken.fromNode(n, TokenTypes.decorator, ModifierTypes.decorator),
    );
  }],

  // `# @fish-lsp-disable ...` - only highlight the @fish-lsp-* part
  [isDiagnosticComment, (n, ctx) => {
    ctx.tokens.push(
      ...createTokensFromMatches(
        getTextMatchPositions(n, /@fish-lsp-(enable|disable)(?:-next-line)?/g),
        TokenTypes.keyword,
        ModifierTypes.keyword,
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
          SemanticToken.fromNode(openBracket, TokenTypes.command, ModifierTypes.command),
        );
      }
    }

    // Find the closing ] in the last argument
    const lastChild = n.lastNamedChild;
    if (lastChild && lastChild.type === 'word') {
      const closeBracket = lastChild.firstChild;
      if (closeBracket && closeBracket.type === ']') {
        ctx.tokens.push(
          SemanticToken.fromNode(closeBracket, TokenTypes.command, ModifierTypes.command),
        );
      }
    }
  }],

  // built-in keywords: `if`, `else`, `for`, etc.
  [isKeyword, (n, ctx) => {
    // For command nodes, only highlight the first child (the keyword itself)
    // For non-command nodes (like standalone keywords), highlight the whole node
    const targetNode = n.type === 'command' && n.firstNamedChild ? n.firstNamedChild : n;
    ctx.tokens.push(
      SemanticToken.fromNode(targetNode, TokenTypes.keyword, ModifierTypes.keyword),
    );
  }],

  // command calls (excluding [ test command which has special handling above)
  [isCommandCall, (n, ctx) => {
    const cmd = n.firstNamedChild;
    if (!cmd) return;
    ctx.tokens.push(
      SemanticToken.fromNode(cmd, TokenTypes.command, ModifierTypes.command),
    );
  }],

  // variable expansions
  [isVariableExpansion, (n, ctx) => {
    const variableName = n.text.replace(/^\$/, '');
    const modifiers = getVariableModifiers(variableName, ctx.document.uri);

    ctx.tokens.push(
      ...createTokensFromMatches(
        getTextMatchPositions(n, /[^$]+/),
        TokenTypes.variable,
        modifiers,
      ),
    );
  }],

  // special end-of-stdin character `--`
  [isEndStdinCharacter, (n, ctx) => {
    ctx.tokens.push(
      SemanticToken.fromNode(n, TokenTypes.operator, ModifierTypes.operator),
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

    // if (isShebangComment(node)) {
    //   focusedNodes.push(node);
    // }
    // if (isDisableDiagnosticsComment(node)) {
    //   focusedNodes.push(node);
    // }
    // if (isCommandName(node)) {
    //   focusedNodes.push(node);
    // }
    // if (isVariableExpansion(node)) {
    //   focusedNodes.push(node);
    // }
    // if (isEndStdinCharacter(node)) {
    //   focusedNodes.push(node);
    // }
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

  public static create({document, tokens = []}: {
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
    }
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
