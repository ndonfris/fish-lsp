import { SymbolKind, Location, Range, /* Position, */ DocumentSymbol, WorkspaceSymbol, FoldingRange, DocumentUri, Position } from 'vscode-languageserver';
import { /*getChildNodes, */ containsRange, getChildNodes, getRange } from './tree-sitter';
import * as NodeTypes from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { isScriptNeededArgv } from '../features/definitions/argv';
import { getArgparseDefinitions, isArgparseCommandName } from '../features/definitions/argparse';
import { symbolKindToString } from './translation';
import { Scope, ScopeModifier, ScopeTag } from './scope';
import * as Locations from './locations';
import { flattenNested } from './flatten';

export type SymbolName = string;

export interface FishDocumentSymbol extends DocumentSymbol {
  name: SymbolName;
  kind: SymbolKind;
  uri: DocumentUri;
  range: Range;
  selectionRange: Range;
  currentNode: SyntaxNode;
  parentNode: SyntaxNode;
  parent: FishDocumentSymbol;
  scope: Scope;
  children: FishDocumentSymbol[];
}

export class FishDocumentSymbol implements FishDocumentSymbol {
  public scope: Scope;
  public aliases: string[] = [];
  public argparsed = false;

  constructor(
    public name: SymbolName,
    public kind: SymbolKind,
    public uri: DocumentUri,
    public range: Range,
    public selectionRange: Range,
    public currentNode: SyntaxNode,
    public parentNode: SyntaxNode,
    public parent: FishDocumentSymbol,
    public children: FishDocumentSymbol[] = [],
  ) {
    this.scope = Scope.fromSymbol(this);
    this.addArgvToFunction();
    this.children.forEach(child => {
      // child.parentNode = this.currentNode;
      child.parent = this;
    });
    this.aliases.push(this.name);
  }

  public static createRoot(uri: DocumentUri, rootNode: SyntaxNode): FishDocumentSymbol {
    return new FishDocumentSymbol(
      'ROOT',
      SymbolKind.Null,
      uri,
      getRange(rootNode),
      Range.create(0, 0, 0, 0),
      rootNode, // Empty object as SyntaxNode for root
      rootNode,
      {} as FishDocumentSymbol, // Empty object as parent for root
    );
  }

  public static create(
    name: SymbolName,
    kind: SymbolKind,
    uri: DocumentUri,
    range: Range,
    selectionRange: Range,
    currentNode: SyntaxNode,
    parentNode: SyntaxNode,
    parent: FishDocumentSymbol,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    return new FishDocumentSymbol(
      name,
      kind,
      uri,
      range,
      selectionRange,
      currentNode,
      parentNode,
      parent,
      children,
    );
  }

  public toLocation(): Location {
    return Location.create(this.uri, this.selectionRange);
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
      node: this.currentNode.toString(),
      parent: this.parentNode?.toString(),
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
      && this.currentNode.equals(other.currentNode)
      && (!!this.parentNode && !!other.parentNode && this.parentNode.equals(other.parentNode))
      && this.scope.tag === other.scope.tag
      && this.scope.equals(other.scope)
      && this.children.length === other.children.length;
  }

  hasName(name: string): boolean {
    return this.name === name || this.children.some(child => child.hasName(name));
  }

  getNodesInScope(): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    const exclude: Range[] = [];
    const childExclusions = this.kind === SymbolKind.Function
      ? this.parent.allChildren()
        .filter(child => child.kind === SymbolKind.Function && !child.isShadowingRoot())
        .map(child => child.range)
      : this.parent.allChildren()
        .filter(child => child.kind === SymbolKind.Function
          && child.hasName(this.name)
          && child.allChildren()
            .some(s => {
              return s.name === this.name
                && !s.scope.symbol.parentNode.equals(this.scope.symbol.parentNode);
            }),
        ).map(s => s.range);

    if (this.kind === SymbolKind.Function && this.parent.kind !== SymbolKind.Null && this.scope.tagValue < ScopeTag.function) {
      exclude.push(this.parentToCurrentRange());
    }
    exclude.push(...childExclusions);
    for (const child of this.parentChildren) {
      if (child.type === 'program') {
        continue;
      }
      if (this.kind === SymbolKind.Function && this.parentNode.equals(child)) {
        exclude.push(getRange(child));
        continue;
      }
      if (
        this.kind === SymbolKind.Function &&
        !this.parentNode.equals(child) &&
        child.type === 'function_definition' &&
        !ScopeModifier.functionWithFlag(child, this) &&
        this.scope.tagValue < Scope.getTagValue('function')
      ) {
        exclude.push(getRange(child));
        continue;
      }
      if (exclude.some(range => containsRange(range, getRange(child)))) {
        continue;
      }
      if (this.kind === SymbolKind.Function) {
        result.push(child);
      } else if (this.equalsName(child.text)) {
        result.push(child);
      } else if (this.isRangeBeforePosition(this.selectionRange, getRange(child).end)) {
        result.push(child);
      }
    }
    return result;
  }

  equalsName(name: string): boolean {
    return this.aliases.includes(name);
  }

  isShadowingRoot(): boolean {
    return this.parent.kind === SymbolKind.Null && this.kind === SymbolKind.Function;
  }

  isShadowingFunction(): boolean {
    return this.parent.kind === SymbolKind.Function && this.kind === SymbolKind.Function;
  }

  parentToCurrentRange(): Range {
    return Range.create(this.parent.range.start, this.range.end);
  }

  get parentChildren(): SyntaxNode[] {
    if (this.kind === SymbolKind.Variable) {
      return getChildNodes(this.parent.parentNode);
    }
    return getChildNodes(this.parent.parentNode);
  }

  getLocalReferences(): Location[] {
    const result: Location[] = this.getNodesInScope().filter(s => this.aliases.includes(s.text)).map(s => Location.create(this.uri, getRange(s)));

    if (this.scope.tagValue >= ScopeTag.global && this.kind === SymbolKind.Function) {
      result.unshift(Location.create(this.uri, this.selectionRange));
    }
    return result;
  }

  getDefinitionAndReferences(): SyntaxNode[] {
    return [
      this.currentNode,
      ...this.getNodesInScope().filter(s => this.aliases.includes(s.text)),
    ].filter(n => n.type === 'word');
  }

  static fromNode(
    uri: DocumentUri,
    node: SyntaxNode,
    parent: SyntaxNode,
    parentSymbol: FishDocumentSymbol,
    children: FishDocumentSymbol[] = [],
  ): FishDocumentSymbol {
    // const scope = getScope(uri, node);
    const symbolKind = NodeTypes.isFunctionDefinitionName(node)
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
      parentSymbol,
      children,
    );
  }

  allChildren(): FishDocumentSymbol[] {
    return flattenNested(...this.children);
  }

  kindToString(): string {
    return symbolKindToString(this.kind);
  }

  isBeforePosition(position: Position): boolean {
    return this.isRangeBeforePosition(this.range, position);
  }

  public containsPosition(position: Position): boolean {
    return this.getNodesInScope().some(node => Locations.Range.containsPosition(getRange(node), position));
  }

  public isArgparsed(): boolean {
    return this.argparsed;
  }

  private isRangeBeforePosition(range: Range, pos: Position): boolean {
    // If the range's end line is before the position's line, it's definitely before
    if (range.end.line < pos.line) {
      return true;
    }

    // If the range's end line is the same as the position's line,
    // check if the range's end character is before the position's character
    if (range.end.line === pos.line && range.end.character <= pos.character) {
      return true;
    }

    // In all other cases, the range is not entirely before the position
    return false;
  }

  addArgvToFunction(): FishDocumentSymbol {
    if (this.kind === SymbolKind.Function) {
      this.children.unshift(FishDocumentSymbol.create(
        'argv',
        SymbolKind.Variable,
        this.uri,
        this.range,
        this.selectionRange,
        this.currentNode,
        this.parentNode,
        this,
        [],
      ));
    }
    return this;
  }

  toFunctionNode() {
    const definition = this.parentNode;
    const focused = definition.descendantsOfType('argument_name');
    
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
  } else if (node.type === 'function_definition') {
    parent = node;
    child = parent.childForFieldName('name') as SyntaxNode;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return { shouldCreate, kind, parent, child };
}

// export function getFishDocumentSymbols(uri: string, rootNode: SyntaxNode, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
export function getFishDocumentSymbols(uri: string, rootNode: SyntaxNode): FishDocumentSymbol[] {
  const rootSymbol = FishDocumentSymbol.createRoot(uri, rootNode);
  let parentSymbol = rootSymbol;
  function innerFishDocumentSymbols(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];
    for (const current of currentNodes) {
      const childrenSymbols = innerFishDocumentSymbols(uri, ...current.children);
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
          parentSymbol,
          childrenSymbols,

        ));
        // symbols.push(...createArgvScriptDefinition(uri, current));
      }

      // adds argparse definitions
      if (current && isArgparseCommandName(current)) {
        symbols.push(...getArgparseDefinitions(uri, current, parentSymbol));
        continue;
      }

      // adds symbols if the current node is a variable or function definition
      if (shouldCreate) {
        const newSymbol = FishDocumentSymbol.create(
          child.text,
          kind,
          uri,
          getRange(parent),
          getRange(child),
          child,
          parent,
          parentSymbol,
          childrenSymbols,
        );
        if (kind === SymbolKind.Variable && !containsRange(parentSymbol.range, newSymbol.range)) {
          parentSymbol = parentSymbol.parent;
        }
        if (kind === SymbolKind.Function) {
          parentSymbol = newSymbol;
          childrenSymbols.forEach(symbol => symbol.parent = parentSymbol);
        }
        symbols.push(newSymbol);
        continue;
      }
      symbols.push(...childrenSymbols);
    }
    return symbols;
  }

  /** add the result symbols to the rootSymbol.children */
  const symbols = innerFishDocumentSymbols(uri, rootNode);
  rootSymbol.children.push(...symbols);

  return symbols;
}

export const nonRequiredSymbolsWithReferences: readonly string[] = [
  'pipestatus',
  'status',
  'argv',
] as const;