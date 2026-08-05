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

interface SourceResolutionContext {
  baseDir?: string;
  sourceFilePath?: string;
}

const statusFilenameSubcommands = new Set([
  'filename',
  'current-filename',
  '-f',
  '--current-filename',
]);

export function isSourceCommandName(node: SyntaxNode) {
  return isCommandWithName(node, 'source') || isCommandWithName(node, '.');
}

/**
 * Returns the first non-flag argument of a `source` / `.` command, or
 * `undefined`. Reading via the `argument` field skips both the command
 * name and any `override_variable` prefixes (post tree-sitter-fish PR #41).
 */
function sourceFilenameArgument(node: SyntaxNode): SyntaxNode | undefined {
  const args = node.childrenForFieldName('argument');
  const first = args[0];
  if (!first || first.text === '-') return undefined;
  return first;
}

export function isSourceCommandWithArgument(node: SyntaxNode) {
  return isSourceCommandName(node) && !!sourceFilenameArgument(node);
}

export function isSourceCommandArgumentName(node: SyntaxNode) {
  if (node.parent && isSourceCommandWithArgument(node.parent)) {
    const arg = sourceFilenameArgument(node.parent);
    return !!arg && arg.equals(node) && node.isNamed && node.text !== '-';
  }
  return false;
}

export function isSourcedFilename(node: SyntaxNode) {
  if (node.parent && isSourceCommandName(node.parent)) {
    const arg = sourceFilenameArgument(node.parent);
    return !!arg && arg.equals(node) && node.isNamed && node.text !== '-';
  }
  return false;
}

export function getResolvedSourcedFilenameNode(
  node: SyntaxNode,
  baseDir?: string,
  sourceFilePath?: string,
): string | undefined {
  if (!isSourcedFilename(node)) return undefined;
  return resolveSourcePath(node, { baseDir, sourceFilePath });
}

export function isExistingSourceFilenameNode(
  node: SyntaxNode,
  baseDir?: string,
  sourceFilePath?: string,
): boolean {
  const resolvedPath = getResolvedSourcedFilenameNode(node, baseDir, sourceFilePath);
  return !!resolvedPath && isExistingFile(resolvedPath);
}

export function getExpandedSourcedFilenameNode(
  node: SyntaxNode,
  baseDir?: string,
  sourceFilePath?: string,
): string | undefined {
  const resolvedPath = getResolvedSourcedFilenameNode(node, baseDir, sourceFilePath);
  if (resolvedPath && isExistingFile(resolvedPath)) {
    return SyncFileHelper.expandEnvVars(resolvedPath);
  }
  return undefined;
}

function evaluateCommandArgument(node: SyntaxNode, context: SourceResolutionContext): string | undefined {
  if (node.type === 'command_substitution') {
    return evaluateCommandSubstitution(node, context);
  }
  return node.text;
}

/**
 * Evaluates only deterministic commands used to derive paths from the current
 * script. `stdin` is supplied when the command is part of a supported pipe.
 */
function evaluatePathCommand(
  node: SyntaxNode,
  context: SourceResolutionContext,
  stdin?: string,
): string | undefined {
  if (node.type !== 'command') return undefined;

  const commandName = node.childForFieldName('name')?.text;
  const args = node.childrenForFieldName('argument');

  if (commandName === 'status' && stdin === undefined && args.length === 1) {
    const subcommand = args[0]?.text;
    if (subcommand === 'dirname') return context.baseDir;
    if (subcommand === 'basename') {
      return context.sourceFilePath ? path.basename(context.sourceFilePath) : undefined;
    }
    if (subcommand && statusFilenameSubcommands.has(subcommand)) {
      return context.sourceFilePath;
    }
    return undefined;
  }

  if (commandName === 'dirname' && stdin === undefined && args.length === 1) {
    const operand = evaluateCommandArgument(args[0]!, context);
    return operand === undefined ? undefined : dirname(operand);
  }

  if (commandName !== 'path' || args[0]?.text !== 'dirname') return undefined;

  if (stdin !== undefined && args.length === 1) {
    return dirname(stdin);
  }
  if (stdin === undefined && args.length === 2) {
    const operand = evaluateCommandArgument(args[1]!, context);
    return operand === undefined ? undefined : dirname(operand);
  }
  return undefined;
}

function evaluateCommandSubstitution(node: SyntaxNode, context: SourceResolutionContext): string | undefined {
  const expression = node.firstNamedChild;
  if (!expression) return undefined;

  const flattenPipeline = (current: SyntaxNode): SyntaxNode[] | undefined => {
    if (current.type === 'command') return [current];
    if (current.type !== 'pipe') return undefined;

    const commands: SyntaxNode[] = [];
    for (const child of current.namedChildren) {
      const nested = flattenPipeline(child);
      if (!nested) return undefined;
      commands.push(...nested);
    }
    return commands;
  };

  const commands = flattenPipeline(expression);
  if (!commands || commands.length === 0) return undefined;
  if (commands.length === 1) {
    return evaluatePathCommand(commands[0]!, context);
  }

  let output: string | undefined;
  for (const [index, command] of commands.entries()) {
    output = evaluatePathCommand(command, context, index === 0 ? undefined : output);
    if (output === undefined) return undefined;
  }
  return output;
}

/**
 * Expands deterministic command substitutions while preserving literal and
 * environment-variable path fragments for the existing path resolver.
 */
function evaluateSourceArgument(node: SyntaxNode, context: SourceResolutionContext): string | undefined {
  if (node.type === 'command_substitution') {
    return evaluateCommandSubstitution(node, context);
  }
  if (node.type !== 'concatenation') {
    return node.text;
  }

  const parts: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'command_substitution') {
      const expanded = evaluateCommandSubstitution(child, context);
      if (expanded === undefined) return undefined;
      parts.push(expanded);
    } else {
      parts.push(child.text);
    }
  }
  return parts.join('');
}

/**
 * Resolves a source path that might be relative, relative to the base directory
 * @param node The source command's filename argument
 * @param context Information about the document containing the source command
 * @returns The resolved path candidate, or `undefined` for a dynamic expression
 */
function resolveSourcePath(node: SyntaxNode, context: SourceResolutionContext): string | undefined {
  const sourcePath = evaluateSourceArgument(node, context);
  if (sourcePath === undefined) return undefined;

  // Expand environment variables first
  const expandedPath = SyncFileHelper.expandEnvVars(sourcePath);

  // Normalize absolute paths before using them as document/source graph keys.
  if (isAbsolute(expandedPath)) {
    return path.normalize(expandedPath);
  }

  // Try to find the file in multiple possible locations
  const foundPath = findFirstExistingFile(
    path.join(context.baseDir || workspaceManager.current?.path || process.cwd(), expandedPath),
    path.resolve(process.cwd(), expandedPath),
    path.resolve(process.env.PWD || '', expandedPath),
    path.resolve(workspaceManager.current?.path || '', expandedPath),
  );

  // Return the found path or the expanded path as fallback
  return path.normalize(foundPath ?? expandedPath);
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
    return isSourceCommandArgumentName(n) && !!isExistingSourceFilenameNode(n, baseDir, fromPath);
  });
  if (nodes.length === 0) return result;
  for (const node of nodes) {
    const sourcedFile = getExpandedSourcedFilenameNode(node, baseDir, fromPath);
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
