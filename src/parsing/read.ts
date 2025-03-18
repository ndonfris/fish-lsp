import { SyntaxNode } from 'web-tree-sitter';
import { Option, isMatchingOption, findMatchingOptions } from './options';
import { isOption, isCommandWithName, isString, isTopLevelDefinition } from '../utils/node-types';
import { FishSymbol, SetModifierToScopeTag } from './symbol';
import { LspDocument } from '../document';
import { DefinitionScope } from '../utils/definition-scope';

export const ReadOptions = [
  Option.create('-U', '--universal'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
  Option.create('-g', '--global'),
  Option.create('-u', '--unexport'),
  Option.create('-x', '--export'),
  Option.create('-c', '--command').withValue(),
  Option.create('-s', '--silent'),
  Option.create('-p', '--prompt').withValue(),
  Option.create('-P', '--prompt-str').withValue(),
  Option.create('-R', '--right-prompt').withValue(),
  Option.create('-S', '--shell'),
  Option.create('-d', '--delimiter').withValue(),
  Option.create('-n', '--nchars').withValue(),
  Option.create('-t', '--tokenize'),
  Option.create('-a', '--list').withAliases('--array'),
  Option.create('-z', '--null'),
  Option.create('-L', '--line'),
  Option.create('-h', '--help'),
];

export const ReadModifiers = [
  Option.create('-U', '--universal'),
  Option.create('-f', '--function'),
  Option.create('-l', '--local'),
  Option.create('-g', '--global'),
];

export function isReadDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'read') && !node.children.some(child => isMatchingOption(child, Option.create('-q', '--query')));
}

function getFallbackModifierScope(document: LspDocument, node: SyntaxNode) {
  const autoloadType = document.getAutoloadType();
  switch (autoloadType) {
    case 'conf.d':
    case 'config':
      return isTopLevelDefinition(node) ? 'global' : 'local';
    case 'functions':
    default:
      return 'local';
  }
}

export function processReadCommand(document: LspDocument, node: SyntaxNode, children: FishSymbol[] = []) {
  let modifier: Option | undefined = undefined;
  const definitionNodes: SyntaxNode[] = [];
  const allFocused: SyntaxNode[] = node.childrenForFieldName('argument')
    .filter((n) => {
      switch (true) {
        case isMatchingOption(n, Option.create('-l', '--local')):
        case isMatchingOption(n, Option.create('-f', '--function')):
        case isMatchingOption(n, Option.create('-g', '--global')):
        case isMatchingOption(n, Option.create('-U', '--universal')):
          modifier = findMatchingOptions(n, ...ReadModifiers);
          return false;
        case isMatchingOption(n, Option.create('-c', '--command')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-d', '--delimiter')):
        case isMatchingOption(n, Option.create('-d', '--delimiter')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-n', '--nchars')):
        case isMatchingOption(n, Option.create('-n', '--nchars')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-p', '--prompt')):
        case isMatchingOption(n, Option.create('-p', '--prompt')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-P', '--prompt-str')):
        case isMatchingOption(n, Option.create('-P', '--prompt-str')):
          return false;
        case isMatchingOption(n.previousSibling!, Option.create('-R', '--right-prompt')):
        case isMatchingOption(n, Option.create('-R', '--right-prompt')):
          return false;
        case isMatchingOption(n, Option.create('-s', '--silent')):
        case isMatchingOption(n, Option.create('-S', '--shell')):
        case isMatchingOption(n, Option.create('-t', '--tokenize')):
        case isMatchingOption(n, Option.create('-u', '--unexport')):
        case isMatchingOption(n, Option.create('-x', '--export')):
        case isMatchingOption(n, Option.create('-a', '--list')):
        case isMatchingOption(n, Option.create('-z', '--null')):
        case isMatchingOption(n, Option.create('-L', '--line')):
          return false;
        default:
          return true;
      }
    });

  allFocused.forEach((arg) => {
    if (isOption(arg)) return;
    if (isString(arg)) return;
    definitionNodes.push(arg);
  });

  const result: FishSymbol[] = [];
  const scopeModifier = modifier ? SetModifierToScopeTag(modifier) : getFallbackModifierScope(document, node);

  for (const arg of definitionNodes) {
    result.push(FishSymbol.create(arg.text, node, arg, 'READ', document.uri, node.text, DefinitionScope.create(node, scopeModifier), children));
  }

  return result;
}
