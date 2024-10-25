import * as LSP from 'vscode-languageserver';
import { SymbolKind, Range, Location } from 'vscode-languageserver';
import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { setLogger } from './logger-setup';
import { initializeParser } from '../src/parser';
import { isBlock, isEndStdinCharacter, isEscapeSequence, isMatchingOption, isOption, isString, isType, NodeOptionQueryText, Option } from '../src/utils/node-types';
import * as Locations from '../src/utils/locations';
import { findParent, getBlockDepth, uniqueNodes } from '../src/utils/tree-sitter';
import { flattenNested } from '../src/utils/flatten';
import { getCallableRanges, getCallableRanges2, rangesToNodes, removeRange } from './scope';
// import { Hash } from 'crypto';

type HashSyntaxNodeKey = `${LSP.DocumentUri} ${SyntaxNode['id']} ${string}`;
const HashSyntaxNode = (uri: LSP.DocumentUri, parentNode: SyntaxNode, node: SyntaxNode): HashSyntaxNodeKey => `${uri} ${parentNode.id} ${node.text}`;
export type ModifierType = 'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL';

type ModifierCallbackFn = (symbol: FishSymbol) => SyntaxNode;

const ModifierParentNode: Record<ModifierType, ModifierCallbackFn> = {
  ['LOCAL']: (symbol: FishSymbol) => findParent(symbol.node, isBlock),
  ['FUNCTION']: (symbol: FishSymbol) => findParent(symbol.parentNode, (n) => isType(n, 'function_definition', 'program')),
  ['GLOBAL']: (symbol: FishSymbol) => findParent(symbol.parentNode, (n) => isType(n, 'program')),
  ['UNIVERSAL']: (symbol: FishSymbol) => findParent(symbol.parentNode, (n) => isType(n, 'program')),
} as const;

export type FunctionInfo = {
  name: string;
  uri: string;
  description: string;
  isAutoLoad: boolean;
  noScopeShadowing: boolean;
  argumentNames: FishSymbol[];
  inheritVariable: FishSymbol[];
  onVariable: FishSymbol[];
};

export class FishSymbol {
  constructor(
    public name: string,
    public kind: SymbolKind,
    public uri: string,
    public selectionRange: Range,
    public range: Range,
    public modifier: ModifierType,
    public node: SyntaxNode,
    public parentNode: SyntaxNode | null = null,
    public parent: FishSymbol | null = null,
    public children: FishSymbol[] = [],
  ) { }

  public static create(
    name: string,
    kind: SymbolKind,
    uri: string,
    modifier: ModifierType,
    node: SyntaxNode,
    parentNode: SyntaxNode | null = null,
    parent: FishSymbol | null = null,
    children: FishSymbol[] = [],
  ) {
    return new FishSymbol(
      name,
      kind,
      uri,
      Locations.Range.fromNode(node),
      Locations.Range.fromNode(parentNode),
      modifier,
      node,
      parentNode,
      parent,
      children,
    );
  }

  toLocation(): LSP.Location {
    return Location.create(this.uri, this.selectionRange);
  }

  toFoldingRange(): LSP.FoldingRange {
    return {
      startLine: this.range.start.line,
      endLine: this.range.end.line,
      collapsedText: this.name,
    };
  }

  toWorkspaceSymbol(): LSP.WorkspaceSymbol {
    return {
      name: this.name,
      kind: this.kind,
      location: this.toLocation(),
    };
  }

  equals(other: FishSymbol): boolean {
    return this.name === other.name
      && this.kind === other.kind
      && this.uri === other.uri
      && this.range.start.line === other.range.start.line
      && this.range.start.character === other.range.start.character
      && this.range.end.line === other.range.end.line
      && this.range.end.character === other.range.end.character
      && this.selectionRange.start.line === other.selectionRange.start.line
      && this.selectionRange.start.character === other.selectionRange.start.character
      && this.selectionRange.end.line === other.selectionRange.end.line
      && this.selectionRange.end.character === other.selectionRange.end.character
      && this.node.equals(other.node)
      && (!!this.parentNode && !!other.parentNode && this.parentNode.equals(other.parentNode))
      && this.modifier === other.modifier
      && this.children.length === other.children.length;
  }

  symbolIsNode(node: SyntaxNode) {
    return this.node.equals(node);
  }

  findChildSymbolFromNode(node: SyntaxNode): FishSymbol | null {
    return this.children.find(child => child.symbolIsNode(node)) || null;
  }

  isFunction() {
    return this.kind === SymbolKind.Function;
  }

  isVariable() {
    return this.kind === SymbolKind.Variable;
  }

  getParentScope() {
    return ModifierParentNode[this.modifier](this);
  }

  get allChildren() {
    return flattenNested(...this.children);
  }

  getCallableRange() {
    // const ranges: Range[] = [];
    // if (this.isFunction()) {
    //   const parent = this.getParentScope();
    // }
    // const scopeNode = this.getParentScope();
    // const parent = this.parent;
    //
    // if (parent)
    //
    //   if (this.isVariable() && scopeNode) {
    //   } else if (this.isFunction() && scopeNode) {
    //
    //   }
    return;
  }

  get functionInfo() {
    if (!this.isFunction()) return null;

    const functionInfo = FunctionInfo.create(this);
    const args = this.parentNode?.childrenForFieldName('option');
    let mostRecentFlag: SyntaxNode | null = null;
    for (const arg of args) {
      if (isEscapeSequence(arg)) continue;

      /* handle special option -S/--no-scope-shadowing */
      if (isMatchingOption(arg, Option.create('-S', '--no-scope-shadowing'))) {
        functionInfo.noScopeShadowing = true;
        continue;
      }

      /* set the mostRecentFlag and skip to next loop */
      if (isOption(arg)) {
        mostRecentFlag = arg;
        continue;
      }

      /* check if the previous mostRecentFlag is a functionInfo modifier */
      if (mostRecentFlag && !isOption(arg)) {
        switch (true) {
          case isMatchingOption(mostRecentFlag, { shortOption: '-a', longOption: '--argument-names' }):
            functionInfo.argumentNames.push(this.findChildSymbolFromNode(arg));
            break;
          case isMatchingOption(mostRecentFlag, { shortOption: '-V', longOption: '--inherit-variable' }):
            functionInfo.inheritVariable.push(this.findChildSymbolFromNode(arg));
            break;
          case isMatchingOption(mostRecentFlag, { shortOption: '-v', longOption: '--on-variable' }):
            functionInfo.inheritVariable.push(this.findChildSymbolFromNode(arg));
            break;
          case isMatchingOption(mostRecentFlag, { shortOption: '-d', longOption: '--description' }):
            functionInfo.description = arg.text;
            break;
          default:
            break;
        }
        continue;
      }
    }
    /* add autoloaded from the modifier */
    functionInfo.isAutoLoad = this.modifier === 'GLOBAL';
    return functionInfo;
  }
}

export namespace FunctionInfo {
  export function create(symbol: FishSymbol): FunctionInfo {
    return {
      name: symbol.name,
      uri: symbol.uri,
      description: '',
      isAutoLoad: false,
      noScopeShadowing: false,
      argumentNames: [],
      inheritVariable: [],
      onVariable: [],
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

type SymbolType = typeof SymbolKind.Function | typeof SymbolKind.Variable;

function toModifier(node: SyntaxNode, uri: string, kind: SymbolType): ModifierType {
  const uriModifier = uri.split('/');
  const [pathname, filename]: [string, string] = [
    uriModifier.at(-2),
    uriModifier.at(-1).split('.').shift(),
  ];
  const depth = getBlockDepth(node);
  if (kind === SymbolKind.Function) {
    const firstNamed = node.firstNamedChild;
    if (!firstNamed) return 'FUNCTION';
    switch (true) {
      case pathname === 'functions' && firstNamed.text === filename && depth < 1:
        return 'GLOBAL';
      case pathname === 'conf.d' && depth < 1:
      case pathname === 'fish' && filename === 'config' && depth < 1:
        return 'GLOBAL';
      default:
        return 'FUNCTION';
    }
  }
  if (kind === SymbolKind.Variable) {
    if (node.type === 'for_statement') {
      return node.parent?.type === 'function_definition' ? 'FUNCTION' : 'LOCAL';
    }
    const focused = node.childrenForFieldName('argument')
      .find((n) => isModifier(n));
    switch (true) {
      case isMatchingOption(focused, Option.create('-l', '--local')):
        return 'LOCAL';
      case isMatchingOption(focused, Option.create('-f', '--function')):
        return 'FUNCTION';
      case isMatchingOption(focused, Option.create('-g', '--global')):
        return 'GLOBAL';
      case isMatchingOption(focused, Option.create('-U', '--universal')):
        return 'UNIVERSAL';
      case pathname === 'conf.d' && depth < 1:
      case pathname === 'fish' && filename === 'config' && depth < 1:
        return 'GLOBAL';
      default:
        return depth < 1 ? 'LOCAL' : 'FUNCTION';
    }
  }
}

function isMatchingOptionOrOptionValue(node: SyntaxNode, option: NodeOptionQueryText): boolean {
  if (isMatchingOption(node, option)) {
    return true;
  }
  const prevNode = node.previousNamedSibling;
  if (prevNode?.text.includes('=')) {
    return false;
  }
  if (isMatchingOption(prevNode, option) && !isOption(node)) {
    return true;
  }
  return false;
}

function processReadCommand(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  let modifier: ModifierType = toModifier(node, uri, SymbolKind.Variable);
  const allFocused: SyntaxNode[] = node.childrenForFieldName('argument')
    .filter((n) => {
      switch (true) {
        case isEscapeSequence(n):
          return false;
        case isMatchingOption(n, Option.create('-l', '--local')):
          modifier = 'LOCAL';
          return false;
        case isMatchingOption(n, Option.create('-f', '--function')):
          modifier = 'FUNCTION';
          return false;
        case isMatchingOption(n, Option.create('-g', '--global')):
          modifier = 'GLOBAL';
          return false;
        case isMatchingOption(n, Option.create('-U', '--universal')):
          modifier = 'UNIVERSAL';
          return false;
        case isMatchingOptionOrOptionValue(n, Option.create('-c', '--command')):
        case isMatchingOptionOrOptionValue(n, Option.create('-d', '--delimiter')):
        case isMatchingOptionOrOptionValue(n, Option.create('-n', '--nchars')):
        case isMatchingOptionOrOptionValue(n, Option.create('-p', '--prompt')):
        case isMatchingOptionOrOptionValue(n, Option.create('-P', '--prompt-str')):
        case isMatchingOptionOrOptionValue(n, Option.create('-R', '--right-prompt')):
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

  const results: FishSymbol[] = [];

  allFocused.forEach((arg) => {
    if (isEscapeSequence(arg)) return;
    if (isOption(arg)) return;
    if (isString(arg)) return;

    results.push(
      FishSymbol.create(arg.text, SymbolKind.Variable, uri, modifier, arg, node, parentSymbol),
    );
  });

  return results;
}

function processSetCommand(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const focused = node.childrenForFieldName('argument').find(n => !isOption(n));
  const skip = node.childrenForFieldName('argument')
    .find(n => isMatchingOption(n, Option.create('-q', '--query')));

  if (!focused || skip) return [];

  const modifier = toModifier(node, uri, SymbolKind.Variable);

  return [
    FishSymbol.create(focused.text, SymbolKind.Variable, uri, modifier, focused, node, parentSymbol),
  ];
}

function processForCommand(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const focused = node.firstNamedChild;
  if (!focused) return [];

  const modifier = toModifier(node, uri, SymbolKind.Variable);
  // const modifier = toModifier(focused, uri, SymbolKind.Variable);
  return [
    FishSymbol.create(focused.text, SymbolKind.Variable, uri, modifier, focused, node, parentSymbol),
  ];
}

function processArgparseCommand(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const modifier = toModifier(node, uri, SymbolKind.Variable);

  // split the `h/help` into `h` and `help`
  function splitSlash(str: string): string[] {
    const results = str.split('/')
      .map(s => s.trim().replace(/-/g, '_'));

    const maxResults = results.length < 2 ? results.length : 2;
    return results.slice(0, maxResults);
  }

  // store the results
  const result: FishSymbol[] = [];

  // find the `--` end token
  const endChar = node.children.find(node => isEndStdinCharacter(node));
  if (!endChar) return [];

  // find the parent function or program
  // find all flags before the `--` end token
  const isBefore = (a: SyntaxNode, b: SyntaxNode) => a.startIndex < b.startIndex;

  node.childrenForFieldName('argument')
    .filter(n => !isEscapeSequence(n) && !isOption(n) && isBefore(n, endChar))
    .forEach((n: SyntaxNode) => {
      let flagNames = n?.text;
      if (isString(n)) {
        flagNames = n?.text.slice(1, -1).split('=').shift() || '';
      }
      const seenFlags = splitSlash(flagNames);

      // add all seenFlags to the `result: Symb[]` array
      const flags = seenFlags.map(flagName => {
        return FishSymbol.create(
          `_flag_${flagName}`,
          SymbolKind.Variable,
          uri,
          //'FUNCTION', // TODO: this should be 'LOCAL' or 'FUNCTION' based on the parent function
          modifier,
          n,
          node,
          parentSymbol,
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
function processFunctionArgumentVariables(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const focused = node.childrenForFieldName('option');
  // const firstNamed = node.firstNamedChild as SyntaxNode;
  const result: FishSymbol[] = [
    FishSymbol.create('argv', SymbolKind.Variable, uri, 'FUNCTION', node, node, parentSymbol),
  ];

  if (!focused) return result;

  let mostRecentFlag: SyntaxNode | null = null;
  for (const arg of focused) {
    if (isEscapeSequence(arg)) continue;
    if (isOption(arg)) {
      mostRecentFlag = arg;
      continue;
    }
    if (mostRecentFlag && !isOption(arg)) {
      switch (true) {
        case isMatchingOption(mostRecentFlag, { shortOption: '-a', longOption: '--argument-names' }):
        case isMatchingOption(mostRecentFlag, { shortOption: '-V', longOption: '--inherit-variable' }):
        case isMatchingOption(mostRecentFlag, { shortOption: '-v', longOption: '--on-variable' }):
          result.push(
            FishSymbol.create(arg.text, SymbolKind.Variable, uri, 'FUNCTION', arg, node, parentSymbol),
          );
          break;
        default:
          break;
      }
      continue;
    }
  }
  return result;
}

function processFunction(node: SyntaxNode, children: FishSymbol[], uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const firstNamedChild = node.firstNamedChild as SyntaxNode;
  const modifier = toModifier(node, uri, SymbolKind.Function);

  const funcSymbol = FishSymbol.create(firstNamedChild.text, SymbolKind.Function, uri, modifier, firstNamedChild, node, parentSymbol);
  funcSymbol.children.push(...processFunctionArgumentVariables(node, uri, funcSymbol), ...children);
  funcSymbol.children.forEach(child => child.parent = funcSymbol);
  return [funcSymbol];
}

function createRootSymbol(node: SyntaxNode, uri: string): FishSymbol {
  return FishSymbol.create('root', SymbolKind.Null, uri, 'LOCAL', node, node, null);
}

function shouldCreateSym(current: SyntaxNode): boolean {
  const firstNamedChild = current.firstNamedChild;
  if (!firstNamedChild) return false;
  switch (current.type) {
    case 'for_statement':
      return true;
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

function createSymbol(current: SyntaxNode, childrenSymbols: FishSymbol[], uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const firstNamedChild = current.firstNamedChild;
  switch (current.type) {
    case 'for_statement':
      return processForCommand(current, uri, parentSymbol);
    case 'command':
      switch (firstNamedChild?.text) {
        case 'set':
          return processSetCommand(current, uri, parentSymbol);
        case 'read':
          return processReadCommand(current, uri, parentSymbol);
        case 'argparse':
          return processArgparseCommand(current, uri, parentSymbol);
        default:
          return [];
      }
    case 'function_definition':
      return processFunction(current, childrenSymbols, uri, parentSymbol);
    default:
      return [];
  }
}

// ../../test-data/scoped-sym.test.ts
// ../utils/symbol.ts<-option -sa terminal-overrides ',alacritty:RGB'>
// scope description: https://github.com/fish-shell/fish-shell/pull/8145#pullrequestreview-715292911
export function buildScopedSymbol(root: SyntaxNode, uri: string) {
  /* create the root symbol */
  const rootSym = createRootSymbol(root, uri);

  /* create nested symbols */
  function buildSyms(...nodes: SyntaxNode[]): FishSymbol[] {
    const symbols: FishSymbol[] = [];
    for (const current of nodes) {
      const children = buildSyms(...current.children);
      const shouldCreate = shouldCreateSym(current);
      if (shouldCreate) {
        const newSyms = createSymbol(current, children, uri, rootSym);
        symbols.push(...newSyms);
        continue;
      }
      symbols.push(...children);
    }
    return symbols;
  }

  /* fix-up the root symbol w/o editing the symbols result */
  const symbols = buildSyms(root);
  rootSym.children.push(...symbols);
  return symbols;
}

export function logFishsymbols(syms: FishSymbol[], indent: string = '') {
  const symbolKindStr = (s: FishSymbol | null) => s.kind === SymbolKind.Null ? '' : s.kind === SymbolKind.Variable ? '' : 'ƒ';
  const getNameKindStr = (s: FishSymbol | null) => `${symbolKindStr(s)} ${s?.name.trim() || 'root'}`;
  const getNodeStr = (n: SyntaxNode | null) => `${n?.type || 'null'} | ${n?.text.split('\n').at(0)?.slice(0, 15) || 'null'}`;
  for (const s of syms) {
    const strMain = new String(indent + getNameKindStr(s)).padEnd(25);
    const strParent = getNameKindStr(s.parent).padEnd(15);
    const modifier = s.modifier.padEnd(10);
    const strRange = Locations.Range.toString(s.range).padEnd(15, ' ') + Locations.Range.toString(s.selectionRange).padEnd(15);
    // const strNode = getNodeStr(s.node).padEnd(40, '.');
    // const strParentNode = getNodeStr(s.parentNode).padEnd(15);
    // eslint-disable-next-line no-console
    console.log(strMain + strParent + modifier + strRange);
    // console.log(strMain + strParent + modifier + strRange + strNode + strParentNode);
    // console.log(strMain + modifier + strRange + strNode + strParentNode);
    logFishsymbols(s.children, indent + ' '.repeat(4));
  }
}

function buildUniqueMapOfSymbols(symbols: FishSymbol[]): Map<string, FishSymbol[]> {
  const resultMap: Map<string, FishSymbol[]> = new Map<string, FishSymbol[]>();
  for (const symbol of symbols) {
    const key = HashSyntaxNode(symbol.uri, symbol.getParentScope(), symbol.node);
    if (!resultMap.has(key)) resultMap.set(key, []);
    resultMap.get(key)?.push(symbol);
  }
  return resultMap;
}

describe('symbol test suite', () => {
  setLogger();

  let parser: Parser;

  beforeEach(async () => {
    parser = await initializeParser();
  });

  it('test_1', () => {
    const tree = parser.parse(`
set --local x

function foo
    argparse 'h/help' 'n/name' -- $argv
    or return

    echo inside foo: $argv
    echo inside foo: $x
    read --delimiter '=' --function read_a read_b read_c read_d read_e
    function inside_foo -a inside_foo_a inside_foo_b inside_foo_c inside_foo_d \\
        --description 'this function is inside foo' \\
        --inherit-variable read_a
        echo inside inside_foo: $argv
        echo inside_foo_a: $inside_foo_a
        echo inside_foo_b: $inside_foo_b
        echo inside_foo_c: $inside_foo_c
        echo inside_foo_d: $inside_foo_d
    end

    inside_foo $foo_a $foo_b $foo_c $foo_d

    echo foo_a: $foo_a
    echo foo_b: $foo_b
    echo foo_c: $foo_c
    echo foo_d: $foo_d
end

function bar -a bar_a bar_b bar_c bar_d
    echo inside bar: $argv
    echo bar_a: $bar_a
    echo bar_b: $bar_b
    echo bar_c: $bar_c
    echo bar_d: $bar_d
    set --local bool_1 'neither 1'
    if true 
        set --local bool_1 'true 1'
    else
        set --local bool_1 'false 1'
    end
    echo bool_1: $bool_1
    function inside_bar_with_bool_1 --inherit-variable bool_1
        echo inside_bar_with_bool_1: $bool_1
    end
    inside_bar_with_bool_1

    function inside_bar_without_bool_1
        echo inside_bar_without_bool_1: $bool_1
    end
    inside_bar_without_bool_1
end

set --global --export global_y_var 'y'
echo a==b==c | read -d == -l a b c
echo d==e==f | read --delimiter '==' --function d e f
echo g==h==i | read --delimiter='==' --array g
echo 'j k l' | read --delimiter=' ' --array z

for i in (seq 1 10)
    echo $i
end

set i (math $i + 1);

foo
`);
    expect(tree.rootNode).not.toBeNull();
    const root = tree.rootNode;
    const uri = 'file:///home/user/.config/fish/config.fish';
    const symbols = buildScopedSymbol(tree.rootNode, uri);
    logFishsymbols(symbols);

    // for (const symbol of flattenNested(...symbols)) {
    //   console.log(symbol.name);
    // }

    const inside_foo = flattenNested(...symbols).find(s => s.name === 'inside_foo');
    expect(inside_foo).not.toBeNull();
    expect(inside_foo?.functionInfo).not.toBeNull();
    expect(inside_foo?.functionInfo?.isAutoLoad).toBeFalsy();
    // console.log('printing functionInfo "inside_foo"');
    // if (inside_foo) {
    //   console.log(inside_foo.functionInfo);
    // }
    const bar = flattenNested(...symbols).find(s => s.name === 'bar');
    expect(bar).not.toBeNull();
    expect(bar?.functionInfo).not.toBeNull();
    expect(bar?.functionInfo?.isAutoLoad).toBeTruthy();
    // console.log('printing functionInfo "bar"');
    // if (bar) {
    //   console.log(bar.functionInfo);
    // }
    // const all_bools = flattenNested(...symbols).filter(s => s.name === 'bool_1');
    // const resultMap = buildUniqueMapOfSymbols(flattenNested(...symbols));
    // resultMap.forEach((value, _) => {
    //   console.log(value.at(0).name);
    // });
    // const scopes = uniqueNodes(all_bools.map(bool => bool.getParentScope()));
    const foo = flattenNested(...symbols).find(s => s.name === 'foo')!;
    // console.log('foo', foo, foo.functionInfo, { start: foo.parent.range.start, end: foo.parent.range.end });
    let i = 0;
    // get Ranges with the foo range removed
    const ranges = removeRange([foo.parent.range], foo.range);
    console.log();
    for (const r of ranges) {
      console.log(
        '"foo"',
        `range ${i}: `,
        r.start.line,
        r.start.character,
        r.end.line,
        r.end.character,
      );
      i++;
    }
    console.log();
    // loop over the ranges for Nodes
    for (const n of rangesToNodes(ranges, root)) {
      if (!n.isNamed || !n.type.trim() || !n.text.trim()) continue;
      console.log(n.type, n.text.trim());
    }
    //
    const bool = flattenNested(...symbols).find(s => s.name === 'bool_1')!;
    console.log('bool', bool.name);
    const bool_ranges = getCallableRanges2(bool);
    for (const range of bool_ranges) {
      console.log('bool_range', range.start.line, range.start.character, range.end.line, range.end.character);
    }
    // console.log('bool_ranges', bool_ranges.length);
  });

  it('process for loop', () => {
    const tree = parser.parse(`
for i in (seq 1 10)
    echo $i
end`,
    );
    const root = tree.rootNode;
    const for_loop = root.descendantsOfType('for_statement').pop();
    if (!for_loop) fail();
    // console.log(for_loop.text, for_loop.type, for_loop.toString());
    expect(for_loop).not.toBeNull();
    expect(for_loop.firstNamedChild.text).toBe('i');
    expect(for_loop.firstNamedChild.type).toBe('variable_name');
    // console.log('fnc', for_loop?.firstNamedChild?.text, for_loop?.firstNamedChild?.type);
  });
});