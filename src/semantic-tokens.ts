import { SyntaxNode } from 'web-tree-sitter';
import { analyzer, EnsuredAnalyzeDocument } from './analyze';
import * as LSP from 'vscode-languageserver';
import { logger } from './logger';
import { FishSymbol } from './parsing/symbol';
import { flattenNested } from './utils/flatten';
import { calculateModifiersMask, createTokensFromMatches, getTextMatchPositions, getVariableModifiers, SemanticToken, SemanticTokenModifier, FishSemanticTokens } from './utils/semantics';
import { findParentCommand, getCommandNameNode, getCommandNameText, isCommandName, isCommandWithName, isEndStdinCharacter, isOption, isShebang, isString, isVariableDefinitionName, isVariableExpansion } from './utils/node-types';
import { LspDocument } from './document';
import { BuiltInList } from './utils/builtins';
import { config } from './config';
import { isDiagnosticComment } from './diagnostics/comments-handler';
import { getRange, isNodeWithinRange } from './utils/tree-sitter';
import { getSymbolModifiers } from './parsing/symbol-modifiers';
import { PrebuiltDocumentationMap } from './utils/snippets';
import { AutoloadedPathVariables } from './utils/process-env';
import { subcommandCache } from './utils/subcommand-cache';
import { isSetDefinition, isSetVariableDefinitionName } from './parsing/set';
import { Option, isMatchingOption } from './parsing/options';
import { FishString } from './parsing/string';

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

/**
 * Build a semantic token directly from an analyzed symbol when symbol analysis
 * already knows the correct token kind and modifier set.
 */
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
 * Structural keywords modify control flow or delimit blocks and should be tokenized
 * as `keyword`, not as builtin/user functions.
 */
namespace StructuralKeywords {
  /**
   * COMMANDS that indicate a structural keyword block or control flow modification.
   * This includes block delimiters like `if`, `for`, `function`, etc.
   */
  const COMMAND = new Set([
    'function', 'end',
    'if', 'else',
    'for', 'while', 'in',
    'switch', 'case',
    'and', 'or', 'not',
    'break', 'continue', 'return', 'exit',
    'begin',
    'alias',
  ]);

  const CHAR_SEQUENCE = new Set([
    '&&',
    '||',
  ]);

  /**
   * Normalize the command name from either a full `command` node or its command
   * name child so the rest of the namespace can classify both shapes uniformly.
   */
  function getCommandName(n: SyntaxNode): string | null {
    if (n.type === 'command') {
      return getCommandNameText(n) ?? null;
    }
    if (isCommandName(n)) {
      return n.text;
    }
    return null;
  }

  function isBracket(n: SyntaxNode): boolean {
    if (!n.parent || n.parent.type !== 'begin_statement') return false;
    if (n.type === '{') return n.parent.firstChild?.equals(n) ?? false;
    if (n.type === '}') return n.parent.lastChild?.equals(n) ?? false;
    return false;
  }

  function isNegation(n: SyntaxNode): boolean {
    return n.type === '!' && !!n.parent && (n.parent.isError || n.parent.type === 'negated_statement');
  }

  /**
   * Match structural syntax that is not represented as a normal command name.
   * This covers operator-like keywords and the brace sugar for begin/end blocks.
   */
  function isSyntaxKeyword(n: SyntaxNode): boolean {
    if (COMMAND.has(n.type)) return true;
    if (CHAR_SEQUENCE.has(n.type)) return true;
    if (isNegation(n)) return true;
    if (isBracket(n)) return true;
    return false;
  }

  /**
   * Determine whether a command-like node should be treated as a structural
   * keyword command instead of a builtin or user function call.
   */
  export function isCommand(n: SyntaxNode): boolean {
    const commandName = getCommandName(n);
    if (commandName && commandName.includes('$')) return false;
    return !!commandName && COMMAND.has(commandName);
  }

  /**
   * Return the exact node span that should receive keyword highlighting for a
   * structural construct.
   */
  export function targetNode(n: SyntaxNode): SyntaxNode | null {
    if (n.type === 'command') {
      return isCommand(n) ? getCommandNameNode(n) : null;
    }
    if (isCommandName(n)) {
      return isCommand(n) ? n : null;
    }
    return isSyntaxKeyword(n) ? n : null;
  }

  /**
   * Expose normalized command-name lookup for other token classifiers while
   * keeping the parsing details internal to this namespace.
   */
  export function commandName(n: SyntaxNode): string | null {
    return getCommandName(n);
  }
}

/**
 * Check if a node is a structural keyword.
 * These are block-modifying keywords like `if`, `for`, `function`, etc.
 */
export const isStructuralKeyword = (n: SyntaxNode): boolean => {
  return !!StructuralKeywords.targetNode(n);
};

/**
 * Check if a command is a builtin function (not a structural keyword).
 * These are commands from `builtin -n` that aren't structural keywords.
 * Examples: echo, set, path, source, fish_key_reader
 */
const isBuiltinFunction = (n: SyntaxNode): boolean => {
  if (n.type !== 'command') return false;
  if (StructuralKeywords.isCommand(n)) return false;

  const cmdName = StructuralKeywords.commandName(n);
  return !!cmdName && BuiltInList.includes(cmdName);
};

/**
 * Check if a node is a boolean literal `true` or `false` used as an argument rather
 * than a command name. This is a bit tricky since `true` and `false` can either commands
 * or literal values depending on context.
 *
 * We want to highlight them as literals when used as arguments for either case:
 *
 * - `set var true` (true is a literal value, not a command)
 * - `set var false` (false is a literal value, not a command)
 * - `set var 'true' 'false'` (true is a literal value for the command, not a command itself, and same for false)
 *
 */
export const isBooleanLiteral = (n: SyntaxNode): boolean => {
  if (isCommandName(n) && n.parent && isCommandWithName(n.parent, ':')) {
    return true;
  }

  if (isVariableDefinitionName(n)) {
    return false;
  }

  if (n.type !== 'word' && !isString(n)) return false;

  const text = FishString.parse(n);

  // Only single word/string literals can be boolean literals
  if (text.split(' ').length > 1) return false;
  if (text !== 'true' && text !== 'false') return false;

  const parentCommand = findParentCommand(n);
  if (!parentCommand) return true;

  const commandName = getCommandNameNode(parentCommand);
  if (!commandName) return true;

  if (commandName.equals(n)) return false;
  if (n.parent && commandName.equals(n.parent)) return false;

  return true;
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
  // Skip only when the command *name* is a variable expansion (e.g. `$var foo`),
  // not when an argument merely contains `$` (e.g. `export PATH=$PATH`, `ls $HOME`).
  if (getCommandNameNode(n)?.text.includes('$')) return false;
  return true;
};

/**
 * Detect the `[` builtin specifically so the surrounding `[` and `]` tokens can
 * be highlighted as command syntax rather than confused with array indexing.
 */
const isBracketTestCommand = (n: SyntaxNode) => isCommandWithName(n, '[');

/**
 * Check if a node is a target variable reference in a `set -q/-e/-S` command. These are
 * not represented as FishSymbol definitions, but we want to highlight them as variable references.
 *
 * Example: `set -q PATH` - we want to highlight `PATH` as a variable reference, even though it's not a FishSymbol definition.
 */
export const isSetQueryEraseOrShowTargetNode = (n: SyntaxNode): boolean => {
  if (!isSetVariableDefinitionName(n, false)) return false;
  if (n.type === 'concatenation') return false;

  const parentCommand = findParentCommand(n);
  if (!parentCommand || !isCommandWithName(parentCommand, 'set')) return false;
  if (isSetDefinition(parentCommand)) return false;
  if (!hasSetQueryEraseOrShowOption(parentCommand)) return false;

  const args = parentCommand.childrenForFieldName('argument').filter(arg => !isOption(arg));
  return args.some(arg => arg.equals(n) || arg.type === 'concatenation' && arg.firstNamedChild?.equals(n));
};

/**
 * Extract the variable name from a variable expansion node, removing the leading `$`
 * and any array indexing. For example:
 * - `$var` => `var`
 * - `$var[0]` => `var`
 * - `$var[1..-10]` => `var`
 */
export const extractVariableNameFromNode = (n: SyntaxNode): string | null => {
  let variableName = n.text.replace(/^\$+/, '');
  if (!variableName) return null;
  if (variableName.includes('[') && variableName.includes(']')) {
    variableName = variableName.slice(0, variableName.indexOf('['));
  }
  return variableName;
};

function variableExpansionNodeToSemanticToken(
  n: SyntaxNode,
  modifiers: number,
): SemanticToken | null {
  const variableName = extractVariableNameFromNode(n);
  if (!variableName) return null;

  const dollarPrefixLength = n.text.match(/^\$+/)?.[0].length ?? 0;
  return SemanticToken.create(
    n.startPosition.row,
    n.startPosition.column + dollarPrefixLength,
    variableName.length,
    FishSemanticTokens.types.variable,
    modifiers,
  );
}

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
    const cmdName = getCommandNameNode(n);
    if (cmdName && cmdName.type === 'word') {
      // Find the opening [ token within the word node
      const openBracket = cmdName.firstChild;
      if (openBracket && openBracket.type === '[') {
        ctx.tokens.push(
          SemanticToken.fromNode(openBracket, FishSemanticTokens.types.function, calculateModifiersMask('defaultLibrary')),
        );
      }
    }

    // Find the closing ] in the last argument
    const lastChild = n.lastNamedChild;
    if (lastChild && lastChild.type === 'word') {
      const closeBracket = lastChild.firstChild;
      if (closeBracket && closeBracket.type === ']') {
        ctx.tokens.push(
          SemanticToken.fromNode(closeBracket, FishSemanticTokens.types.function, calculateModifiersMask('defaultLibrary')),
        );
      }
    }
  }],

  // Structural keywords: `if`, `for`, `function`, `alias`, etc.
  [isStructuralKeyword, (n, ctx) => {
    const targetNode = StructuralKeywords.targetNode(n);
    if (!targetNode) return;
    ctx.tokens.push(
      SemanticToken.fromNode(targetNode, FishSemanticTokens.types.keyword, 0),
    );
  }],

  // Builtin functions: `echo`, `set`, `path`, `source`, etc.
  // These are commands from `builtin -n` but not structural keywords
  //
  // As of PR #133, builtin functions are now treated exactly the same
  // as defaultLibrary functions which include shared function definitions
  // like: `__fish_use_subcommand` or other `$__fish_data_dir/functions/*.fish` files
  [isBuiltinFunction, (n, ctx) => {
    const cmd = getCommandNameNode(n);
    if (!cmd) return;
    const semanticType = FishSemanticTokens.types.function;
    const modifiers = calculateModifiersMask('defaultLibrary');
    ctx.tokens.push(
      SemanticToken.fromNode(cmd, semanticType, modifiers),
    );
    // Highlight valid subcommands with the same type/modifiers as the parent.
    // Reading via the `argument` field is robust against `override_variable`
    // prefixes which would otherwise shift `child(1)` off-by-N.
    const subCmd = n.childrenForFieldName('argument')[0];
    if (subCmd && subCmd.isNamed && !subCmd.text.startsWith('-')) {
      if (subcommandCache.hasSubcommand(cmd.text, subCmd.text)) {
        if (config.fish_lsp_show_subcommand_semantic_tokens) {
          ctx.tokens.push(
            SemanticToken.fromNode(subCmd, semanticType, modifiers),
          );
        }
      } else {
        subcommandCache.requestPopulate(cmd.text);
      }
    }
  }],

  // `true`/`false` used as literal argument values rather than command names.
  // `set fish_lsp_single_workspace_support 'true'`
  //                                         ^^^^ - highlight this as a boolean literal
  [isBooleanLiteral, (n, ctx) => {
    const semanticType = FishSemanticTokens.types.function; // Highlight boolean literals as keywords
    const modifiers = calculateModifiersMask('defaultLibrary');

    if (n.text === ':') {
      ctx.tokens.push(SemanticToken.fromNode(n, semanticType, modifiers));
      return;
    }

    const text = getTextMatchPositions(n, /\b(?:true|false)\b/);
    ctx.tokens.push(...createTokensFromMatches(text, semanticType, modifiers));
  }],

  // User-defined or fish-shipped function calls
  [isUserFunction, (n, ctx) => {
    const cmd = getCommandNameNode(n);
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
      const globalFunc = analyzer.symbols.functionsByName.find(cmd.text)
        .find(symbol => symbol.isGlobal() || symbol.isRootLevel());
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
    // Highlight valid subcommands with the same type/modifiers as the parent.
    // Reading via the `argument` field is robust against `override_variable`
    // prefixes which would otherwise shift `child(1)` off-by-N.
    const subCmd = n.childrenForFieldName('argument')[0];
    if (subCmd && subCmd.isNamed && !subCmd.text.startsWith('-')) {
      if (subcommandCache.hasSubcommand(cmd.text, subCmd.text)) {
        if (config.fish_lsp_show_subcommand_semantic_tokens) {
          ctx.tokens.push(
            SemanticToken.fromNode(subCmd, FishSemanticTokens.types.function, modifiers),
          );
        }
      } else {
        subcommandCache.requestPopulate(cmd.text);
      }
    }
  }],

  // set query/erase/show variable targets (e.g. `set -q/-e/-S PATH`) are variable
  // references, but they are not represented as FishSymbol definitions.
  [isSetQueryEraseOrShowTargetNode, (n, ctx) => {
    const variableName = extractVariableNameFromNode(n);
    if (!variableName) return;
    ctx.tokens.push(
      ...createTokensFromMatches(
        getTextMatchPositions(n, variableName),
        FishSemanticTokens.types.variable,
        0,
      ),
    );
  }],

  // variable expansions
  [isVariableExpansion, (n, ctx) => {
    const variableName = extractVariableNameFromNode(n);
    if (!variableName) return;

    const modifiers = getVariableModifiers(variableName, ctx.document.uri);
    const token = variableExpansionNodeToSemanticToken(n, modifiers);
    if (token) {
      ctx.tokens.push(token);
    }
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
const hasSetQueryEraseOrShowOption = (n: SyntaxNode): boolean => {
  return n.children.some(child => isMatchingOption(
    child,
    Option.create('-q', '--query'),
    Option.create('-e', '--erase'),
    Option.create('-S', '--show'),
  ));
};
