import { SymbolKind, Location, Range, /* Position, */ DocumentSymbol, WorkspaceSymbol, FoldingRange, DocumentUri, Position } from 'vscode-languageserver';
import { /*getChildNodes, */ containsRange, getChildNodes, getRange } from './tree-sitter';
import * as NodeTypes from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { isScriptNeededArgv } from '../features/definitions/argv';
import { getArgparseDefinitions, isArgparseCommandName } from '../features/definitions/argparse';
import { symbolKindToString } from './translation';
import { Scope } from './new-scope';
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
  private static _rootNode: SyntaxNode | undefined;

  constructor(
    public name: SymbolName,
    public kind: SymbolKind,
    public uri: DocumentUri,
    public range: Range,
    public selectionRange: Range,
    public currentNode: SyntaxNode,
    public parentNode: SyntaxNode = this.currentNode.parent || this.currentNode,
    public parent: FishDocumentSymbol,
    public children: FishDocumentSymbol[] = [],
  ) {
    this.scope = Scope.fromSymbol(this);
    this.addArgvToFunction();
    this.children.forEach(child => {
      child.parentNode = this.currentNode;
      child.parent = this;
    });
  }

  public static setRootNode(node: SyntaxNode): void {
    this._rootNode = node;
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
    parentNode: SyntaxNode = currentNode.parent || currentNode,
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
      && this.scope.currentNode.equals(other.scope.currentNode)
      && this.children.length === other.children.length;
  }

  getNodesInScope(): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const child of getChildNodes(this.currentNode)) {
      if (this.scope.contains(child)) {
        result.push(child);
      }
    }
    return result;
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

  getAllChildren(): FishDocumentSymbol[] {
    return flattenNested(...this.children);
  }

  kindToString(): string {
    return symbolKindToString(this.kind);
  }

  isBeforePosition(position: Position): boolean {
    return this.isRangeBeforePosition(this.range, position);
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
  set parentSymbol(parent: FishDocumentSymbol) {
    this.parent = parent;
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

export function getFishDocumentSymbols(uri: DocumentUri, rootNode: SyntaxNode, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
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
          childrenSymbols.forEach(symbol => symbol.parentSymbol = parentSymbol);
        }
        symbols.push(newSymbol);
        continue;
      }
      symbols.push(...childrenSymbols);
    }
    return symbols;
  }

  /** add the result symbols to the rootSymbol.children */
  const symbols = innerFishDocumentSymbols(uri, ...currentNodes);
  rootSymbol.children.push(...symbols);

  return symbols;
}

// export function getFishDocumentSymbols(
//   uri: DocumentUri,
//   ...rootNode: SyntaxNode[]
// ): FishDocumentSymbol[] {
//   const rootSymbol = FishDocumentSymbol.createRoot(uri);
//
//   function processNode(currentNode: SyntaxNode, parentSymbol: FishDocumentSymbol): void {
//     const { shouldCreate, kind, parent, child } = extractSymbolInfo(currentNode);
//
//     if (isScriptNeededArgv(uri, currentNode)) {
//       const argvSymbol = new FishDocumentSymbol(
//         'argv',
//         SymbolKind.Variable,
//         uri,
//         getRange(parent),
//         getRange(currentNode),
//         currentNode,
//         parent,
//         parentSymbol,
//       );
//       parentSymbol.children.push(argvSymbol);
//     }
//
//     if (currentNode && isArgparseCommandName(currentNode)) {
//       const argparseSymbols = getArgparseDefinitions(uri, currentNode);
//       argparseSymbols.forEach(symbol => {
//         symbol.parent = parentSymbol;
//         parentSymbol.children.push(symbol);
//       });
//     }
//
//     if (shouldCreate) {
//       const newSymbol = new FishDocumentSymbol(
//         child.text,
//         kind,
//         uri,
//         getRange(parent),
//         getRange(child),
//         child,
//         parent,
//         parentSymbol,
//       );
//       parentSymbol.children.push(newSymbol);
//       parentSymbol = newSymbol;
//     }
//
//     currentNode.children.forEach(childNode => {
//       processNode(childNode, parentSymbol);
//     });
//   }
//
//   for (const node of rootNode) {
//     processNode(node, rootSymbol);
//   }
//   return [rootSymbol];
// }

// export function getFishDocumentSymbolsIterative(
//   uri: DocumentUri,
//   rootNode: SyntaxNode,
// ): FishDocumentSymbol[] {
//   const symbols: FishDocumentSymbol[] = [];
//   const nodeStack: SyntaxNode[] = [rootNode];
//   const rootSymbol = FishDocumentSymbol.createRoot(uri);
//   const symbolStack: FishDocumentSymbol[] = [];
//
//   while (nodeStack.length > 0 && symbolStack.length > 0) {
//     const currentNode = nodeStack.pop();
//     let parentSymbol = symbolStack.pop();
//
//     if (!parentSymbol) {
//       parentSymbol = rootSymbol;
//     }
//
//     if (!currentNode) {
//       continue;
//     }
//
//     const { shouldCreate, kind, parent, child } = extractSymbolInfo(currentNode);
//
//     if (isScriptNeededArgv(uri, currentNode)) {
//       const argvSymbol = new FishDocumentSymbol(
//         'argv',
//         SymbolKind.Variable,
//         uri,
//         getRange(parent),
//         getRange(currentNode),
//         currentNode,
//         parent,
//         parentSymbol || rootSymbol,
//       );
//       symbols.push(argvSymbol);
//     }
//
//     if (currentNode && isArgparseCommandName(currentNode)) {
//       const argparseSymbols = getArgparseDefinitions(uri, currentNode, parentSymbol);
//       // argparseSymbols.forEach(symbol => symbol.parentSymbol = parentSymbol);
//       symbols.push(...argparseSymbols);
//     }
//
//     if (shouldCreate) {
//       const newSymbol = new FishDocumentSymbol(
//         child.text,
//         kind,
//         uri,
//         getRange(parent),
//         getRange(child),
//         child,
//         parent,
//         parentSymbol,
//       );
//       symbols.push(newSymbol);
//       parentSymbol = newSymbol;
//       // parentSymbol = newSymbol;
//     }
//
//     currentNode.children.slice().reverse().forEach(childNode => {
//       nodeStack.push(childNode);
//       symbolStack.push(parentSymbol);
//     });
//   }
//
//   return symbols;
// }
// export function getFishDocumentSymbols(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
//   const symbols: FishDocumentSymbol[] = [];
//   const stack: FishDocumentSymbol[] = [];
//
//   function processNode(...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
//     for (const current of currentNodes) {
//       const childrenSymbols = processNode(...current.children);
//       const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);
//
//       if (isScriptNeededArgv(uri, current)) {
//         const argvSymbol = FishDocumentSymbol.create(
//           'argv',
//           SymbolKind.Variable,
//           uri,
//           getRange(parent),
//           getRange(current),
//           current,
//           parent,
//           stack[stack.length - 1] || FishDocumentSymbol.createRoot(uri),
//           [],
//         );
//         symbols.push(argvSymbol);
//         if (stack.length > 0) {
//           stack.at(-1)?.children.push(argvSymbol);
//         }
//       }
//
//       if (current && isArgparseCommandName(current)) {
//         const argparseSymbols = getArgparseDefinitions(uri, current, stack.at(-1) || FishDocumentSymbol.createRoot(uri));
//         symbols.push(...argparseSymbols);
//         if (stack.length > 0) {
//           stack.at(-1)?.children.push(...argparseSymbols);
//         }
//         return childrenSymbols;
//       }
//
//       if (shouldCreate) {
//         const newSymbol = FishDocumentSymbol.create(
//           child.text,
//           kind,
//           uri,
//           getRange(parent),
//           getRange(child),
//           child,
//           parent,
//           stack[stack.length - 1] || FishDocumentSymbol.createRoot(uri),
//           childrenSymbols,
//         );
//         symbols.push(newSymbol);
//         if (stack.length > 0) {
//           stack[stack.length - 1]?.children.push(newSymbol);
//         }
//         stack.push(newSymbol);
//         const result = [newSymbol, ...childrenSymbols];
//         stack.pop();
//         return result;
//       }
//
//       return childrenSymbols;
//     }
//     currentNodes.forEach(node => processNode(node));
//     return symbols;
//   }
//
//   return processNode(...currentNodes);
// }