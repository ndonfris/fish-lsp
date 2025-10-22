import { SyntaxNode } from 'web-tree-sitter';
import { Range } from 'vscode-languageserver';
import { isCommandWithName, isConcatenation, isString } from '../utils/node-types';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { getRange } from '../utils/tree-sitter';
import { md } from '../utils/markdown-builder';
import { uriToReadablePath } from '../utils/translation';
import { Option } from './options';

/**
 * Checks if a node is an export command definition
 */
export function isExportDefinition(node: SyntaxNode): boolean {
  return isCommandWithName(node, 'export') && node.children.length >= 2;
}
/**
 * Checks if a node is a variable name in an export statement (NAME=VALUE)
 */
export function isExportVariableDefinitionName(node: SyntaxNode): boolean {
  if (isString(node) || isConcatenation(node)) return false;
  if (!node.parent) return false;
  // concatenated node is an export with `=`
  const isConcatenated = isConcatenation(node.parent);
  // if the parent is a concatenation node, then move up to it's parent
  let parentNode = node.parent;
  // if that is the case, then we need to move up 1 more parent
  if (isConcatenated) parentNode = parentNode.parent as SyntaxNode;
  if (!parentNode || !isCommandWithName(parentNode, 'export')) return false;
  // since there is two possible cases, handle concatenated and non-concatenated differently
  const firstChild = isConcatenated
    ? parentNode.firstNamedChild
    : parentNode.firstChild;
  // skip `export` named node, since it's not the alias name
  if (firstChild && firstChild.equals(node)) return false;
  const args = parentNode.childrenForFieldName('argument');
  // first element is args is the export name
  const exportName = isConcatenated
    ? args.at(0)?.firstChild
    : args.at(0);
  return !!exportName && exportName.equals(node);
}

type ExtractedExportVariable = {
  name: string;
  value: string;
  nameRange: Range;
};

export function findVariableDefinitionNameNode(node: SyntaxNode): {
  nameNode?: SyntaxNode;
  valueNode?: SyntaxNode;
  isConcatenation: boolean;
  isValueString: boolean;
  isNonEscaped: boolean;
} {
  function getName(node: SyntaxNode): SyntaxNode | undefined {
    let current: SyntaxNode | null = node;
    while (current && current.type === 'concatenation') {
      current = current.firstChild;
    }
    if (!current) return undefined;
    return current;
  }

  function getValue(node: SyntaxNode): SyntaxNode | undefined {
    let current: SyntaxNode | null = node;
    while (current && current.type === 'concatenation') {
      current = current.lastChild;
    }
    if (!current) return undefined;
    return current;
  }

  let isConcatenation = false;
  const nameNode = getName(node);
  const valueNode = getValue(node);
  const isValueString = !!valueNode && isString(valueNode);
  const isNonEscaped = !!valueNode && !!nameNode && nameNode.equals(valueNode);

  if (!nameNode || !valueNode) {
    return {
      nameNode,
      valueNode,
      isConcatenation: false,
      isValueString,
      isNonEscaped,
    };
  }
  if (nameNode?.equals(valueNode)) {
    return {
      nameNode,
      valueNode,
      isConcatenation,
      isValueString,
      isNonEscaped,
    };
  }
  isConcatenation = true;
  return {
    nameNode,
    valueNode,
    isConcatenation,
    isValueString,
    isNonEscaped,
  };
}

/**
 * Extracts variable information from an export definition
 */
export function extractExportVariable(node: SyntaxNode): ExtractedExportVariable | null {
  const argument = node.firstChild?.nextNamedSibling;
  if (!argument) {
    return null;
  }

  // Split on the first '=' to get name and value
  const [name, ...valueParts] = argument.text.split('=') as [string, ...string[]];
  const value = valueParts.join('='); // Rejoin in case value contains '='

  // Calculate range for just the name part
  const nameStart = {
    line: argument.startPosition.row,
    character: argument.startPosition.column,
  };

  const nameEnd = {
    line: nameStart.line,
    character: nameStart.character + name.length,
  };

  return { name, value, nameRange: Range.create(nameStart, nameEnd) };
}

export function buildExportDetail(doc: LspDocument, commandNode: SyntaxNode, variableDefinitionNode: SyntaxNode) {
  const commandText = commandNode.text;

  const extracted = extractExportVariable(variableDefinitionNode);
  if (!extracted) return '';
  const { name, value } = extracted;

  // Create a detail string with the command and variable definition
  const detail = [
    `${md.bold('(variable)')} ${md.inlineCode(name)}`,
    `${md.italic('globally')} scoped, ${md.italic('exported')}`,
    `located in file: ${md.inlineCode(uriToReadablePath(doc.uri))}`,
    md.separator(),
    md.codeBlock('fish', commandText),
    md.separator(),
    md.codeBlock('fish', `set -gx ${name} ${value}`),
  ].join(md.newline());
  return detail;
}

/**
 * Process an export command to create a FishSymbol
 */
export function processExportCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []): FishSymbol[] {
  if (!isExportDefinition(node)) return [];

  // Get the second argument (the variable assignment part)
  const args = node.namedChildren.slice(1); // Skip 'export' command name
  if (args.length === 0) return [];

  const argNode = args[0]!;

  // Find the variable definition in the command's arguments
  const found = findVariableDefinitionNameNode(argNode);

  const varDefNode = found?.nameNode;
  if (!found || !varDefNode) return [];

  const {
    name,
    nameRange,
  } = extractExportVariable(node) as ExtractedExportVariable;

  // Get the scope - export always creates global exported variables
  const scope = DefinitionScope.create(node.parent || node, 'global');

  // The detail will be formatted by FishSymbol.setupDetail()
  const detail = buildExportDetail(document, node, found.nameNode!);

  // Create a FishSymbol for the export definition - using 'SET' fishKind
  // since export is effectively an alias for 'set -gx'
  return [
    FishSymbol.fromObject({
      name,
      node,
      focusedNode: varDefNode,
      range: getRange(node),
      selectionRange: nameRange,
      fishKind: 'EXPORT', // Using SET since export is equivalent to 'set -gx'
      document,
      uri: document.uri,
      detail,
      scope,
      // this is so that we always see that export variables are global and exported
      options: [Option.create('-g', '--global'), Option.create('-x', '--export')],
      children,
    }),
  ];
}

