import { DocumentUri, Range, Location } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { FishString } from './string';
import  * as Locations  from '../utils/locations';
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
  isString,
  isVariable,
  isVariableDefinitionName,
  isVariableExpansion,
} from '../utils/node-types';
import { getRange } from '../utils/tree-sitter';

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
    return node.text === symbol.name
      || isCommandName(node)
      || isString(node)
      || isOption(node)
      || isCompleteDefinitionNode(node);
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
    return [node.text];
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

export class FishReferenceCandidate {
  constructor(
    public readonly document: LspDocument,
    public readonly node: SyntaxNode,
    public readonly name: string,
    public readonly range: Range = rangeFromNode(node),
    public readonly location: Location = Locations.Location.create(document.uri, rangeFromNode(node)),
  ) {}

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

    const uriPriorityFor = (uri: DocumentUri, uriType: string | null | undefined): number => {
      const cached = uriPriorityCache.get(uri);
      if (cached !== undefined) return cached;
      let priority = 10;
      if (uri === defSymbol.uri) priority = 100;
      else if (hasCompletionPriority && (uriType === 'completions' || uri.includes('completions/'))) priority = 50;
      const uriHash = uri.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      priority += (uriHash % 1000) / 10000;
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
      const aw = weightFor(ainfo);
      const bw = weightFor(binfo);
      if (aw !== bw) return bw - aw;
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    };
  }
}

type SortableRef = Location | FishReferenceCandidate;


export class FishReferenceCandidateCache {
  private readonly byId = new Map<string, FishReferenceCandidate>();
  private readonly idsByName = new Map<string, Set<string>>();
  private readonly idsByUri = new Map<DocumentUri, Set<string>>();
  private readonly idsByUriAndName = new Map<DocumentUri, Map<string, Set<string>>>();
  private readonly initializedUris = new Set<DocumentUri>();

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
