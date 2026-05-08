import { DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { FishString } from './string';
import { isGenericFunctionEventHandlerDefinitionName } from './emit';
import { isArgparseVariableDefinitionName } from './argparse';
import { isMatchingOption, isMatchingOptionOrOptionValue, Option } from './options';
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

export class FishReferenceCandidate {
  constructor(
    public readonly document: LspDocument,
    public readonly node: SyntaxNode,
    public readonly name: string,
  ) { }

  get uri(): DocumentUri {
    return this.document.uri;
  }

  get id(): string {
    return [
      this.uri,
      this.node.startPosition.row.toString(),
      this.node.startPosition.column.toString(),
      this.node.endPosition.row.toString(),
      this.node.endPosition.column.toString(),
      this.node.type,
      this.name,
    ].join(':');
  }
}

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
