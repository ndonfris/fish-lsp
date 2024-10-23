import { SyntaxNode, Tree } from 'web-tree-sitter';
import { isOption, isMatchingOption, isEndStdinCharacter, isString } from '../utils/node-types';
import { Range } from 'vscode-languageserver';
import * as Locations from '../utils/locations';
// import { isArgparseCommandName } from '../features/definitions/argparse';
// import { FishDocumentSymbol } from '../utils/symbol';
// import { findFirstParent } from '../utils/tree-sitter';

export interface Sym {
  name: string;
  kind: string;
  node: SyntaxNode;
  parent: SyntaxNode | null;
  range: Range;
  selectionRange: Range;
  children: Sym[];
}

export namespace Sym {
  export function create(
    kind: string,
    name: string,
    node: SyntaxNode,
    parent: SyntaxNode | null = null,
  ): Sym {
    return {
      name,
      kind,
      node,
      parent,
      range: parent ? Locations.Range.fromNode(parent) : Locations.Range.fromNode(node),
      selectionRange: Locations.Range.fromNode(node),
      children: [],
    };
  }
}

export function processSetCommand(node: SyntaxNode) {
  const focused = node.childrenForFieldName('argument')!.find(n => !isOption(n))!;
  return Sym.create('variable', focused?.text, focused, node);
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

export function processReadCommand(node: SyntaxNode): Sym[] {
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
    results.push(Sym.create('variable', arg.text, arg, node));
  });

  return results;
}

export function processArgparseCommand(node: SyntaxNode): Sym[] {
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
          n,
          node,
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
export function processFunctionArgumentVariables(node: SyntaxNode) {
  const focused = node.childrenForFieldName('option');
  const result: Sym[] = [Sym.create('variable', 'argv', node)];

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
          result.push(Sym.create('variable', arg.text, arg, node));
          break;
        default:
          break;
      }
      continue;
    }
  }
  return result;
}

export function processTree(tree: Tree) {
  const results: Sym[] = [];
  const focusedNodes = tree.rootNode.descendantsOfType(['program', 'function_definition', 'command', 'for_loop']);

  for (const node of focusedNodes) {
    const firstNamedChild = node.firstNamedChild as SyntaxNode;
    switch (node.type) {
      case 'function_definition':
        results.push(Sym.create('function', firstNamedChild.text, node));
        results.push(...processFunctionArgumentVariables(node));
        break;
      case 'command':
        switch (firstNamedChild.text) {
          case 'set':
            results.push(processSetCommand(node));
            break;
          case 'read':
            results.push(...processReadCommand(node));
            break;
          case 'argparse':
            results.push(...processArgparseCommand(node));
            break;
          default:
            // results.push(Sym.create('command', node.text, node));
            break;
        }
        break;
      case 'program':
        results.push(Sym.create('program', 'ROOT', node));
        break;
    }
  }

  return results;
}
