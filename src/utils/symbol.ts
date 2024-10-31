import * as LSP from 'vscode-languageserver';
import { SymbolKind, Range, Location } from 'vscode-languageserver';
// import Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { isBlock, isEndStdinCharacter, isEscapeSequence, isMatchingOption, isOption, isString, isType, NodeOptionQueryText, Option } from './node-types';
import * as Locations from './locations';
import { findParent, getBlockDepth } from './tree-sitter';
import { flattenNested } from './flatten';
import { getCallableRanges } from './scope';
import { getPathProperties } from './translation';
import { md } from './markdown-builder';
// import { getCallableRanges, getCallableRanges2, rangesToNodes, removeRange } from './scope';
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
    public parentNode: SyntaxNode,
    public parent: FishSymbol | null = null,
    public children: FishSymbol[] = [],
  ) { }

  public static create(
    name: string,
    kind: SymbolKind,
    uri: string,
    modifier: ModifierType,
    node: SyntaxNode,
    parentNode: SyntaxNode,
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

  isRoot() {
    return this.kind === SymbolKind.Null;
  }

  isArgparseFlag() {
    if (!this.name.startsWith('_flag_')) return false;
    if (this.parentNode.type === 'command' && this.parentNode.firstNamedChild?.text === 'argparse') {
      return true;
    }
    return false;
  }

  get kindString() {
    switch (this.kind) {
      case SymbolKind.Function:
        return 'function';
      case SymbolKind.Variable:
        return 'variable';
      default:
        return '' as never;
    }
  }

  isGlobalScope() {
    return this.modifier === 'GLOBAL'
      || this.modifier === 'UNIVERSAL';
  }

  isLocalScope() {
    return this.modifier === 'LOCAL'
      || this.modifier === 'FUNCTION';
  }

  getParentScope() {
    return ModifierParentNode[this.modifier](this);
  }

  getParentScopeRange() {
    return Locations.Range.fromNode(ModifierParentNode[this.modifier](this));
  }

  get allChildren() {
    return flattenNested(...this.children);
  }

  getLocalCallableRanges() {
    return getCallableRanges(this);
  }

  isCallableAtPosition(position: LSP.Position) {
    return this.getLocalCallableRanges()
      .some(range => Locations.Range.containsPosition(range, position));
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
          case isMatchingOption(mostRecentFlag, Option.create('-a', '--argument-names')):
            functionInfo.argumentNames.push(this.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-V', '--inherit-variable')):
            functionInfo.inheritVariable.push(this.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-v', '--on-variable')):
            functionInfo.inheritVariable.push(this.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-d', '--description')):
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

  export function toMarkdown(symbol: FishSymbol): string {
    const info = symbol.functionInfo!;
    return [
      md.inlineCode(symbol.name),
      `**Description**: ${info.description}`,
      `**Autoloaded**: ${info.isAutoLoad}`,
      `**Path**: ${getPathProperties(info.uri).normalizedPath}`,
      `**Argument Names**: ${info.argumentNames.map(arg => arg.name).join(', ')}`,
      `**Inherit Variable**: ${info.inheritVariable.map(arg => arg.name).join(', ')}`,
      `**On Variable**: ${info.onVariable.map(arg => arg.name).join(', ')}`,
      `**No Scope Shadowing**: ${info.noScopeShadowing}`,
      md.separator(),
      md.codeBlock('fish', symbol.parentNode.text),
    ].join('\n');
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
    uriModifier.at(-2) || '',
    uriModifier.at(-1)?.split('.').shift() || '',
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
  return 'LOCAL';
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
        case isMatchingOption(mostRecentFlag, Option.create('-a', '--argument-names')):
        case isMatchingOption(mostRecentFlag, Option.create('-V', '--inherit-variable')):
        case isMatchingOption(mostRecentFlag, Option.create('-v', '--on-variable')):
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
  const firstNamedChild = node.firstNamedChild!;
  const modifier = toModifier(node, uri, SymbolKind.Function);

  const funcSymbol = FishSymbol.create(firstNamedChild.text, SymbolKind.Function, uri, modifier, firstNamedChild, node, parentSymbol);
  funcSymbol.children.push(...processFunctionArgumentVariables(node, uri, funcSymbol), ...children);
  funcSymbol.children.forEach(child => child.parent = funcSymbol);
  return [funcSymbol];
}

function processProgram(node: SyntaxNode, uri: string, parentSymbol: FishSymbol): FishSymbol[] {
  const { isScript } = getPathProperties(uri);
  if (isScript) [FishSymbol.create('argv', SymbolKind.Variable, uri, 'LOCAL', node, node, parentSymbol)];
  return [];
}

function createRootSymbol(node: SyntaxNode, uri: string): FishSymbol {
  return FishSymbol.create('', SymbolKind.Null, uri, 'LOCAL', node, node, null);
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
export function getScopedFishSymbols(root: SyntaxNode, uri: string) {
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
  /* add argv to script uri's */
  if (getPathProperties(uri).isScript) {
    symbols.unshift(FishSymbol.create('argv', SymbolKind.Variable, uri, 'LOCAL', root, root, rootSym));
  }
  rootSym.children.push(...symbols);
  return symbols;
}

export const nonRequiredSymbolsWithReferences: readonly string[] = [
  'pipestatus',
  'status',
  'argv',
] as const;