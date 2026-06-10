import { SyntaxNode } from 'web-tree-sitter';
import { Range } from 'vscode-languageserver';
import { getCommandNameNode, isCommandWithName, isConcatenation, isString } from '../utils/node-types';
import { LspDocument } from '../document';
import { FishSymbol } from './symbol';
import { DefinitionScope } from '../utils/definition-scope';
import { getRange } from '../utils/tree-sitter';
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
  // skip the `export` command-name node itself. Using the `name` field is
  // robust against `override_variable` prefixes.
  const cmdName = getCommandNameNode(parentNode);
  if (cmdName && cmdName.equals(node)) return false;
  const args = parentNode.childrenForFieldName('argument');
  // first element of args is the export name
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
  const argument = node.childrenForFieldName('argument')[0];
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

/**
 * Process an export command to create a FishSymbol
 */
export function processExportCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []): FishSymbol[] {
  if (!isExportDefinition(node)) return [];

  // Get the variable assignment part (the first `argument` field).
  // Reading via the field rather than `namedChildren.slice(1)` correctly
  // skips both the command name and any `override_variable` prefix.
  const args = node.childrenForFieldName('argument');
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

  // Create a FishSymbol for the export definition. The hover `detail` is built
  // lazily by `createDetail` → `buildVariableDetail` (the same path as `set -gx`),
  // so an `EXPORT` symbol renders identically to a normal exported variable.
  return [
    FishSymbol.fromObject({
      name,
      node,
      focusedNode: varDefNode,
      range: getRange(node),
      selectionRange: nameRange,
      fishKind: 'EXPORT',
      document,
      uri: document.uri,
      // Built lazily by `createDetail` → `buildVariableDetail`; the seed is unused.
      detail: '',
      scope,
      // this is so that we always see that export variables are global and exported
      options: [Option.create('-g', '--global'), Option.create('-x', '--export')],
      children,
    }),
  ];
}
