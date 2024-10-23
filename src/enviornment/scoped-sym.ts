import { SyntaxNode, Tree } from 'web-tree-sitter';
import { isOption, isMatchingOption, isEndStdinCharacter, isString, Option } from '../utils/node-types';
import { Range } from 'vscode-languageserver';
import * as Locations from '../utils/locations';
// import { isArgparseCommandName } from '../features/definitions/argparse';
// import { FishDocumentSymbol } from '../utils/symbol';
// import { findFirstParent } from '../utils/tree-sitter';

export interface Sym {
  name: string;
  kind: string;
  uri: string;
  node: SyntaxNode;
  parent: SyntaxNode | null;
  range: Range;
  selectionRange: Range;
  parentSym: Sym | null;
  modifier: 'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL';
  children: Sym[];
}

export namespace Sym {
  export function create(
    kind: string,
    name: string,
    modifier: 'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL',
    node: SyntaxNode,
    parent: SyntaxNode | null = null,
    parentSym: Sym | null = null,
  ): Sym {
    return {
      name,
      kind,
      uri: '',
      modifier,
      node,
      parent,
      range: parent ? Locations.Range.fromNode(parent) : Locations.Range.fromNode(node),
      selectionRange: Locations.Range.fromNode(node),
      parentSym,
      children: [],
    };
  }
}

function isModifier(node: SyntaxNode): boolean {
  switch (true) {
    case isMatchingOption(node, Option.create('-l', '--local')):
    case isMatchingOption(node, Option.create('-f', '--function')):
    case isMatchingOption(node, Option.create('-g', '--global')):
    case isMatchingOption(node, Option.create('-U', '--universal')):
      return true;
    default:
      return false;
  }
}

function hasModifier(nodes: SyntaxNode[]): boolean {
  return nodes.some(n => isModifier(n));
}

function getModifier(nodes: SyntaxNode[]) {
  for (const node of nodes) {
    switch (true) {
      case isMatchingOption(node, Option.create('-l', '--local')):
        return 'LOCAL';
      case isMatchingOption(node, Option.create('-f', '--function')):
        return 'FUNCTION';
      case isMatchingOption(node, Option.create('-g', '--global')):
        return 'GLOBAL';
      case isMatchingOption(node, Option.create('-U', '--universal')):
        return 'UNIVERSAL';
    }
  }
  return 'FUNCTION';
}

function processSetCommand(node: SyntaxNode, parentSym: Sym): Sym {
  const focused = node.childrenForFieldName('argument')!.find(n => !isOption(n))!;
  const modifier = getModifier(node.childrenForFieldName('argument'));
  return Sym.create('variable', focused?.text, modifier, focused, node, parentSym);
}

class ReadScope {
  public localVariables: SyntaxNode[] = [];
  public functionVariables: SyntaxNode[] = [];
  public globalVariables: SyntaxNode[] = [];
  public universalVariables: SyntaxNode[] = [];
  public currentModifier: 'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL' = 'LOCAL';

  public addVariable(node: SyntaxNode) {
    switch (this.currentModifier) {
      case 'LOCAL':
        this.localVariables.push(node);
        break;
      case 'FUNCTION':
        this.functionVariables.push(node);
        break;
      case 'GLOBAL':
        this.globalVariables.push(node);
        break;
      case 'UNIVERSAL':
        this.universalVariables.push(node);
        break;
    }
  }

  public setModifier(node: SyntaxNode) {
    switch (true) {
      case isMatchingOption(node, { shortOption: '-l', longOption: '--local' }):
        this.currentModifier = 'LOCAL';
        break;
      case isMatchingOption(node, { shortOption: '-f', longOption: '--function' }):
        this.currentModifier = 'FUNCTION';
        break;
      case isMatchingOption(node, { shortOption: '-g', longOption: '--global' }):
        this.currentModifier = 'GLOBAL';
        break;
      case isMatchingOption(node, { shortOption: '-U', longOption: '--universal' }):
        this.currentModifier = 'UNIVERSAL';
        break;
      default:
        break;
    }
  }

  public contains(node: SyntaxNode) {
    const doesContain = (nodes: SyntaxNode[]) => nodes.some((n) => n.equals(node));
    return (
      doesContain(this.localVariables) ||
      doesContain(this.functionVariables) ||
      doesContain(this.globalVariables) ||
      doesContain(this.universalVariables)
    );
  }
}

function processReadCommand(node: SyntaxNode, parentSym: Sym): Sym[] {
  const readScope = new ReadScope();

  const allFocused: SyntaxNode[] = node.childrenForFieldName('argument')
    .filter((n) => {
      switch (true) {
        case isMatchingOption(n, { shortOption: '-l', longOption: '--local' }):
        case isMatchingOption(n, { shortOption: '-f', longOption: '--function' }):
        case isMatchingOption(n, { shortOption: '-g', longOption: '--global' }):
        case isMatchingOption(n, { shortOption: '-U', longOption: '--universal' }):
          readScope.setModifier(n);
          return false;
        case isMatchingOption(n, { shortOption: '-c', longOption: '--command' }):
          return false;
        case isMatchingOption(n.previousSibling!, { shortOption: '-d', longOption: '--delimiter' }):
        case isMatchingOption(n, { shortOption: '-d', longOption: '--delimiter' }):
          return false;
        case isMatchingOption(n.previousSibling!, { shortOption: '-n', longOption: '--nchars' }):
        case isMatchingOption(n, { shortOption: '-n', longOption: '--nchars' }):
          return false;
        case isMatchingOption(n.previousSibling!, { shortOption: '-p', longOption: '--prompt' }):
        case isMatchingOption(n, { shortOption: '-p', longOption: '--prompt' }):
          return false;
        case isMatchingOption(n.previousSibling!, { shortOption: '-P', longOption: '--prompt-str' }):
        case isMatchingOption(n, { shortOption: '-P', longOption: '--prompt-str' }):
          return false;
        case isMatchingOption(n.previousSibling!, { shortOption: '-R', longOption: '--right-prompt' }):
        case isMatchingOption(n, { shortOption: '-R', longOption: '--right-prompt' }):
          return false;
        case isMatchingOption(n, { shortOption: '-s', longOption: '--silent' }):
        case isMatchingOption(n, { shortOption: '-S', longOption: '--shell' }):
        case isMatchingOption(n, { shortOption: '-t', longOption: '--tokenize' }):
        case isMatchingOption(n, { shortOption: '-u', longOption: '--unexport' }):
        case isMatchingOption(n, { shortOption: '-x', longOption: '--export' }):
        case isMatchingOption(n, { shortOption: '-a', longOption: '--list' }):
        case isMatchingOption(n, { shortOption: '-z', longOption: '--null' }):
        case isMatchingOption(n, { shortOption: '-L', longOption: '--line' }):
          return false;
        default:
          return true;
      }
    });

  const results: Sym[] = [];

  allFocused.forEach((arg) => {
    if (isOption(arg)) return;
    if (isString(arg)) return;

    readScope.addVariable(arg);
    results.push(Sym.create('variable', arg.text, readScope.currentModifier, arg, node, parentSym));
  });

  return results;
}

function processArgparseCommand(node: SyntaxNode, parentSym: Sym): Sym[] {
  // split the `h/help` into `h` and `help`
  function splitSlash(str: string): string[] {
    const results = str.split('/')
      .map(s => s.trim().replace(/-/g, '_'));

    const maxResults = results.length < 2 ? results.length : 2;
    return results.slice(0, maxResults);
  }

  // store the results
  const result: Sym[] = [];

  // find the `--` end token
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return [];

  // find the parent function or program
  // find all flags before the `--` end token
  const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;

  node.childrenForFieldName('argument')
    .filter(n => !isOption(n) && isBefore(n, endChar))
    .forEach((n: SyntaxNode) => {
      let flagNames = n?.text;
      if (isString(n)) {
        flagNames = n?.text.slice(1, -1).split('=').shift() || '';
      }
      const seenFlags = splitSlash(flagNames);

      // add all seenFlags to the `result: Symb[]` array
      const flags = seenFlags.map(flagName => {
        return Sym.create(
          'variable',
          `_flag_${flagName}`,
          'FUNCTION', // TODO: this should be 'LOCAL' or 'FUNCTION' based on the parent function
          n,
          node,
          parentSym,
        );
      });
      result.push(...flags);
    });

  return result;
}

/**
 * process a function definition node and return all the variables that are defined in
 * the function header's arguments
 *
 * ---
 *
 * INPUT:
 * ```fish
 * function foo -a a b c d e; end;
 * ```
 *
 * OUTPUT: (array of Sym objects, Sym.name is used to truncate the output below)
 * ```typescript
 * ['argv', 'a', 'b', 'c', 'd', 'e']
 * ```
 *
 * ---
 *
 * @param node the function definition node
 * @returns an array of Sym objects
 */
function processFunctionArgumentVariables(node: SyntaxNode): Sym[] {
  const focused = node.childrenForFieldName('option');
  // const firstNamed = node.firstNamedChild as SyntaxNode;
  const result: Sym[] = [Sym.create('variable', 'argv', 'FUNCTION', node, node)];

  if (!focused) return result;

  let mostRecentFlag: SyntaxNode | null = null;
  for (const arg of focused) {
    if (isOption(arg)) {
      mostRecentFlag = arg;
      continue;
    }
    if (mostRecentFlag && !isOption(arg)) {
      switch (true) {
        case isMatchingOption(mostRecentFlag, { shortOption: '-a', longOption: '--argument-names' }):
        case isMatchingOption(mostRecentFlag, { shortOption: '-V', longOption: '--inherit-variable' }):
        case isMatchingOption(mostRecentFlag, { shortOption: '-v', longOption: '--on-variable' }):
          result.push(Sym.create('variable', arg.text, 'FUNCTION', arg, node));
          break;
        default:
          break;
      }
      continue;
    }
  }
  return result;
}

function shouldCreateSym(current: SyntaxNode): boolean {
  const firstNamedChild = current.firstNamedChild;
  if (!firstNamedChild) return false;
  switch (current.type) {
    case 'command':
      switch (firstNamedChild.text) {
        case 'set':
        case 'read':
        case 'argparse':
          return true;
        default:
          return false;
      }
    case 'function_definition':
      return true;
    default:
      return false;
  }
}

function processFunction(node: SyntaxNode, children: Sym[], parentSym: Sym): Sym {
  const firstNamedChild = node.firstNamedChild as SyntaxNode;
  const funcSymbol = Sym.create('function', firstNamedChild.text, 'FUNCTION', firstNamedChild, node, parentSym);
  funcSymbol.children.push(...processFunctionArgumentVariables(node), ...children);
  funcSymbol.children.forEach(child => child.parentSym = funcSymbol);
  return funcSymbol;
}

function createSym(current: SyntaxNode, childrenSymbols: Sym[], parentSym: Sym): Sym[] {
  const firstNamedChild = current.firstNamedChild;
  switch (current.type) {
    case 'command':
      switch (firstNamedChild?.text) {
        case 'set':
          return [processSetCommand(current, parentSym)];
        case 'read':
          return processReadCommand(current, parentSym);
        case 'argparse':
          return processArgparseCommand(current, parentSym);
        default:
          return [];
      }
    case 'function_definition':
      return [processFunction(current, childrenSymbols, parentSym)];
    default:
      return [];
  }
}

// ../../test-data/scoped-sym.test.ts
// ../utils/symbol.ts<-option -sa terminal-overrides ',alacritty:RGB'>
// scope description: https://github.com/fish-shell/fish-shell/pull/8145#pullrequestreview-715292911
export function buildScopedSym(root: SyntaxNode) {
  const rootSym = Sym.create('root', 'root', 'LOCAL', root, root);
  function buildSyms(...nodes: SyntaxNode[]): Sym[] {
    const symbols: Sym[] = [];
    for (const current of nodes) {
      const children = buildSyms(...current.children);
      const shouldCreate = shouldCreateSym(current);
      if (shouldCreate) {
        const newSyms = createSym(current, children, rootSym);
        symbols.push(...newSyms);
        continue;
      }
      symbols.push(...children);
    }
    return symbols;
  }

  return buildSyms(root);
}

export function logSyms(syms: Sym[], indent: string = '') {
  const symbolKindStr = (s: Sym | null) => s === null || s.kind === 'root' ? '' : s.kind === 'variable' ? '' : 'ƒ';
  const getNameKindStr = (s: Sym | null) => `${symbolKindStr(s)} ${s?.name.trim() || 'root'}`;
  const getNodeStr = (n: SyntaxNode | null) => `${n?.type || 'null'} | ${n?.text.split('\n').at(0)?.slice(0, 15) || 'null'}`;
  for (const s of syms) {
    const strMain = new String(indent + getNameKindStr(s)).padEnd(25);
    const strParent = getNameKindStr(s.parentSym).padEnd(15);
    const modifier = s.modifier.padEnd(10);
    const strRange = Locations.Range.toString(s.range).padEnd(15, ' ') + Locations.Range.toString(s.selectionRange).padEnd(15);
    const strNode = getNodeStr(s.node).padEnd(40, '.');
    const strParentNode = getNodeStr(s.parent).padEnd(15);
    // eslint-disable-next-line no-console
    console.log(strMain + strParent + modifier + strRange + strNode + strParentNode);
    logSyms(s.children, indent + ' '.repeat(4));
  }
}
