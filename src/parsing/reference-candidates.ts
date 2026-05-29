import { DocumentUri, Range, Location } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { FishString } from './string';
import * as Locations from '../utils/locations';
import { isGenericFunctionEventHandlerDefinitionName } from './emit';
import { isArgparseVariableDefinitionName } from './argparse';
import { isMatchingOption, isMatchingOptionOrOptionValue, Option, getLeadingDashCount } from './options';
import {
  findParentCommand,
  isCommandName,
  isCommandWithName,
  isDefinition,
  isEmittedEventDefinitionName,
  isOption,
  isProgram,
  isString,
  isVariable,
  isVariableDefinitionName,
  isVariableExpansion,
} from '../utils/node-types';
import { getRange } from '../utils/tree-sitter';
import { isAliasDefinitionValue } from './alias';
import { extractCommandLocations, extractMatchingCommandLocations } from './nested-strings';

export const REFERENCE_CANDIDATE_NODE_TYPES = [
  'word',
  'string',
  'single_quote_string',
  'double_quote_string',
  'concatenation',
  'option',
  'variable_expansion',
  'variable_name',
] as const;

export function isCompleteDefinitionNode(node: SyntaxNode): boolean {
  if (isOption(node) || !node.parent || !isCommandWithName(node.parent, 'complete')) {
    return false;
  }
  const prev = node.previousNamedSibling;
  if (!prev) return false;
  return isMatchingOption(
    prev,
    Option.create('-c', '--command'),
    Option.create('-s', '--short-option'),
    Option.create('-l', '--long-option'),
    Option.create('-o', '--old-option'),
    Option.create('-w', '--wraps'),
  );
}

export function isSetReferenceTargetNode(node: SyntaxNode): boolean {
  const parentCommand = findParentCommand(node);
  if (!parentCommand || !isCommandWithName(parentCommand, 'set')) return false;
  const isRefSetCommand = parentCommand.children.some(child => isMatchingOption(
    child,
    Option.create('-q', '--query'),
    Option.create('-e', '--erase'),
    Option.create('-S', '--show'),
  ));
  if (!isRefSetCommand) return false;

  const args = parentCommand.childrenForFieldName('argument').filter(arg => !isOption(arg));
  for (const arg of args) {
    if (arg.equals(node)) return true;
    if (arg.type === 'concatenation' && arg.firstNamedChild?.equals(node)) return true;
  }
  return false;
}

function isArgparseVariableReferenceNode(symbol: FishSymbol, node: SyntaxNode): boolean {
  if (node.type === 'variable_name' && node.text === symbol.name) {
    return true;
  }
  if (isVariableExpansion(node) && node.text === `$${symbol.name}`) {
    return true;
  }
  if (isVariableDefinitionName(node) && node.text === symbol.name) {
    return true;
  }
  if (isSetReferenceTargetNode(node) && node.text === symbol.name) {
    return true;
  }
  return false;
}

function isArgparseOptionReferenceNode(symbol: FishSymbol, node: SyntaxNode): boolean {
  if (!isOption(node)) return false;
  const parentCommand = findParentCommand(node);
  const parentName = symbol.parent?.name
    || symbol.scopeNode.firstNamedChild?.text
    || symbol.scopeNode.text;
  if (!parentCommand || !parentName || !isCommandWithName(parentCommand, parentName)) {
    return false;
  }
  return isMatchingOptionOrOptionValue(node, Option.fromRaw(symbol.argparseFlag));
}

function isArgparseCompleteFlagReferenceNode(symbol: FishSymbol, node: SyntaxNode): boolean {
  const parentName = symbol.parent?.name
    || symbol.scopeNode.firstNamedChild?.text
    || symbol.scopeNode.text;
  if (!parentName) return false;
  return isCompletionArgparseFlagWithCommandName(node, parentName, symbol.argparseFlagName);
}

export function isPotentialReferenceNode(symbol: FishSymbol, node: SyntaxNode): boolean {
  if (!node || !node.isNamed) return false;

  if (symbol.isArgparse()) {
    return isArgparseVariableReferenceNode(symbol, node)
      || isArgparseOptionReferenceNode(symbol, node)
      || isArgparseCompleteFlagReferenceNode(symbol, node)
      || isArgparseVariableDefinitionName(node);
  }

  if (symbol.isEventHook()) {
    return isEmittedEventDefinitionName(node) && node.text === symbol.name;
  }

  if (symbol.isEmittedEvent()) {
    return isGenericFunctionEventHandlerDefinitionName(node) && node.text === symbol.name;
  }

  if (symbol.isVariable()) {
    return isVariable(node)
      || isSetReferenceTargetNode(node)
      || isCompleteDefinitionNode(node);
  }

  if (symbol.isFunction()) {
    if (isDefinition(node)) return false;
    if (node.text === symbol.name) return true;
    if (isCommandName(node)) return true;
    if (isString(node)) return true;
    if (isOption(node)) return true;
    if (isCompleteDefinitionNode(node)) return true;
    // Bare `name=value` words (e.g. `alias foo=ref_cmd`) — a single `word`
    // node that nonetheless contains a command-name reference after `=`.
    if (node.type === 'word' && node.text.includes('=') && !node.text.startsWith('-')) {
      return FishString.extractCommands(node).includes(symbol.name);
    }
    return false;
  }

  return node.text === symbol.name || isString(node);
}

export function extractReferenceCandidateNames(node: SyntaxNode): string[] {
  if (!node || !node.isNamed || !node.text?.trim()) return [];

  if (isString(node) || node.type === 'concatenation') {
    const names = new Set<string>(FishString.extractCommands(node));
    if (node.text.startsWith('-')) {
      const equalsIndex = node.text.indexOf('=');
      if (equalsIndex > 0) {
        names.add(node.text.slice(0, equalsIndex));
      }
    }
    return [...names];
  }

  if (isOption(node)) {
    const names = new Set<string>([node.text, ...FishString.extractCommands(node)]);
    const equalsIndex = node.text.indexOf('=');
    if (equalsIndex > 0) {
      names.add(node.text.slice(0, equalsIndex));
    }
    return [...names];
  }

  if (isVariable(node)) {
    if (node.type === 'variable_expansion') {
      return node.text.startsWith('$') ? [node.text.slice(1)] : [];
    }
    return [node.text];
  }

  if (
    node.type === 'word'
    || node.type === 'string'
    || node.type === 'concatenation'
    || node.type === 'option'
    || isCommandName(node)
    || isArgparseVariableDefinitionName(node)
    || isCompleteDefinitionNode(node)
    || isEmittedEventDefinitionName(node)
    || isGenericFunctionEventHandlerDefinitionName(node)
  ) {
    const names = new Set<string>([node.text]);
    // Tree-sitter parses `alias foo=ref_cmd` as a single bare-word
    // `foo=ref_cmd` (no concatenation, no children). Without this we'd
    // only index it under `foo=ref_cmd`, so a lookup for `ref_cmd`
    // would miss the alias usage. The `!startsWith('-')` guard leaves
    // options like `--foo=bar` to the `isOption` branch above.
    if (node.text.includes('=') && !node.text.startsWith('-')) {
      FishString.extractCommands(node).forEach(cmd => names.add(cmd));
    }
    return [...names];
  }

  return [];
}

export function isReferenceCandidateNode(node: SyntaxNode): boolean {
  if (!node || !node.isNamed) return false;

  if (isString(node) || node.type === 'concatenation') {
    return FishString.extractCommands(node).length > 0;
  }
  if (isOption(node)) return true;

  if (node.type === 'word') return true;
  if (isVariable(node)) return true;
  if (isSetReferenceTargetNode(node)) return true;
  if (isArgparseVariableDefinitionName(node)) return true;
  if (isCompleteDefinitionNode(node)) return true;
  if (isEmittedEventDefinitionName(node)) return true;
  if (isGenericFunctionEventHandlerDefinitionName(node)) return true;
  if (isCommandName(node) && !isDefinition(node)) return true;

  return false;
}

/**
 * Single-pass equivalent of
 * `isReferenceCandidateNode(node) ? extractReferenceCandidateNames(node) : []`.
 *
 * For string/concatenation nodes the previous two-call form parsed embedded
 * commands twice (`FishString.extractCommands` ran in the gate *and* in the
 * extractor); this computes them once. Non-string nodes reuse the existing
 * gate + extractor, which don't double-parse. Returns `[]` for non-candidates.
 */
export function referenceCandidateNamesFor(node: SyntaxNode): string[] {
  if (!node || !node.isNamed || !node.text?.trim()) return [];

  if (isString(node) || node.type === 'concatenation') {
    const cmds = FishString.extractCommands(node);
    if (cmds.length === 0) return []; // gate: not a reference candidate
    const names = new Set<string>(cmds);
    if (node.text.startsWith('-')) {
      const equalsIndex = node.text.indexOf('=');
      if (equalsIndex > 0) names.add(node.text.slice(0, equalsIndex));
    }
    return [...names];
  }

  if (!isReferenceCandidateNode(node)) return [];
  return extractReferenceCandidateNames(node);
}

function isCompletionArgparseFlagWithCommandName(node: SyntaxNode, commandName: string, flagName: string): boolean {
  const parent = node.parent;
  if (!parent || !isCommandWithName(parent, 'complete')) return false;

  const hasCommand = parent.children.some(c =>
    c.previousSibling
    && isMatchingOption(c.previousSibling, Option.create('-c', '--command'))
    && c.text === commandName,
  );
  if (!hasCommand) return false;

  return !!node.previousSibling
    && Option.fromRaw(flagName).equals(node.previousSibling);
}

function rangeFromNode(node: SyntaxNode): Range {
  if (node.text.startsWith('-')) {
    const leadingDashCount = getLeadingDashCount(node.text);
    return {
      start: {
        line: node.startPosition.row,
        character: node.startPosition.column + leadingDashCount,
      },
      end: {
        line: node.endPosition.row,
        character: node.endPosition.column + 1,
      },
    };
  }
  return getRange(node);
}

// Resolves a node to one or more Location ranges, narrowing the range when tree-sitter
// tokenizes multiple references together (e.g. `argparse h/help` returns 'h' or 'help'
// individually, and `alias`/`bind`/`complete -n` extract the command within the string).
export function getLocationWrapper(symbol: FishSymbol, node: SyntaxNode, uri: DocumentUri): Location[] {
  if (symbol.fishKind === 'ARGPARSE' && isOption(node)) {
    // For `--flag="value"`, tree-sitter wraps the flag + string in a
    // `concatenation` whose first child is the `--flag=` word. The
    // concatenation's text starts with `--`, so `isOption` matches it — but
    // its range covers the entire `--flag="value"`. Descend to the inner
    // option-shaped child so the location reports just the flag itself.
    let optionNode: SyntaxNode = node;
    if (node.type === 'concatenation') {
      const inner = node.namedChildren.find(c => c.text.startsWith('-'));
      if (inner) optionNode = inner;
    }
    const range = getRange(optionNode);
    const text = optionNode.text;
    const eqIdx = text.indexOf('=');
    range.start.character += getLeadingDashCount(text);
    if (eqIdx > 0) {
      // `--name=` (or `--name=value` single-word) — clip the range at the
      // `=` so it only covers the flag name, not the attached value.
      range.end = {
        line: range.start.line,
        character: optionNode.startPosition.column + eqIdx,
      };
    }
    // For `--name` (no `=`), the node range already ends at the last char
    // of the flag name — `getRange` returns half-open [start, end), so the
    // range covers exactly `name`. (The old `+= 1` was an off-by-one that
    // ate the trailing space during rename of the space-form usage.)
    return [Locations.Location.create(uri, range)];
  }
  if (isAliasDefinitionValue(node) || isBindCall(symbol, node) || isCompleteConditionCall(symbol, node)) {
    return extractMatchingCommandLocations(symbol, node, uri);
  }
  if (symbol.isFunction() && (isString(node) || isOption(node))) {
    return extractCommandLocations(node, uri)
      .filter(loc => loc.command === symbol.name)
      .map(loc => loc.location);
  }
  return [Locations.Location.create(uri, getRange(node))];
}

function isBindCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
  if (!node?.parent || isOption(node)) return false;
  const parent = findParentCommand(node);
  if (!parent || !isCommandWithName(parent, 'bind')) return false;
  const subcommands = parent.children.slice(2).filter(c => !isOption(c));
  if (!subcommands.some(c => c.equals(node))) return false;
  return FishString.extractCommands(node).some(cmd => cmd === definitionSymbol.name);
}

function isCompleteConditionCall(definitionSymbol: FishSymbol, node: SyntaxNode): boolean {
  if (isOption(node) || !node.isNamed || isProgram(node)) return false;
  if (!node.parent || !isCommandWithName(node.parent, 'complete')) return false;
  if (!node.previousSibling || !isMatchingOption(node.previousSibling, Option.fromRaw('-n', '--condition'))) return false;
  return FishString.extractCommands(node).some(cmd => cmd.trim() === definitionSymbol.name);
}

export class FishReferenceCandidate {
  constructor(
    public readonly document: LspDocument,
    public readonly node: SyntaxNode,
    public readonly name: string,
    public readonly range: Range = rangeFromNode(node),
  ) {}

  // Computed lazily. During bulk indexing almost no candidate is ever asked for
  // its raw `location` (consumers use `toLocationsFor`/`toLocation`), so the old
  // eager constructor default allocated a Location AND computed `rangeFromNode`
  // a second time for every indexed candidate — pure waste on the hot path.
  get location(): Location {
    return Locations.Location.create(this.uri, this.range);
  }

  static fromSymbol(symbol: FishSymbol) {
    return new FishReferenceCandidate(symbol.document, symbol.focusedNode, symbol.name, symbol.selectionRange);
  }

  get uri(): DocumentUri {
    return this.document.uri;
  }

  get id(): string {
    return [
      this.uri,
      this.range.start.line.toString(),
      this.range.start.character.toString(),
      this.range.end.line.toString(),
      this.range.end.character.toString(),
      this.node.type,
      this.name,
    ].join(':');
  }

  get text(): string {
    return this.name;
  }

  toLocation() {
    return Locations.Location.create(this.uri, this.range);
  }

  // Returns the precise locations this candidate represents *for the given
  // definition symbol* — handles argparse dash-stripping, and pulls inner
  // command positions out of alias/bind/complete-condition string bodies.
  toLocationsFor(symbol: FishSymbol): Location[] {
    return getLocationWrapper(symbol, this.node, this.uri);
  }

  /**
   * Walks up to the nearest enclosing `command` node — possibly several ancestors
   * away (e.g. a node nested inside a string that is itself a `complete -n`
   * condition has the command as its grandparent). Returns the command's first
   * named child text, or null if the candidate doesn't sit inside any command.
   */
  get parentCommandName(): string | null {
    const cmd = findParentCommand(this.node);
    return cmd?.firstNamedChild?.text ?? null;
  }

  /**
   * Classifies this candidate as one of the three implementation kinds used by
   * the cycle logic in `analyzer.getImplementation`:
   *
   *   - 'definition' — node is the selection range of any symbol in `allDefs`.
   *     Passing the full set of same-named global defs (not just the one the
   *     cursor resolves to) is what lets a global function defined in multiple
   *     places report all its defs as part of the same cycle step.
   *   - 'completion' — node's ancestor is a `complete` command. This is the
   *     `complete -c X -l flag` and friends.
   *   - 'usage'      — anything else (call sites, `--flag` argparse usages, etc.)
   */
  classifyImplementationKind(allDefs: FishSymbol[]): 'definition' | 'completion' | 'usage' {
    for (const def of allDefs) {
      if (this.uri !== def.uri) continue;
      const focused = def.focusedNode;
      if (!focused) continue;
      if (this.node.equals(focused)) return 'definition';
      const r = this.range;
      const fr = def.selectionRange;
      if (
        r.start.line === fr.start.line
        && r.start.character === fr.start.character
        && r.end.line === fr.end.line
        && r.end.character === fr.end.character
      ) {
        return 'definition';
      }
    }
    const cmd = findParentCommand(this.node);
    if (cmd && isCommandWithName(cmd, 'complete')) return 'completion';
    return 'usage';
  }

  classifyLocationType(): {
    type: 'command' | 'complete' | 'option' | 'variable' | 'string' | 'unknown';
    uriType: ReturnType<LspDocument['getAutoloadType']>;
    parentCommandName: string | null;
  } {
    const cmd = findParentCommand(this.node);
    const parentCommandName = cmd?.firstNamedChild?.text ?? null;
    const uriType = this.document.getAutoloadType();
    const parent = cmd || this.node.parent;
    if (!parent) return { type: 'unknown', uriType, parentCommandName };
    if (cmd && isCommandWithName(cmd, 'complete')) return { type: 'complete', uriType, parentCommandName };
    if (isCommandName(this.node) && !isDefinition(this.node)) return { type: 'command', uriType, parentCommandName };
    if (isOption(this.node)) return { type: 'option', uriType, parentCommandName };
    if (isVariable(this.node) || isVariableExpansion(this.node)) return { type: 'variable', uriType, parentCommandName };
    if (isString(this.node) || this.node.type === 'concatenation') return { type: 'string', uriType, parentCommandName };
    return { type: 'unknown', uriType, parentCommandName };
  }

  /**
   * Builds a comparator that orders references found for `defSymbol`. Works on
   * either plain `Location` objects (URI + range only) or `FishReferenceCandidate`
   * instances — candidates carry richer info (parent command name, autoload-type)
   * which the comparator uses to pull "direct" references (command-position,
   * inside `complete`) ahead of indirect ones (mentions inside an `alias`/`bind`
   * body).
   *
   * Order:
   *   1. URI priority — definition's URI ranks highest, then `completions/` (for
   *      argparse/function symbols), then everything else; stable by URI hash.
   *   2. Classification weight (candidates only) — command-call > complete >
   *      variable > option > unknown > string-nested. References whose parent
   *      command name matches the definition's parent function name get a boost.
   *   3. Position (line, then character).
   */
  static comparatorForSymbol(
    defSymbol: FishSymbol,
  ): (a: SortableRef, b: SortableRef) => number {
    const hasCompletionPriority = defSymbol.isArgparse() || defSymbol.isFunction();
    const defParentName = defSymbol.parent?.name ?? null;
    const uriPriorityCache = new Map<DocumentUri, number>();

    // Band ordering: def URI > autoloaded completion for THIS symbol > other
    // completion files > regular workspace files. Within a band, URIs are
    // compared lexically below — stable regardless of the workspace dir name.
    const autoloadCompletionSuffix = `/completions/${defSymbol.name}.fish`;
    const uriPriorityFor = (uri: DocumentUri, uriType: string | null | undefined): number => {
      const cached = uriPriorityCache.get(uri);
      if (cached !== undefined) return cached;
      let priority = 10;
      if (uri === defSymbol.uri) {
        priority = 100;
      } else if (hasCompletionPriority && uri.endsWith(autoloadCompletionSuffix)) {
        // e.g. for symbol `ls`, `…/completions/ls.fish` is THE autoloaded
        // companion file — surface it before unrelated completions that
        // merely mention `ls` (like `ls-wrapper.fish`'s `-w 'ls'`).
        priority = 75;
      } else if (hasCompletionPriority && (uriType === 'completions' || uri.includes('completions/'))) {
        priority = 50;
      }
      uriPriorityCache.set(uri, priority);
      return priority;
    };

    const typeWeight: Record<string, number> = {
      command: 5,
      complete: 4,
      variable: 3,
      option: 2,
      unknown: 0,
      string: -1,
    };

    const candidateInfo = (s: SortableRef) =>
      s instanceof FishReferenceCandidate ? s.classifyLocationType() : null;
    const weightFor = (info: ReturnType<FishReferenceCandidate['classifyLocationType']> | null): number => {
      if (!info) return 0;
      const base = typeWeight[info.type] ?? 0;
      return info.parentCommandName && info.parentCommandName === defParentName ? base + 3 : base;
    };

    return (a, b) => {
      const ainfo = candidateInfo(a);
      const binfo = candidateInfo(b);
      const ap = uriPriorityFor(a.uri, ainfo?.uriType);
      const bp = uriPriorityFor(b.uri, binfo?.uriType);
      if (ap !== bp) return bp - ap;
      // Tiebreak by URI lexically (ascending). This is workspace-prefix
      // independent — when two URIs share the same workspace root, the
      // compare resolves on the suffix — so reference order is stable across
      // test runs that randomize the workspace directory name.
      if (a.uri !== b.uri) return a.uri < b.uri ? -1 : 1;
      const aw = weightFor(ainfo);
      const bw = weightFor(binfo);
      if (aw !== bw) return bw - aw;
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    };
  }
}

type SortableRef = Location | FishReferenceCandidate;

// const sorter = (defSymbol: FishSymbol) => {
//
//   type RefKind = 'definition' | 'same-uri' | 'complete' | 'option' | 'usage';
//
//   function refKind(ref: FishReferenceCandidate): RefKind {
//     const { node, uri } = ref;
//
//     if (node.id === defSymbol.node.id || defSymbol.equalsNode(node)) {
//       return 'definition';
//     }
//
//     if (uri === defSymbol.uri) {
//       return 'same-uri';
//     }
//
//     const parentCommand = findParentCommand(node);
//     if (parentCommand && isCommandWithName(parentCommand, 'complete')) {
//       return 'complete';
//     }
//     if (defSymbol.isArgparse() || defSymbol.isFunction()) {
//       if (uri.endsWith(`/completions/${defSymbol.name}.fish`)) {
//         return 'complete';
//       }
//     }
//
//     if (isOption(node)) {
//       return 'option';
//     }
//
//     return 'usage';
//   }
//
//   const kindWeight: Record<RefKind, number> = {
//     definition: 0,
//     'same-uri': 1,
//     complete: 2,
//     option: 3,
//     usage: 4,
//   };
//
//   return (a: FishReferenceCandidate, b: FishReferenceCandidate): number => {
//     const ak = refKind(a);
//     const bk = refKind(b);
//
//     const kindDiff = kindWeight[ak] - kindWeight[bk];
//     if (kindDiff !== 0) return kindDiff;
//
//     // For usages, group by URI first.
//     if (ak === 'usage' && bk === 'usage') {
//       const uriDiff = a.uri.localeCompare(b.uri);
//       if (uriDiff !== 0) return uriDiff;
//     }
//
//     // For all same-bucket refs, sort by source position.
//     const rowDiff = a.node.startPosition.row - b.node.startPosition.row;
//     if (rowDiff !== 0) return rowDiff;
//
//     return a.node.startPosition.column - b.node.startPosition.column;
//   }
// }

export class FishReferenceCandidateCache {
  private readonly byId = new Map<string, FishReferenceCandidate>();
  private readonly idsByName = new Map<string, Set<string>>();
  private readonly idsByUri = new Map<DocumentUri, Set<string>>();
  private readonly idsByUriAndName = new Map<DocumentUri, Map<string, Set<string>>>();
  private readonly initializedUris = new Set<DocumentUri>();

  hasIndexed(uri: DocumentUri): boolean {
    return this.initializedUris.has(uri);
  }

  find(name: string): FishReferenceCandidate[] {
    const ids = this.idsByName.get(name);
    if (!ids) return [];

    const results: FishReferenceCandidate[] = [];
    for (const id of ids) {
      const candidate = this.byId.get(id);
      if (candidate) {
        results.push(candidate);
      }
    }
    return results;
  }

  findInDocument(uri: DocumentUri, name: string): FishReferenceCandidate[] {
    const nameBuckets = this.idsByUriAndName.get(uri);
    const ids = nameBuckets?.get(name);
    if (!ids) return [];

    const results: FishReferenceCandidate[] = [];
    for (const id of ids) {
      const candidate = this.byId.get(id);
      if (candidate) {
        results.push(candidate);
      }
    }
    return results;
  }

  // Returns the lookup names for a symbol. Argparse symbols are indexed under the
  // `_flag_x` form, the dashed flag-name (`help`), and the dashed flag (`--help`) —
  // any of which may appear as the candidate name in `completions/`, function bodies,
  // or `complete -l` calls. Callers that have a FishSymbol should prefer the
  // *ForSymbol lookups so they don't have to reproduce this aliasing.
  static namesFor(symbol: FishSymbol): Set<string> {
    const names = new Set<string>([symbol.name]);
    if (symbol.isArgparse()) {
      names.add(symbol.argparseFlagName);
      names.add(String(symbol.argparseFlag));
    }
    return names;
  }

  findForSymbol(symbol: FishSymbol): FishReferenceCandidate[] {
    return this.collectForNames(name => this.find(name), symbol);
  }

  findInDocumentForSymbol(uri: DocumentUri, symbol: FishSymbol): FishReferenceCandidate[] {
    return this.collectForNames(name => this.findInDocument(uri, name), symbol);
  }

  private collectForNames(
    lookup: (name: string) => FishReferenceCandidate[],
    symbol: FishSymbol,
  ): FishReferenceCandidate[] {
    const seen = new Set<string>();
    const results: FishReferenceCandidate[] = [];
    for (const name of FishReferenceCandidateCache.namesFor(symbol)) {
      for (const candidate of lookup(name)) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        results.push(candidate);
      }
    }
    return results;
  }

  removeByUri(uri: DocumentUri): void {
    const ids = this.idsByUri.get(uri);
    if (!ids) {
      this.initializedUris.delete(uri);
      return;
    }

    for (const id of [...ids]) {
      const candidate = this.byId.get(id);
      if (!candidate) continue;

      const nameBucket = this.idsByName.get(candidate.name);
      if (nameBucket) {
        nameBucket.delete(id);
        if (nameBucket.size === 0) {
          this.idsByName.delete(candidate.name);
        }
      }

      const documentNameBuckets = this.idsByUriAndName.get(uri);
      const documentNameBucket = documentNameBuckets?.get(candidate.name);
      if (documentNameBucket) {
        documentNameBucket.delete(id);
        if (documentNameBucket.size === 0) {
          documentNameBuckets?.delete(candidate.name);
        }
      }
      if (documentNameBuckets?.size === 0) {
        this.idsByUriAndName.delete(uri);
      }

      this.byId.delete(id);
    }

    this.idsByUri.delete(uri);
    this.initializedUris.delete(uri);
  }

  ensureDocument(document: LspDocument, root: SyntaxNode | undefined): void {
    if (this.initializedUris.has(document.uri)) return;
    if (!root) return;

    const nodes = root.descendantsOfType([...REFERENCE_CANDIDATE_NODE_TYPES]);
    for (const node of nodes) {
      if (!isReferenceCandidateNode(node)) continue;

      let uriBucket = this.idsByUri.get(document.uri);
      if (!uriBucket) {
        uriBucket = new Set();
        this.idsByUri.set(document.uri, uriBucket);
      }

      let documentNameBuckets = this.idsByUriAndName.get(document.uri);
      if (!documentNameBuckets) {
        documentNameBuckets = new Map();
        this.idsByUriAndName.set(document.uri, documentNameBuckets);
      }

      for (const name of extractReferenceCandidateNames(node)) {
        const candidate = new FishReferenceCandidate(document, node, name);
        this.byId.set(candidate.id, candidate);

        let nameBucket = this.idsByName.get(name);
        if (!nameBucket) {
          nameBucket = new Set();
          this.idsByName.set(name, nameBucket);
        }
        nameBucket.add(candidate.id);

        let documentNameBucket = documentNameBuckets.get(name);
        if (!documentNameBucket) {
          documentNameBucket = new Set();
          documentNameBuckets.set(name, documentNameBucket);
        }
        documentNameBucket.add(candidate.id);

        uriBucket.add(candidate.id);
      }
    }

    this.initializedUris.add(document.uri);
  }
}
