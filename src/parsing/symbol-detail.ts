import { SymbolKind } from 'vscode-languageserver';
import { FishSymbol, fishSymbolKindToSymbolKind } from './symbol';
import { md } from '../utils/markdown-builder';
import { findOptions } from './options';
import { findFunctionDefinitionChildren, FunctionOptions } from './function';
import { isString } from '../utils/node-types';
import { uriToReadablePath, uriToPath } from '../utils/translation';
import { PrebuiltDocumentationMap } from '../utils/snippets';
import { setModifierDetailDescriptor, SetModifiers } from './set';
import { SyntaxNode } from 'web-tree-sitter';
import { FishAlias } from './alias';
import { env } from '../utils/env-manager';
import { logger } from '../logger';

// IF YOU ARE READING THIS FILE, PLEASE FEEL FREE TO REFACTOR IT (sorry my brain is fried)

/**
 * Since a SyntaxNode's text could equal something like:
 * ```fish
 * # assume we are indented one level, (if_statement wont have leading spaces)
 * if true
 *         echo "Hello, world!"
 *     end
 * ```
 * We want to remove a single indentation level from the text, after the first line.
 * @param node The SyntaxNode to unindent
 * @returns The unindented text of the SyntaxNode (the last line's indentation amount will be how much is removed from the rest of the lines)
 */
export function unindentNestedSyntaxNode(node: SyntaxNode) {
  const lines = node.text.split('\n');
  if (lines.length > 1) {
    const lastLine = node.lastChild?.startPosition.column || 0;
    return lines
      .map(line => line.replace(' '.repeat(lastLine), ''))
      .join('\n')
      .trimEnd();
  }
  return node.text;
}

function getSymbolKind(symbol: FishSymbol) {
  const kind = fishSymbolKindToSymbolKind[symbol.fishKind];
  switch (kind) {
    case SymbolKind.Variable:
      return 'variable';
    case SymbolKind.Function:
      return 'function';
    default:
      return '';
  }
}

/**
 * Checks if a file path is within any autoloaded fish directories
 *
 * @param uriOrPath The URI or filesystem path to check
 * @param type Optional specific autoload type to check for (e.g., 'functions', 'completions')
 * @returns True if the path is within an autoloaded directory, false otherwise
 */
export function isAutoloadedPath(uriOrPath: string, type?: string): boolean {
  // Convert URI to path if necessary
  const path = uriOrPath.startsWith('file://') ? uriToPath(uriOrPath) : uriOrPath;

  // Get all autoloaded variables from the environment
  const autoloadedKeys = env.getAutoloadedKeys();

  for (const key of autoloadedKeys) {
    // Skip if we're looking for a specific type and this key doesn't match
    if (type && !key.toLowerCase().includes(type.toLowerCase())) {
      continue;
    }

    const values = env.getAsArray(key);

    for (const value of values) {
      if (path.startsWith(value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Gets the autoload type of a path if it is autoloaded
 *
 * @param uriOrPath The URI or filesystem path to check
 * @returns The identified autoload type ('functions', 'completions', 'conf.d', etc.) or empty string if not autoloaded
 */
export function getAutoloadType(uriOrPath: string): string {
  // Convert URI to path if necessary
  const path = uriOrPath.startsWith('file://') ? uriToPath(uriOrPath) : uriOrPath;

  // Common autoload types to check for
  const autoloadTypes = ['functions', 'completions', 'conf.d', 'config'];

  // Check path for these common types
  for (const type of autoloadTypes) {
    if (path.includes(`/fish/${type}`)) {
      return type;
    }

    // Special case for config.fish
    if (type === 'config' && path.endsWith('config.fish')) {
      return 'config';
    }
  }

  // If no specific type was found but the path is autoloaded, return a generic indicator
  if (isAutoloadedPath(path)) {
    return 'autoloaded';
  }

  return '';
}

function buildFunctionDetail(symbol: FishSymbol) {
  const { name, node, fishKind } = symbol;
  if (fishKind === 'ALIAS') {
    return FishAlias.buildDetail(node) as string;
  }

  const options = findOptions(findFunctionDefinitionChildren(node), FunctionOptions);
  const descriptionOption = options.found.find(option => option.option.isOption('-d', '---description'));
  const description = [`(${md.bold('function')}) ${md.inlineCode(name)}`];
  if (descriptionOption && descriptionOption.value) {
    description.push(
      isString(descriptionOption.value)
        ? descriptionOption.value.text.slice(1, -1)
        : descriptionOption.value.text,
    );
  }

  description.push(md.separator());
  const scope: string[] = [];
  if (isAutoloadedPath(symbol.uri)) {
    scope.push('autoloaded');
  }
  if (symbol.isGlobal()) {
    scope.push('globally scoped');
  }
  if (scope.length > 0) {
    description.push(scope.join(', '));
  }

  description.push(`located in file: ${md.inlineCode(uriToReadablePath(symbol.uri))}`);
  description.push(md.separator());
  const prebuilt = PrebuiltDocumentationMap.getByType('command').find(c => c.name === name);
  if (prebuilt) {
    description.push(prebuilt.description);
    description.push(md.separator());
  }

  description.push(md.codeBlock('fish', unindentNestedSyntaxNode(node)));

  const argumentNamesOption = options.found.filter(option => option.option.isOption('-a', '--argument-names'));
  if (argumentNamesOption && argumentNamesOption.length) {
    const functionCall = [name];
    for (const arg of argumentNamesOption) {
      functionCall.push(arg.value.text);
    }
    description.push(md.separator());
    description.push(md.codeBlock('fish', functionCall.join(' ')));
  }
  return description.join(md.newline());
}

function isVariableArgumentNamed(node: SyntaxNode, name: string) {
  if (node.type !== 'function_definition') return '';
  const children = findFunctionDefinitionChildren(node);
  if (findOptions(children, FunctionOptions).found
    .filter(flag => flag.option.isOption('-a', '--argument-names'))
    .some(flag => flag.value.text === name)) {
    return true;
  }
  return false;
}

function getArgumentNamesIndexString(node: SyntaxNode, name: string) {
  if (node?.type && node?.type !== 'function_definition') return '';
  const children = findFunctionDefinitionChildren(node);
  // const resultFlags: string[] = [];
  const index = findOptions(children, FunctionOptions).found
    .filter(flag => flag.option.isOption('-a', '--argument-names'))
    .findIndex((flag) => flag.value.text === name);
  const argvStr = '$argv[' + (index + 1) + ']';
  return `${md.italic('named argument')}: ${md.inlineCode(argvStr)}`;
}

function buildVariableDetail(symbol: FishSymbol) {
  const { name, node, uri, fishKind } = symbol;
  if (!node) return '';
  const description = [`(${md.bold('variable')}) ${md.inlineCode(name)}`];
  // add short info about variable
  description.push(md.separator());
  if (fishKind === 'SET' || fishKind === 'READ') {
    const setModifiers = SetModifiers.filter(option => option.equalsRawLongOption('--universal', '--global', '--function', '--local', '--export', '--unexport'));
    const options = findOptions(node.childrenForFieldName('argument'), setModifiers);
    const modifier = options.found.find(o => o.option.equalsRawOption('-U', '-g', '-f', '-l', '-x', '-u'));
    if (modifier) {
      description.push(setModifierDetailDescriptor(node));
    }
  } else if (fishKind === 'ARGPARSE') {
    description.push('locally scoped');
  } else if (node && isVariableArgumentNamed(node, name)) {
    try {
      const result = getArgumentNamesIndexString(node, name);
      description.push(result);
    } catch (e) {
      logger.error('ERROR: building variable detail', e);
    }
  }
  // add location
  description.push(`located in file: ${md.inlineCode(uriToReadablePath(uri))}`);
  // add prebuilt documentation if available
  const prebuilt = PrebuiltDocumentationMap.getByType('variable').find(c => c.name === name);
  if (prebuilt) {
    description.push(md.separator());
    description.push(prebuilt.description);
  }
  description.push(md.separator());
  // add code block of entire region
  description.push(md.codeBlock('fish', unindentNestedSyntaxNode(node)));
  // add trailing `cmd --arg`, `cmd $argv`, `func $argv` examples
  const scopeCommand = symbol.scope.scopeNode?.type === 'program'
    ? `${uriToReadablePath(uri)}`
    : `${symbol.scope.scopeNode?.firstNamedChild?.text}` || `${symbol.node}`;
  if (fishKind === 'ARGPARSE') {
    const argumentNamesOption = symbol.name.slice('_flag_'.length).replace(/_/g, '-');
    if (argumentNamesOption.length > 1) {
      description.push(md.separator());
      description.push(md.codeBlock('fish', `${scopeCommand} --${argumentNamesOption}`));
    } else if (argumentNamesOption.length === 1) {
      description.push(md.separator());
      description.push(md.codeBlock('fish', `${scopeCommand} -${argumentNamesOption}`));
    }
  } else if (name === 'argv') {
    description.push(md.separator());
    description.push(md.codeBlock('fish', `${scopeCommand} $argv`));
  } else if (node.type === 'function_definition') {
    const children = findFunctionDefinitionChildren(node);
    const resultFlags: string[] = [];
    findOptions(children, FunctionOptions).found
      .filter(flag => flag.option.isOption('-a', '--argument-names'))
      .forEach((flag, idx) => {
        if (flag.value.text === name) resultFlags.push(flag.value.text);
        else resultFlags.push(`\$argv[${idx + 1}]`);
      });

    if (resultFlags.length) {
      description.push(md.separator());
      description.push(md.codeBlock('fish', `${scopeCommand} ${resultFlags.join(' ')}`));
    }
  }

  return description.join(md.newline());
}

export function createDetail(symbol: FishSymbol) {
  if (symbol.fishKind === 'EXPORT') return symbol.detail.toString();

  const symbolKind = getSymbolKind(symbol);
  if (symbolKind === '') return symbol.detail;

  if (symbolKind === 'function') {
    return buildFunctionDetail(symbol);
  }

  if (symbolKind === 'variable') {
    return buildVariableDetail(symbol);
  }
  return symbol.detail.toString();
}
