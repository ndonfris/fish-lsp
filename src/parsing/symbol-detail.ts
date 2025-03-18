import { SymbolKind } from 'vscode-languageserver';
import { FishSymbol, fishSymbolKindToSymbolKind } from './symbol';
import { md } from '../utils/markdown-builder';
import { findOptions } from './options';
import { findFunctionDefinitionChildren, FunctionOptions } from './function';
import { isString } from '../utils/node-types';
import { uriToReadablePath } from '../utils/translation';
import { PrebuiltDocumentationMap } from '../utils/snippets';
import { setModifierDetailDescriptor, SetModifiers } from './set';
import { SyntaxNode } from 'web-tree-sitter';
import { FishAlias } from '../utils/alias-helpers';

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

  if (symbol.isGlobal()) {
    description.push(`${md.italic('scope')}: ${md.bold('global')}`);
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
  if (node.type !== 'function_definition') return '';
  const children = findFunctionDefinitionChildren(node);
  // const resultFlags: string[] = [];
  const index = findOptions(children, FunctionOptions).found
    .filter(flag => flag.option.isOption('-a', '--argument-names'))
    .findIndex((flag) => flag.value.text === name);
  const argvStr = '$argv[' + (index + 1) + ']';
  return `${md.italic('named argument')}: ${md.inlineCode(argvStr)}`;
  // .forEach((flag, idx) => {
  //   if (flag.value.text === name) resultFlags.push(flag.value.text);
  //   else resultFlags.push(`\$argv[${idx + 1}]`);
  // });
  // return resultFlags.join(' ');
}

function buildVariableDetail(symbol: FishSymbol) {
  const { name, node, uri, fishKind } = symbol;
  const description = [`(${md.bold('variable')}) ${md.inlineCode(name)}`];

  if (fishKind === 'SET' || fishKind === 'READ') {
    const options = findOptions(node.childrenForFieldName('argument'), SetModifiers);
    const modifier = options.found.find(o => o.option.equalsRawOption('-U', '-g', '-f', '-l'));
    if (modifier) {
      description.push(setModifierDetailDescriptor(node));
    }
  } else if (fishKind === 'ARGPARSE') {
    description.push(`${md.italic('scope')}: ${md.bold('local')}`);
  } else if (isVariableArgumentNamed(node, name)) {
    description.push(getArgumentNamesIndexString(node, name));
  }

  description.push(`located in file: ${md.inlineCode(uriToReadablePath(uri))}`);

  const prebuilt = PrebuiltDocumentationMap.getByType('variable').find(c => c.name === name);
  if (prebuilt) {
    description.push(md.separator());
    description.push(prebuilt.description);
  }
  description.push(md.separator());

  description.push(md.codeBlock('fish', unindentNestedSyntaxNode(node)));
  const scopeCommand = symbol.scope.scopeNode.type === 'program'
    ? `${uriToReadablePath(uri)}`
    : `${symbol.scope.scopeNode.firstNamedChild!.text}`;
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
