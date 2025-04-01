import { SyntaxNode } from 'web-tree-sitter';
import { findParentFunction, isCommandWithName, isFunctionDefinition, isProgram, isTopLevelDefinition } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';
import { Range } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { Analyzer } from '../analyze';
import { getParentNodesGen, getRange, precedesRange } from '../utils/tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { FishSymbol } from './symbol';

// TODO think of better naming conventions for these functions
// TODO add symbols in sourced file to the current file in analysis
// TODO add sourced file to the current workspace

export function isSourceCommandName(node: SyntaxNode) {
  return isCommandWithName(node, 'source') || isCommandWithName(node, '.');
}

export function isSourceCommandWithArgument(node: SyntaxNode) {
  return isSourceCommandName(node) && node.childCount > 1 && node.child(1)?.text !== '-';
}

export function isSourceCommandArgumentName(node: SyntaxNode) {
  if (node.parent && isSourceCommandWithArgument(node.parent)) {
    return node.parent?.child(1)?.equals(node) && node.isNamed && node.text !== '-';
  }
  return false;
}

export function isSourcedFilename(node: SyntaxNode) {
  if (node.parent && isSourceCommandName(node.parent)) {
    return node.parent?.child(1)?.equals(node) && node.isNamed && node.text !== '-';
  }
  return false;
}

export function isExistingSourceFilenameNode(node: SyntaxNode) {
  if (!isSourcedFilename(node)) return false;
  return SyncFileHelper.exists(node.text);
}

export function getExpandedSourcedFilenameNode(node: SyntaxNode) {
  if (isExistingSourceFilenameNode(node)) {
    return SyncFileHelper.expandEnvVars(node.text);
  }
  return undefined;
}

export interface SourceResource {
  from: LspDocument;
  to: LspDocument;
  range: Range;
  node: SyntaxNode;
  definitionScope: DefinitionScope;
  // children: FishSymbol[];
  sources: SourceResource[];
}

export class SourceResource {
  constructor(
    public from: LspDocument,
    public to: LspDocument,
    public range: Range,
    public node: SyntaxNode,
    public definitionScope: DefinitionScope,
    // public children: FishSymbol[],
    public sources: SourceResource[],
  ) { }

  static create(
    from: LspDocument,
    to: LspDocument,
    range: Range,
    node: SyntaxNode,
    sources: SourceResource[],
  ) {
    let scopeParent: SyntaxNode | null = node.parent;
    for (const parent of getParentNodesGen(node)) {
      if (isFunctionDefinition(parent) || isProgram(parent)) {
        scopeParent = parent;
        break;
      }
    }
    const definitionScope = DefinitionScope.create(scopeParent!, 'local');
    return new SourceResource(from, to, range, node, definitionScope, sources);
  }

  scopeReachableFromNode(node: SyntaxNode) {
    const parent = findParentFunction(node);
    const isTopLevel = isTopLevelDefinition(this.node);
    if (parent && !isTopLevel) return this.definitionScope.containsNode(node);
    return this.definitionScope.containsNode(node) && node.startIndex >= this.definitionScope.scopeNode.startIndex;
  }
}

export function createSourceResources(analyzer: Analyzer, from: LspDocument): SourceResource[] {
  const result: SourceResource[] = [];
  const nodes = analyzer.getNodes(from).filter(n => {
    return isSourceCommandArgumentName(n) && !!isExistingSourceFilenameNode(n);
  });
  if (nodes.length === 0) return result;
  for (const node of nodes) {
    const sourcedFile = getExpandedSourcedFilenameNode(node);
    if (!sourcedFile) continue;
    const to = analyzer.getDocumentFromPath(sourcedFile) ||
      SyncFileHelper.toLspDocument(sourcedFile);
    const range = getRange(node);
    analyzer.analyze(to);
    const sources = createSourceResources(analyzer, to);
    result.push(SourceResource.create(from, to, range, node, sources));
  }
  return result;
}

export function reachableSources(resources: SourceResource[], uniqueUris: Set<string> = new Set<string>()): SourceResource[] {
  const result: SourceResource[] = [];
  const sourceShouldInclude = (
    child: SourceResource,
    parent: SourceResource,
  ) => {
    return child.definitionScope.containsNode(parent.node)
      && precedesRange(parent.range, child.range)
      && !uniqueUris.has(child.to.uri);
  };
  for (const resource of resources) {
    const children = reachableSources(resource.sources);
    if (!uniqueUris.has(resource.to.uri)) {
      uniqueUris.add(resource.to.uri);
      result.push(resource);
    }
    for (const child of children) {
      if (sourceShouldInclude(child, resource)) {
        uniqueUris.add(child.to.uri);
        result.push(child);
      }
    }
  }
  return result;
}

export function symbolsFromResource(analyzer: Analyzer, resources: SourceResource, uniqueNames: Set<string> = new Set<string>()): FishSymbol[] {
  const result: FishSymbol[] = [];
  const symbols = analyzer.getFlatDocumentSymbols(resources.to.uri);
  for (const symbol of symbols) {
    if (uniqueNames.has(symbol.name)) continue;
    if (symbol.isGlobal() || symbol.isRootLevel()) {
      result.push(symbol);
    }
  }
  return result;
}
