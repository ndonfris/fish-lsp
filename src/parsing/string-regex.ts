import { SyntaxNode } from 'web-tree-sitter';
import { Position, Range } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { findParentWithFallback, isCommandWithName, isEndStdinCharacter, isOption, isScope } from '../utils/node-types';
import { getRange } from '../utils/tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { Option, isMatchingOption } from './options';
import { FishString } from './string';

/**
 * One named capture group parsed from a regex pattern.
 *   - `name`   — capture name (also the fish variable name set on match).
 *   - `offset` — character offset of the *capture name* inside the pattern text
 *                (i.e. the index of the first letter of `name`, not the `(?<`).
 *   - `length` — length of the capture name. `offset + length` is the end.
 */
export interface NamedCapture {
  name: string;
  offset: number;
  length: number;
}

const REGEX_OPTION = Option.create('-r', '--regex');
const STRING_REGEX_SUBCOMMANDS = new Set(['match', 'replace', 'split']);

/**
 * Walk the command's children in source order and return the first node that
 * matches `-r`/`--regex` (including combined short forms like `-re`, `-rq`,
 * `-ra`, `-rqa`). Stops at the `--` sentinel — anything after `--` is a
 * literal argument, not a flag.
 *
 * @param node the `command` node whose name is `string`
 * @returns the matching flag node, or `null` if none is present
 */
export function findStringRegexFlag(node: SyntaxNode): SyntaxNode | null {
  for (const child of node.children) {
    if (isEndStdinCharacter(child)) return null;
    if (isMatchingOption(child, REGEX_OPTION)) return child;
  }
  return null;
}

/**
 * True when `node` is a top-level `string` command whose subcommand
 * (`match`, `replace`, or `split`) accepts `-r`/`--regex` AND the regex flag
 * is present before any `--` sentinel.
 */
export function isStringRegexCommand(node: SyntaxNode): boolean {
  if (!isCommandWithName(node, 'string')) return false;

  // First non-option argument after `string` is the subcommand.
  const args = node.childrenForFieldName('argument');
  const subcommand = args.find(a => !isOption(a));
  if (!subcommand || !STRING_REGEX_SUBCOMMANDS.has(subcommand.text)) return false;

  return findStringRegexFlag(node) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2+ stubs — implemented just enough to compile. The TDD test file
// drives the real implementation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 2: extract every `(?<name>…)` named capture from a regex pattern.
 *
 * Constraints:
 *   - `name` must match fish's variable-name rules: `[A-Za-z_][A-Za-z0-9_]*`.
 *     Captures with PCRE-legal but fish-illegal names (digit-leading, hyphen)
 *     are skipped.
 *   - Lookbehinds `(?<=…)` / `(?<!…)`, non-capturing `(?:…)`, lookaheads,
 *     and inline-flag groups `(?i)` are skipped automatically by the name
 *     requirement.
 *   - An escaped open-paren `\(?<x>` is skipped via the negative lookbehind.
 *
 * Returned `offset`/`length` pinpoint the *capture name* inside the pattern
 * text, so `pattern.slice(offset, offset + length) === name`. Phase 3 maps
 * `offset` back to a source-aligned LSP position by accounting for the
 * surrounding quote character.
 */
const NAMED_CAPTURE_RE = /(?<!\\)\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;

export function parseNamedCaptureGroups(pattern: string): NamedCapture[] {
  if (!pattern) return [];
  const captures: NamedCapture[] = [];
  for (const match of pattern.matchAll(NAMED_CAPTURE_RE)) {
    const name = match[1]!;
    // `match.index` points at `(`; the name begins 3 chars later (after `(?<`).
    captures.push({
      name,
      offset: match.index! + 3,
      length: name.length,
    });
  }
  return captures;
}

/**
 * Locate the regex *pattern argument* — the first non-option, non-sentinel
 * argument appearing after the regex flag.
 *
 * **`--` semantics — read this before "fixing" the skip-on-sentinel branch.**
 * The `--` token has two semantically distinct positions in a `string -r` call,
 * and the responsibility for each lives in a *different* function:
 *
 *   1. `--` BEFORE the regex flag → option parsing stops there, so the `-r`/
 *      `--regex` token is a literal argument, not a flag. No capture detection
 *      should fire. **`findStringRegexFlag` enforces this** by stopping its
 *      scan at the first `--` it sees.
 *
 *   2. `--` BETWEEN the regex flag and the pattern → option parsing stops for
 *      what follows, but the pattern is a *positional* argument either way.
 *      Detection MUST still fire. **`findPatternArg` (this function) must
 *      therefore *skip* `--` and keep looking**, not return null.
 *
 * The instinct to write `if (text === '--') return null` here is the previous
 * bug: it conflates the two positions and causes captures to silently vanish
 * for invocations like `string match --regex --all -- '(?<x>.)' $argv`.
 *
 * Concrete cases this function handles correctly:
 *   - `string match -r '(?<x>.)' input`                                    pattern immediately after flag
 *   - `string match -r '(?<x>.)' -- input`                                 `--` AFTER the pattern (irrelevant here)
 *   - `string match -r --all -- '(?<x>.)' input`                           `--` BETWEEN flags and pattern
 *   - `string match --regex --all --entire -- '(?<x>.)' $argv[1]`          all-long, sentinel between
 *   - `string replace -r --all -- '(?<x>.)' $argv`                         mixed short/long, sentinel between
 */
function findPatternArg(commandNode: SyntaxNode, flagNode: SyntaxNode): SyntaxNode | null {
  let pastFlag = false;
  for (const child of commandNode.children) {
    if (!pastFlag) {
      if (child.equals(flagNode)) pastFlag = true;
      continue;
    }
    if (isOption(child)) continue;
    // See the JSDoc above — `--` between the regex flag and the pattern is
    // a no-op for our purposes; the pre-flag `--` case is handled upstream
    // by findStringRegexFlag.
    if (isEndStdinCharacter(child)) continue;
    return child;
  }
  return null;
}

/**
 * Number of source characters preceding the pattern *contents* inside the
 * argument node. For a quoted string that's the opening quote (1 char); for
 * an unquoted/concatenation node it's 0.
 */
function quotePrefixLength(patternArg: SyntaxNode): number {
  return patternArg.type === 'single_quote_string' || patternArg.type === 'double_quote_string'
    ? 1
    : 0;
}

/**
 * Map a character offset *inside the unwrapped pattern text* back to an LSP
 * `Range` aligned to the original source. Single-line patterns only — when
 * Phase 3 grows multi-line support we'll walk newlines here.
 */
function rangeForCapture(patternArg: SyntaxNode, capture: NamedCapture): Range {
  const start = {
    line: patternArg.startPosition.row,
    character: patternArg.startPosition.column + quotePrefixLength(patternArg) + capture.offset,
  };
  return {
    start,
    end: { line: start.line, character: start.character + capture.length },
  };
}

/**
 * Phase 4: emit one `FishSymbol` per named capture in the command.
 *
 * Symbol shape per capture:
 *   - `name`           — capture name (the fish variable name).
 *   - `focusedNode`    — the regex pattern argument string node.
 *   - `selectionRange` — sub-range pointing at just the capture name inside
 *                        the pattern, NOT the whole string node. (`EXPORT`
 *                        uses the same selection-range-inside-a-node trick.)
 *   - `node`           — the parent `command` node, so scope/lifetime helpers
 *                        anchored on `node` behave correctly.
 *   - `fishKind`       — `'STRING_REGEX'`.
 *   - `scope`          — fish "default scope": local to the enclosing block.
 *                        Matches `set` without flags. Real scope-fallback
 *                        precision lands later when a Phase 6/8 test demands it.
 */
export function processStringRegexCommand(
  document: LspDocument,
  node: SyntaxNode,
  children: FishSymbol[] = [],
): FishSymbol[] {
  if (!isStringRegexCommand(node)) return [];
  const flag = findStringRegexFlag(node);
  if (!flag) return [];

  const patternArg = findPatternArg(node, flag);
  if (!patternArg) return [];

  const patternText = FishString.fromNode(patternArg);
  const captures = parseNamedCaptureGroups(patternText);
  if (captures.length === 0) return [];

  const scopeNode = findParentWithFallback(node, (n) => isScope(n));
  const scope = DefinitionScope.create(scopeNode, 'local');

  return captures.map((capture) => FishSymbol.fromObject({
    name: capture.name,
    fishKind: 'STRING_REGEX',
    document,
    uri: document.uri,
    node,
    focusedNode: patternArg,
    range: getRange(node),
    selectionRange: rangeForCapture(patternArg, capture),
    scope,
    detail: node.text,
    children,
  }));
}

/**
 * Phase 5: predicate used by `isVariableDefinitionName` to decide whether a
 * given syntax node is the "definition site" of one or more string-regex
 * captures.
 *
 * The definition site is the pattern *argument* node — not the capture-name
 * substring itself, which tree-sitter never breaks out as its own node. A
 * cursor falling on the name is mapped back to the symbol via the symbol's
 * `selectionRange` (set in Phase 3/4).
 */
export function isStringRegexCaptureDefinitionName(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent || !isStringRegexCommand(parent)) return false;
  const flag = findStringRegexFlag(parent);
  if (!flag) return false;
  const patternArg = findPatternArg(parent, flag);
  if (!patternArg || !patternArg.equals(node)) return false;
  return parseNamedCaptureGroups(FishString.fromNode(node)).length > 0;
}

/**
 * Phase 7: cursor → capture-name resolution.
 *
 * Given the pattern-argument node and a cursor position, return the
 * `NamedCapture` whose name range contains the cursor. Used by
 * `analyzer.wordAtPoint` to bridge the gap between tree-sitter (which keeps
 * the regex pattern as a single opaque string node) and the LSP, which needs
 * a "word" string to look the symbol up by name.
 *
 * Single-line patterns only for now — multi-line double-quoted patterns
 * need an escape-aware offset map, deferred until a test demands it.
 */
export function findCaptureAtPosition(
  patternArg: SyntaxNode,
  position: Position,
): NamedCapture | null {
  if (position.line !== patternArg.startPosition.row) return null;
  const offsetInPattern =
    position.character - patternArg.startPosition.column - quotePrefixLength(patternArg);
  if (offsetInPattern < 0) return null;

  const captures = parseNamedCaptureGroups(FishString.fromNode(patternArg));
  for (const cap of captures) {
    // Inclusive on both ends so a cursor parked right after the last char
    // (a common LSP behavior) still resolves.
    if (offsetInPattern >= cap.offset && offsetInPattern <= cap.offset + cap.length) {
      return cap;
    }
  }
  return null;
}

/**
 * Convenience: if `node` is a `string -r` pattern argument and `position`
 * lands inside one of its captures, return the capture name. Otherwise null.
 *
 * This is the single entry point `analyzer.wordAtPoint` calls.
 */
export function captureNameAtPosition(
  node: SyntaxNode,
  position: Position,
): string | null {
  if (!isStringRegexCaptureDefinitionName(node)) return null;
  return findCaptureAtPosition(node, position)?.name ?? null;
}
