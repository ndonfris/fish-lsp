import { SymbolKind, Location, Range, Position, DocumentSymbol, WorkspaceSymbol, FoldingRange } from 'vscode-languageserver';
import { getChildNodes, getRange } from '../src/utils/tree-sitter';
import * as NodeTypes from '../src/utils/node-types';
import Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { isScriptNeededArgv } from '../src/features/definitions/argv';
import { getArgparseDefinitions, isArgparseCommandName } from '../src/features/definitions/argparse';
import { symbolKindToString } from '../src/utils/translation';

export type DocumentUri = string;
export type SymbolName = string;

export interface FishDocumentSymbol extends DocumentSymbol {
  name: SymbolName;
  kind: SymbolKind;
  uri: DocumentUri;
  range: Range;
  selectionRange: Range;
  node: SyntaxNode;
  scope: Scope;
  children: FishDocumentSymbol[];
}

export const ScopeTag = {
  local: 0,
  inherit: 1,
  function: 2,
  global: 3,
  universal: 4,
} as const;

// Create a type from the object keys
type ScopeTag = keyof typeof ScopeTag;

// Utility type to get the numeric value of a ScopeTag
type ScopeTagValue = typeof ScopeTag[ScopeTag];
export type TextSpan = {
  ranges: Range[];
};

export interface Scope {
  tag: ScopeTag;
  node: Parser.SyntaxNode;
  span: TextSpan;
}

export namespace Scope {
  export function create(
    tag: ScopeTag,
    node: Parser.SyntaxNode,
  ): Scope {
    const spans: Range[] = [];
    for (const n of getChildNodes(node)) {
      if (n.type === 'comment') {
        continue;
      }
      if (n.type === 'function_definition') {
        continue;
      }
      spans.push(getRange(n));
    }
    return { tag, node, span: { ranges: [getRange(node)] } };
  }
}

function getNodeScopeType(node: SyntaxNode) {
  if (NodeTypes.isFunctionDefinitionName(node)) {
    return 'function';
  }
  if (NodeTypes.isVariableDefinitionName(node)) {
    return 'variable';
  }
  return 'unknown';
}

function findParent(n: SyntaxNode, fn: (n: SyntaxNode) => boolean): SyntaxNode | null {
  let current = n.parent;
  while (current) {
    if (fn(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function getFunctionScopeType(uri: string, node: SyntaxNode) {
  const uriParts = uri.split('/');
  const functionUriName = uriParts.at(-1)?.split('.')?.at(0) || uriParts.at(-1);
  const pFunction = findParent(node, (n) => n.type === 'function_definition');

  if (uriParts?.at(-2) && uriParts.at(-2)?.includes('functions')) {
    if (functionUriName === node.text) {
      return 'global';
    }
    if (pFunction) {
      return 'function';
    }
    return 'local';
  } else if (uriParts?.at(-1) === 'config.fish' || uriParts.at(-2) === 'conf.d') {
    return 'global';
  }
  if (pFunction) {
    return 'function';
  }
  return 'local';
}

function getVariableScopeModifier(node: SyntaxNode): ScopeTag {
  const args: SyntaxNode[] = node.parent?.childrenForFieldName('argument') || [];
  args.forEach((n: SyntaxNode) => {
    switch (true) {
      case NodeTypes.isMatchingOption(n, { shortOption: '-l', longOption: '--local' }):
        return 'local';
      case NodeTypes.isMatchingOption(n, { shortOption: '-f', longOption: '--function' }):
        return 'function';
      case NodeTypes.isMatchingOption(n, { shortOption: '-g', longOption: '--global' }):
      case NodeTypes.isMatchingOption(n, { shortOption: '-U', longOption: '--universal' }):
        return 'global';
      default:
        break;
    }
  });
  return 'local';
}

function createSpan(node: SyntaxNode): TextSpan {
  const ranges: Range[] = [];
  for (const child of node.children) {
    if (child.type === 'comment') {
      continue;
    }
    if (child.type === 'function_definition') {
      continue;
    }
    ranges.push(getRange(child));
  }
  return { ranges };
}

function getScope(documentUri: DocumentUri, node: Parser.SyntaxNode): Scope {
  const nodeType = getNodeScopeType(node);
  let scopeTag: ScopeTag = 'local';
  let spanNode: SyntaxNode = node;

  if (nodeType === 'function') {
    scopeTag = getFunctionScopeType(documentUri, node);
  } else if (nodeType === 'variable') {
    if (node.parent) {
      spanNode = node.parent;
      if (node.parent.type === 'function_definition') {
        scopeTag = 'function';
      } else if (node.parent.type === 'for_statement') {
        scopeTag = 'local';
      } else if (NodeTypes.isCommandWithName(node.parent, 'read')) {
        scopeTag = getVariableScopeModifier(node);
      } else if (NodeTypes.isCommandWithName(node.parent, 'set')) {
        scopeTag = getVariableScopeModifier(node);
      }
    }
  }

  return Scope.create(scopeTag, node);
}

export class FishDocumentSymbol implements FishDocumentSymbol {
  public scope: Scope;

  constructor(
    public name: SymbolName,
    public kind: SymbolKind,
    public uri: DocumentUri,
    public range: Range,
    public selectionRange: Range,
    public node: SyntaxNode,
    public children: FishDocumentSymbol[],
  ) {
    this.scope = getScope(this.uri, this.node);
    this.addArgvToFunction();
  }

  public static create(
    name: SymbolName,
    kind: SymbolKind,
    uri: DocumentUri,
    range: Range,
    selectionRange: Range,
    node: SyntaxNode,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    return new FishDocumentSymbol(name, kind, uri, range, selectionRange, node, children);
  }

  toLocation(): Location {
    return Location.create(this.uri, this.range);
  }

  toWorkspaceSymbol(): WorkspaceSymbol {
    return {
      name: this.name,
      kind: this.kind,
      location: this.toLocation(),
    };
  }

  toFoldingRange(): FoldingRange {
    return {
      startLine: this.range.start.line,
      endLine: this.range.end.line,
      collapsedText: this.name,
    };
  }

  toString(): string {
    const rangeStr = (r: Range) => `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
    return JSON.stringify({
      name: this.name,
      kind: symbolKindToString(this.kind),
      uri: this.uri,
      range: rangeStr(this.range),
      selectionRange: rangeStr(this.selectionRange),
      node: this.node.toString(),
      children: this.children.map(c => c.name + ' ' + symbolKindToString(c.kind)),
    }, null, 2);
  }

  equals(other: FishDocumentSymbol): boolean {
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
      && this.children.length === other.children.length;
  }

  static fromNode(
    uri: DocumentUri,
    node: SyntaxNode,
    parent: SyntaxNode,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    // const scope = getScope(uri, node);
    const symbolKind = getNodeScopeType(node) === 'function' ? SymbolKind.Function : SymbolKind.Variable;
    return FishDocumentSymbol.create(
      node.text,
      symbolKind,
      uri,
      getRange(parent),
      getRange(node),
      node,
      children,
    );
  }

  addArgvToFunction(): FishDocumentSymbol {
    if (this.kind === SymbolKind.Function) {
      this.children.unshift(FishDocumentSymbol.create(
        'argv',
        SymbolKind.Variable,
        this.uri,
        this.range,
        this.selectionRange,
        this.node,
        [],
      ));
    }
    return this;
  }
}

function extractSymbolInfo(node: SyntaxNode): {
  shouldCreate: boolean;
  kind: SymbolKind;
  child: SyntaxNode;
  parent: SyntaxNode;

} {
  let shouldCreate = false;
  let kind: SymbolKind = SymbolKind.Null;
  let parent: SyntaxNode = node;
  let child: SyntaxNode = node;
  if (NodeTypes.isVariableDefinitionName(child)) {
    parent = NodeTypes.refinedFindParentVariableDefinitionKeyword(child)!.parent!;
    child = node;
    kind = SymbolKind.Variable;
    shouldCreate = !child.text.startsWith('$');
  } else if (child.firstNamedChild && NodeTypes.isFunctionDefinitionName(child.firstNamedChild)) {
    parent = node;
    child = child.firstNamedChild!;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return { shouldCreate, kind, parent, child };
}

export function getFishDocumentSymbols(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
  const symbols: FishDocumentSymbol[] = [];
  for (const current of currentNodes) {
    const childrenSymbols = getFishDocumentSymbols(uri, ...current.children);
    const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);

    // adds initial argv for a fish shell script/executable
    // if the current node is a program node
    if (isScriptNeededArgv(uri, current)) {
      symbols.push(FishDocumentSymbol.create(
        'argv',
        SymbolKind.Variable,
        uri,
        getRange(current),
        getRange(parent),
        current,
        childrenSymbols,
      ));
      // symbols.push(...createArgvScriptDefinition(uri, current));
    }

    // adds argparse definitions
    if (current.parent && isArgparseCommandName(current)) {
      symbols.push(...getArgparseDefinitions(uri, current));
      // symbols.push(FishDocumentSymbol.create(
      //   '_flag_' + current.text,
      //   SymbolKind.Variable,
      //   uri,
      //   getRange(parent),
      //   getRange(current),
      //   childrenSymbols,
      // ), FishDocumentSymbol.create(
      //   '_flag_' + current.text,
      //   SymbolKind.Variable,
      //   uri,
      //   getRange(parent),
      //   getRange(current),
      //   childrenSymbols,
      // ));
      // symbols.push(...getArgparseDefinitions(uri, current));
      continue;
    }

    // if (isCommand(current)) {
    //   symbols.push(createStatusDocumentSymbol(uri, current));
    // }

    // adds symbols if the current node is a variable or function definition
    if (shouldCreate) {
      // symbols.push(FishDocumentSymbol.fromNode(uri, child, parent, childrenSymbols));
      symbols.push(FishDocumentSymbol.create(child.text, kind, uri, getRange(parent), getRange(child), child, childrenSymbols));
      continue;
    }
    symbols.push(...childrenSymbols);
  }
  return symbols;
}

// const symbols: FishDocumentSymbol[] = [];
//
// function visitNode(currentNode: SyntaxNode) {
//   if (!currentNode) return;
//
//   const symbol: FishDocumentSymbol = {
//     name: currentNode.text,
//     kind: SymbolKind.Variable,
//     location: Location.create(documentUri, getRange(currentNode)),
//     range: getRange(currentNode),
//     selectionRange: getRange(currentNode),
//     scope: getScope(documentUri, currentNode),
//     children: [],
//   };
//
//   symbols.push(symbol);
//   currentNode.children.forEach(child => visitNode(child));
// }
//
// visitNode(tree.rootNode);
// return symbols;