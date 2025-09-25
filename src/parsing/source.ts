import { SyntaxNode } from 'web-tree-sitter';
import { findParentFunction, isCommandWithName, isFunctionDefinition, isProgram, isTopLevelDefinition } from '../utils/node-types';
import { SyncFileHelper } from '../utils/file-operations';
import { Range } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { Analyzer } from '../analyze';
import { getParentNodesGen, getRange, precedesRange } from '../utils/tree-sitter';
import { DefinitionScope } from '../utils/definition-scope';
import { FishSymbol } from './symbol';
import { uriToPath } from '../utils/translation';
import path, { dirname, isAbsolute } from 'path';
import { workspaceManager } from '../utils/workspace-manager';
import { findFirstExistingFile, isExistingFile } from '../utils/path-resolution';

// TODO think of better naming conventions for these functions

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

export function isExistingSourceFilenameNode(node: SyntaxNode, baseDir?: string) {
  if (!isSourcedFilename(node)) return false;
  const resolvedPath = resolveSourcePath(node.text, baseDir);
  return resolvedPath && isExistingFile(resolvedPath);
}

export function getExpandedSourcedFilenameNode(node: SyntaxNode, baseDir?: string) {
  if (!isSourcedFilename(node)) return undefined;

  const resolvedPath = resolveSourcePath(node.text, baseDir);
  if (resolvedPath && isExistingFile(resolvedPath)) {
    return SyncFileHelper.expandEnvVars(resolvedPath);
  }
  return undefined;
}

/**
 * Resolves a source path that might be relative, relative to the base directory
 * @param sourcePath The path from the source command (e.g., "./scripts/file.fish", "/abs/path.fish")
 * @param baseDir The directory to resolve relative paths against (usually the directory containing the sourcing script)
 * @returns The resolved absolute path, or the original path if it was already absolute
 */
function resolveSourcePath(sourcePath: string, baseDir?: string): string {
  // Expand environment variables first
  const expandedPath = SyncFileHelper.expandEnvVars(sourcePath);

  // If it's already an absolute path, return as-is
  if (isAbsolute(expandedPath)) {
    return expandedPath;
  }

  // Try to find the file in multiple possible locations
  const foundPath = findFirstExistingFile(
    path.join(baseDir || workspaceManager.current?.path || process.cwd(), expandedPath),
    path.resolve(process.cwd(), expandedPath),
    path.resolve(process.env.PWD || '', expandedPath),
    path.resolve(workspaceManager.current?.path || '', expandedPath),
  );

  // Return the found path or the expanded path as fallback
  return foundPath ?? expandedPath;
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

  // Get the directory containing the current document for resolving relative paths
  const fromPath = uriToPath(from.uri);
  const baseDir = dirname(fromPath);

  const nodes = analyzer.getNodes(from.uri).filter(n => {
    return isSourceCommandArgumentName(n) && !!isExistingSourceFilenameNode(n, baseDir);
  });
  if (nodes.length === 0) return result;
  for (const node of nodes) {
    const sourcedFile = getExpandedSourcedFilenameNode(node, baseDir);
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
