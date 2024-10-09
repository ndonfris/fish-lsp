import { SymbolKind, Location, Range, /* Position, */ DocumentSymbol, WorkspaceSymbol, FoldingRange, DocumentUri } from 'vscode-languageserver';
import { /*getChildNodes, */ getRange } from './tree-sitter';
import * as NodeTypes from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { isScriptNeededArgv } from '../features/definitions/argv';
import { getArgparseDefinitions, isArgparseCommandName } from '../features/definitions/argparse';
import { symbolKindToString } from './translation';
import { getNodeScopeType, getScope, Scope, ScopeTag } from './scope';
import { flattenNested } from './flatten';
import { getScopeTagValue } from './definition-scope';

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

export class FishDocumentSymbol implements FishDocumentSymbol {
  constructor(
    public name: SymbolName,
    public kind: SymbolKind,
    public uri: DocumentUri,
    public range: Range,
    public selectionRange: Range,
    public node: SyntaxNode,
    public parent: SyntaxNode | null = this.node.parent,
    public scope: Scope = getScope(this.uri, this.node, this.name),
    public children: FishDocumentSymbol[] = [],
  ) {
    this.addArgvToFunction();
  }

  public static create(
    name: SymbolName,
    kind: SymbolKind,
    uri: DocumentUri,
    range: Range,
    selectionRange: Range,
    node: SyntaxNode,
    parent: SyntaxNode | null = node.parent,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    return new FishDocumentSymbol(
      name,
      kind,
      uri,
      range,
      selectionRange,
      node,
      parent,
      getScope(uri, node, name),
      children,
    );
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
      parent: this.parent?.toString(),
      scope: this.scope.toString(),
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
      && (!!this.parent && !!other.parent && this.parent.equals(other.parent))
      && this.scope.tag === other.scope.tag
      && this.scope.node.equals(other.scope.node)
      && this.children.length === other.children.length;
  }

  static fromNode(
    uri: DocumentUri,
    node: SyntaxNode,
    parent: SyntaxNode,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    // const scope = getScope(uri, node);
    const symbolKind = getNodeScopeType(node) === 'function'
      ? SymbolKind.Function
      : SymbolKind.Variable;
    return FishDocumentSymbol.create(
      node.text,
      symbolKind,
      uri,
      getRange(parent),
      getRange(node),
      node,
      parent,
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
        this.parent,
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
        getRange(parent),
        getRange(current),
        current,
        parent,
        childrenSymbols,
      ));
      // symbols.push(...createArgvScriptDefinition(uri, current));
    }

    // adds argparse definitions
    if (current && isArgparseCommandName(current)) {
      symbols.push(...getArgparseDefinitions(uri, current));
      continue;
    }

    // adds symbols if the current node is a variable or function definition
    if (shouldCreate) {
      symbols.push(FishDocumentSymbol.create(
        child.text,
        kind,
        uri,
        getRange(parent),
        getRange(child),
        child,
        parent,
        childrenSymbols,
      ));
      continue;
    }
    symbols.push(...childrenSymbols);
  }
  return symbols;
}
