import { LspDocument } from '../document';
import { Analyzer, analyzer } from '../analyze';
import { logger } from '../logger';
import { SyncFileHelper } from './file-operations';
import path from 'path';

interface ParseTreeOutput {
  source: string;
  parseTree: string;
}

/**
 * Debug utility that acts like tree-sitter-cli on a source file.
 * Shows both the raw source code and the tree-sitter parse tree.
 *
 * @param document - The LspDocument to debug
 * @returns Object containing both source and parse tree as strings
 */
export function debugWorkspaceDocument(document: LspDocument): ParseTreeOutput {
  const source = document.getText();

  // Parse the document using the existing analyzer's parser
  const tree = analyzer.parser.parse(source);

  // Convert the parse tree to a readable string format
  const parseTree = formatSyntaxTree(tree.rootNode, 0);

  return {
    source,
    parseTree,
  };
}

/**
 * Recursively formats a syntax tree node into a readable string representation
 * similar to tree-sitter-cli output.
 */
function formatSyntaxTree(node: any, depth: number = 0): string {
  const indent = '  '.repeat(depth);
  const rawNodeType = node.type || 'unknown';
  // If node type is just whitespace, escape it for visibility
  const nodeType = rawNodeType.trim() === '' ? escapeWhitespace(rawNodeType) : rawNodeType;
  const startPos = `${node.startPosition?.row || 0}:${node.startPosition?.column || 0}`;
  const endPos = `${node.endPosition?.row || 0}:${node.endPosition?.column || 0}`;

  let result = `${indent}(${nodeType} [${startPos}, ${endPos}]`;

  // If it's a leaf node with text, show the text with proper escaping
  if (node.children.length === 0 && node.text) {
    const escapedText = escapeWhitespace(node.text);
    result += ` "${escapedText}"`;
  }

  // Handle children
  if (node.children.length > 0) {
    result += '\n';
    // Recursively format children
    for (const child of node.children) {
      result += formatSyntaxTree(child, depth + 1);
    }
    result += `${indent})`;
  } else {
    result += ')';
  }

  // Always end with a newline, regardless of whether this node has children
  result += '\n';

  return result;
}

/**
 * Escapes whitespace characters in text for readable display
 * Uses JSON.stringify for proper escaping similar to tree-sitter-cli
 */
function escapeWhitespace(text: string): string {
  // Use JSON.stringify to properly escape the string, then remove the outer quotes
  const escaped = JSON.stringify(text);
  return escaped.slice(1, -1); // Remove the surrounding quotes
}

/**
 * Pretty prints the debug output to console in a readable format.
 *
 * @param document - The LspDocument to debug
 */
export function logTreeSitterDocumentDebug(document: LspDocument): void {
  const { source, parseTree } = debugWorkspaceDocument(document);

  logger.log('='.repeat(80));
  logger.log(`DEBUG: ${document.getFileName()}`);
  logger.log('='.repeat(80));
  logger.log('SOURCE:');
  logger.log('-'.repeat(40));

  // Print source with line numbers
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    logger.log(`${(index + 1).toString().padStart(3)}: ${line}`);
  });

  logger.log('\n' + '-'.repeat(40));
  logger.log('PARSE TREE:');
  logger.log('-'.repeat(40));
  logger.log(parseTree);
  logger.log('='.repeat(80));
}

export function expandParseCliTreeFile(input: string | undefined): string {
  if (!input || !input.trim()) {
    return '';
  }

  const resultPath = SyncFileHelper.expandEnvVars(input);
  if (SyncFileHelper.isAbsolutePath(resultPath)) {
    return resultPath;
  }
  return path.resolve(resultPath);
}

export async function cliDumpParseTree(document: LspDocument): Promise<void> {
  await Analyzer.initialize();
  const { parseTree } = debugWorkspaceDocument(document);

  // Output the parse tree to stdout
  logger.logToStdout(parseTree);
}
