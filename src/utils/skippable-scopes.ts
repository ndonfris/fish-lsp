import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from '../parsing/symbol';
import { LspDocument } from '../document';

/**
 * Tag indicating whether nodes within a span should be included or excluded
 * from reference searches.
 */
export type ScopeSpanTag = 'include' | 'exclude';

/**
 * A contiguous range of the document (by tree-sitter byte offsets) tagged
 * as either 'include' or 'exclude' for reference searching.
 *
 * When a local variable shadows a global of the same name, the local's
 * scope becomes an 'exclude' span. Self-referencing expansions within
 * excluded spans punch small 'include' holes back in.
 */
export interface ScopeSpan {
  startIndex: number;
  endIndex: number;
  tag: ScopeSpanTag;
  /** The symbol whose scope defines this span (if any) */
  symbol?: FishSymbol;
}

/**
 * A grouped scope entry: a scope-level symbol and the focused children
 * (same-name definitions) that live inside it.
 */
interface ScopeGroup {
  scopeSymbol: FishSymbol;
  focusedChildren: FishSymbol[];
}

/**
 * Computes scope spans for a variable `name` within a single document.
 *
 * The document is partitioned into contiguous `ScopeSpan` segments:
 *  - `'include'` spans where nodes matching `name` are valid references
 *  - `'exclude'` spans where a local definition shadows the outer definition
 *
 * Self-referencing expansions (e.g. `$PATH` in `set -lx PATH $PATH:/opt/bin`)
 * create small `'include'` holes inside otherwise-excluded regions, because
 * the RHS `$PATH` reads the pre-existing (global) value before the local is created.
 *
 * @param doc The document to analyze
 * @param name The variable name to compute spans for
 * @param allSymbols Optional pre-fetched flat symbol list for the document
 * @returns Sorted, non-overlapping array of ScopeSpans covering the document
 */
export function buildScopeSpans(
  doc: LspDocument,
  name: string,
  rootNode: SyntaxNode,
  allSymbols: FishSymbol[],
): ScopeSpan[] {
  const symbols = allSymbols.filter(s => s.isVariable() && s.name === name);

  if (symbols.length === 0) {
    return [{ startIndex: rootNode.startIndex, endIndex: rootNode.endIndex, tag: 'include' }];
  }

  const localSymbols = symbols.filter(s => s.isLocal());
  const globalSymbols = symbols.filter(s => s.isGlobal());

  // Group overlapping scopes: find local symbols whose parent scope overlaps
  // with a global symbol's parent scope
  const scopeGroups: ScopeGroup[] = [];

  for (const gs of globalSymbols) {
    const overlapping = localSymbols.filter(ls =>
      ls.parent && gs.parent && ls.parent.equals(gs.parent),
    );
    if (overlapping.length > 0) {
      scopeGroups.push({ scopeSymbol: gs, focusedChildren: overlapping });
    }
  }

  // Also handle local-only shadowing: when multiple locals shadow each other
  // at different scope levels (e.g., a local inside a function shadows one at program level)
  // For now, collect local symbols that don't overlap with any global but shadow
  // within their parent's scope
  for (const ls of localSymbols) {
    // Skip if already in a scope group
    if (scopeGroups.some(g => g.focusedChildren.includes(ls))) continue;

    // A local that has no overlapping global — it creates its own exclude zone
    // within its scope for any outer definition of the same name
    const parentNode = ls.parent?.node ?? ls.scopeNode;
    if (parentNode.type === 'program') continue; // don't exclude the entire file

    // Check if there's another symbol of the same name at a broader scope
    const hasBroaderDef = symbols.some(other =>
      !other.equals(ls)
      && other.scopeNode.startIndex <= parentNode.startIndex
      && other.scopeNode.endIndex >= parentNode.endIndex,
    );
    if (hasBroaderDef) {
      scopeGroups.push({ scopeSymbol: ls, focusedChildren: [ls] });
    }
  }

  if (scopeGroups.length === 0) {
    return [{ startIndex: rootNode.startIndex, endIndex: rootNode.endIndex, tag: 'include' }];
  }

  // Start with the full document as 'include'
  let spans: ScopeSpan[] = [
    { startIndex: rootNode.startIndex, endIndex: rootNode.endIndex, tag: 'include' },
  ];

  // For each scope group, carve out 'exclude' regions
  for (const group of scopeGroups) {
    for (const child of group.focusedChildren) {
      const scopeNode = child.scopeNode;
      // The exclude region is the child's scope
      const excludeStart = scopeNode.startIndex;
      const excludeEnd = scopeNode.endIndex;

      spans = splitSpan(spans, excludeStart, excludeEnd, 'exclude', child);
    }
  }

  // Now handle self-referencing expansions: punch 'include' holes
  // Only for local SET symbols that actually contain a self-referencing
  // expansion (e.g. `set -lx PATH $PATH:/opt/bin` where $PATH reads the global)
  for (const group of scopeGroups) {
    for (const child of group.focusedChildren) {
      if (child.fishKind !== 'SET' || !child.isLocal()) continue;
      // Check if the command actually has a self-referencing expansion
      const cmdNode = child.node;
      if (!child.isSelfReferencingVariable()) continue;
      // Mark the command node range as 'include' so the $VAR expansion is found
      spans = splitSpan(spans, cmdNode.startIndex, cmdNode.endIndex, 'include', child);
    }
  }

  return spans.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Splits existing spans by inserting a new region with the given tag.
 * If a span overlaps the [start, end) region, it gets split into up to 3 parts:
 *   before (keeps original tag) | middle (new tag) | after (keeps original tag)
 */
function splitSpan(
  spans: ScopeSpan[],
  start: number,
  end: number,
  tag: ScopeSpanTag,
  symbol?: FishSymbol,
): ScopeSpan[] {
  const result: ScopeSpan[] = [];

  for (const span of spans) {
    // No overlap: span is entirely before or after the new region
    if (span.endIndex <= start || span.startIndex >= end) {
      result.push(span);
      continue;
    }

    // Span overlaps with the new region — split it
    // Before portion (keeps original tag)
    if (span.startIndex < start) {
      result.push({ startIndex: span.startIndex, endIndex: start, tag: span.tag, symbol: span.symbol });
    }

    // Middle portion (new tag)
    const overlapStart = Math.max(span.startIndex, start);
    const overlapEnd = Math.min(span.endIndex, end);
    result.push({ startIndex: overlapStart, endIndex: overlapEnd, tag, symbol });

    // After portion (keeps original tag)
    if (span.endIndex > end) {
      result.push({ startIndex: end, endIndex: span.endIndex, tag: span.tag, symbol: span.symbol });
    }
  }

  return result;
}

/**
 * Checks if a SyntaxNode falls within an 'exclude' span.
 * Returns true if the node should be skipped during reference search.
 */
export function isNodeExcluded(node: SyntaxNode, spans: ScopeSpan[]): boolean {
  const idx = node.startIndex;
  for (const span of spans) {
    if (idx >= span.startIndex && idx < span.endIndex) {
      return span.tag === 'exclude';
    }
  }
  return false;
}

/**
 * Checks if a SyntaxNode falls within an 'include' span.
 */
export function isNodeIncluded(node: SyntaxNode, spans: ScopeSpan[]): boolean {
  return !isNodeExcluded(node, spans);
}

/**
 * Returns the ScopeSpan that contains the given node, or undefined.
 */
export function getSpanForNode(node: SyntaxNode, spans: ScopeSpan[]): ScopeSpan | undefined {
  const idx = node.startIndex;
  return spans.find(span => idx >= span.startIndex && idx < span.endIndex);
}
