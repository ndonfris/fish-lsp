import {
  DocumentSymbol,
  SymbolKind,
  // Range,
  DocumentUri,
  Position,
  WorkspaceSymbol,
  Location,
  Range,
  FoldingRange,
} from 'vscode-languageserver';
import { containsRange, getRange, isPositionBefore, isPositionWithinRange } from './tree-sitter';
import { isVariableDefinitionName, isFunctionDefinitionName, refinedFindParentVariableDefinitionKeyword } from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope, getScope, ScopeTag } from './definition-scope';
import { MarkdownBuilder, md } from './markdown-builder';
import { symbolKindToString } from './translation';
import { PrebuiltDocumentationMap } from './snippets';
import * as Locations from './locations';
import { getArgparseDefinitions, isArgparseCommandName } from '../features/definitions/argparse';
import { createArgvScriptDefinition, isScriptNeededArgv } from '../features/definitions/argv';
// import { createStatusDocumentSymbol } from '../features/definitions/status';

const getScopeValue = (tag: keyof typeof ScopeTag) => {
  return [
    'local',
    'inherit',
    'function',
    'global',
  ].indexOf(tag);
};

export class FishDocumentSymbol implements DocumentSymbol {
  constructor(
    public name: string,
    public kind: SymbolKind,
    public uri: string,
    public range: Range,
    public selectionRange: Range,
    public scope: DefinitionScope,
    public node: SyntaxNode,
    public parent: SyntaxNode,
    public children: FishDocumentSymbol[] = [],
  ) {
    this.insertArgvOnFunction();
  }

  get detail() {
    const found = PrebuiltDocumentationMap.findMatchingNames(this.name, 'variable', 'command')?.find(name => name.name === this.name);
    const kindStr = `(${symbolKindToString(this.kind)})`;
    return new MarkdownBuilder().fromMarkdown(
      [
        md.bold(kindStr), '-', md.italic(this.name),
      ],
      md.separator(),
      md.codeBlock('fish', this.parent.text),
      found
        ? md.newline() + md.separator() + md.newline() + found.description
        : '',
    ).toString();
  }

  isFlagSymbol(): boolean {
    return (
      this.name.startsWith('_flag_') &&
      this.kind === SymbolKind.Variable &&
      this.parent.firstChild?.text === 'argparse'
    );
  }

  equivalentFlags(other: FishDocumentSymbol): boolean {
    return (
      this.isFlagSymbol() &&
      other.isFlagSymbol() &&
      equalRanges(this.selectionRange, other.selectionRange)
    );
  }

  equals(other: FishDocumentSymbol): boolean {
    const equalNames = () => {
      if (this.isFlagSymbol() && other.isFlagSymbol()) {
        return (
          this.selectionRange.start.line === other.selectionRange.start.line &&
          this.selectionRange.start.character === other.selectionRange.start.character &&
          this.selectionRange.end.line === other.selectionRange.end.line &&
          this.selectionRange.end.character === other.selectionRange.end.character
        );
      }
      return this.name === other.name;
    };

    return (
      equalNames() &&
      this.kind === other.kind &&
      this.uri === other.uri &&
      equalRanges(this.range, other.range) &&
      equalRanges(this.selectionRange, other.selectionRange) &&
      this.scope.equals(other.scope) &&
      this.node.equals(other.node) &&
      this.parent.equals(other.parent)
    );
  }

  toWorkspaceSymbol(): WorkspaceSymbol {
    return {
      name: this.name,
      kind: this.kind,
      location: this.toLocation(),
    };
  }
  toLocation(): Location {
    return {
      uri: this.uri,
      range: this.selectionRange,
    };
  }

  toFoldingRange(): FoldingRange {
    return {
      startLine: this.range.start.line,
      endLine: this.range.end.line,
      collapsedText: this.name,
    };
  }

  isBefore(other: FishDocumentSymbol): boolean {
    if (this.range.start.line === other.range.start.line) {
      return this.range.start.character < other.range.start.character;
    }
    return this.range.start.line < other.range.start.line;
  }

  isAfter(other: FishDocumentSymbol): boolean {
    if (this.range.start.line === other.range.start.line) {
      return this.range.start.character > other.range.start.character;
    }
    return this.range.start.line > other.range.start.line;
  }

  scopeLessThan(other: FishDocumentSymbol): boolean {
    const currentLocale = this.scope.tagValue();
    const otherLocale = other.scope.tagValue();
    return currentLocale < otherLocale;
  }

  scopeGreaterThan(other: FishDocumentSymbol): boolean {
    const currentLocale = this.scope.tagValue();
    const otherLocale = other.scope.tagValue();
    return currentLocale > otherLocale;
  }

  scopeSmallerThan(other: FishDocumentSymbol): boolean {
    const currentLocale = this.scope.tagValue();
    const otherLocale = other.scope.tagValue();
    return currentLocale <= otherLocale;
  }

  scopeEquivalent(other: FishDocumentSymbol): boolean {
    if (this.equals(other)) {
      return false;
    }
    if (this.name !== other.name) {
      return false;
    }
    if (this.kind !== other.kind) {
      return false;
    }
    if (this.scope.scopeNode.equals(other.scope.scopeNode)) {
      return true;
    }
    const currentLocale = this.scope.tagValue();
    const otherLocale = other.scope.tagValue();
    return currentLocale >= otherLocale;
  }

  scopeValue(): number {
    return getScopeValue(this.scope.scopeTag);
  }

  private insertArgvOnFunction() {
    if (this.kind === SymbolKind.Function) {
      this.children.unshift(FishDocumentSymbol.create({
        name: 'argv',
        kind: SymbolKind.Variable,
        uri: this.uri,
        scope: DefinitionScope.create(
          this.node,
          'function',
        ),
        range: this.range,
        selectionRange: this.selectionRange,
        node: this.node,
        parent: this.parent,
        children: [],
      }));
    }
  }

  equalScopes(other: FishDocumentSymbol): boolean {
    if (this.scope.scopeNode && other.scope.scopeNode) {
      if ([this.scope.scopeTag, other.scope.scopeTag].includes('inherit')) {
        return this.scope.scopeNode.equals(other.scope.scopeNode);
      } else if (
        ['global'].includes(this.scope.scopeTag) &&
        ['global'].includes(other.scope.scopeTag)
      ) {
        return true;
      }
      // return this.scope.scopeTag === other.scope.scopeTag &&
      return this.scope.scopeNode.equals(other.scope.scopeNode);
    }
    return false;
  }

  logString(): string {
    const symbolIcon = this.kind === SymbolKind.Function ? ' ƒ ' : '  ';
    return `${symbolIcon}${this.name}`;
  }

  // @TODO: remove after testing
  debugString({
    includeDetail = true,
    showVerboseNode = false,
    skipProperties = [],
  }: {
    includeDetail?: boolean;
    showVerboseNode?: boolean;
    skipProperties?: string[];
  } = {}): string {
    const positionString = (pos: Position) => `(line: ${pos.line}, character: ${pos.character})`;

    const rangeString = (range: Range) => {
      return `${positionString(range.start)} --- ${positionString(range.end)}`;
    };

    const syntaxNodeShrotener = (node: SyntaxNode) => {
      const text = node.text
        .replace(/\n/g, '\\n')
        .replace(/ {4}/g, '\t')
        .replace(/\t/g, '\\t');
      return text.length > 20 ? node.text.slice(0, 20) + '...' : text;
    };

    const debugNode = (node: SyntaxNode) => {
      if (!showVerboseNode) return syntaxNodeShrotener(node);
      return {
        type: node.type,
        text: syntaxNodeShrotener(node),
      };
    };

    const logObj = {
      name: this.name,
      kind: symbolKindToString(this.kind),
      uri: this.uri,
      range: rangeString(this.range),
      selectionRange: rangeString(this.selectionRange),
      scope: {
        scopeTag: this.scope.scopeTag,
        scopeNode: debugNode(this.scope.scopeNode),
        scopeNodeIsProgram: this.scope.scopeNode.type === 'program',
      },
      node: debugNode(this.node),
      parent: debugNode(this.parent),
      children: flattenNested(...this.children).map(c => c.name),
    } as any;

    if (includeDetail) {
      logObj.detail = this.detail;
    }

    // Remove properties that should be skipped
    for (const prop of skipProperties) {
      delete logObj[prop];
    }

    return JSON.stringify(logObj, null, 2);
  }
}

export namespace FishDocumentSymbol {

  type CreateParams = {
    name: string;
    kind: SymbolKind;
    uri: string;
    range: Range;
    selectionRange: Range;
    scope: DefinitionScope;
    node: SyntaxNode;
    parent: SyntaxNode;
    children: FishDocumentSymbol[];
  };

  export function create({
    name,
    kind,
    uri,
    range,
    selectionRange,
    scope,
    node,
    parent,
    children,
  }: CreateParams): FishDocumentSymbol {
    return new FishDocumentSymbol(name, kind, uri, range, selectionRange, scope, node, parent, children);
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
  if (isVariableDefinitionName(child)) {
    parent = refinedFindParentVariableDefinitionKeyword(child)!.parent!;
    child = node;
    kind = SymbolKind.Variable;
    shouldCreate = !child.text.startsWith('$');
  } else if (child.firstNamedChild && isFunctionDefinitionName(child.firstNamedChild)) {
    parent = node;
    child = child.firstNamedChild!;
    kind = SymbolKind.Function;
    shouldCreate = true;
  }
  return { shouldCreate, kind, parent, child };
}

// export type Symbol = WorkspaceSymbol | DocumentSymbol;

// export function flattenNested<T extends { children: T[]; }>(...items: T[]): T[] {
//   return items.flatMap(item => [item, ...flattenNested(...item.children)]);
// }

export function flattenNested<T extends { children?: T[]; }>(...roots: T[]): T[] {
  const result: T[] = [];
  let index = 0;

  result.push(...roots);

  while (index < result.length) {
    const current = result[index++];
    if (current?.children) result.push(...current.children);
  }

  return result;
}

export function getFishDocumentSymbolItems(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
  const symbols: FishDocumentSymbol[] = [];
  for (const current of currentNodes) {
    const childrenSymbols = getFishDocumentSymbolItems(uri, ...current.children);
    const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);

    // adds initial argv for a fish shell script/executable
    // if the current node is a program node
    if (isScriptNeededArgv(uri, current)) {
      symbols.push(...createArgvScriptDefinition(uri, current));
    }

    // adds argparse definitions
    if (current.parent && isArgparseCommandName(current)) {
      // symbols.push(...getArgparseDefinitions(uri, current));
      continue;
    }

    // if (isCommand(current)) {
    //   symbols.push(createStatusDocumentSymbol(uri, current));
    // }

    // adds symbols if the current node is a variable or function definition
    if (shouldCreate) {
      symbols.push(
        FishDocumentSymbol.create({
          name: child.text,
          kind,
          uri,
          range: getRange(parent),
          selectionRange: getRange(child),
          scope: getScope(uri, child),
          node: child,
          parent: parent,
          children: childrenSymbols || [],
        }),
      );
      continue;
    }
    symbols.push(...childrenSymbols);
  }
  return symbols;
}

/**
 * flat list of symbols, up to the position given (including symbols at the position)
 */
export function filterDocumentSymbolInScope(symbols: FishDocumentSymbol[], position: Position) {
  // return flattenNested(...symbols)
  //   .filter(symbol => {
  //     //   if (
  //     //     symbol.kind === SymbolKind.Function
  //     //       && symbol.node.parent
  //     //       && isProgram(symbol.node.parent)
  //     //   ) {
  //     //     return true;
  //     //   } else if (
  //     //     symbol.scope.containsPosition(position)
  //     //       && isPositionBefore(symbol.selectionRange.start, position)
  //     //   ) {
  //     //     return true;
  //     //   }
  //     //   return false;
  //     // });
  function isValidSymbol(symbol: FishDocumentSymbol): boolean {
    if (symbol.kind === SymbolKind.Function) {
      // Check if the function's parent node includes the position
      return !!symbol.node.parent && isPositionWithinRange(position, getRange(symbol.node.parent));
    }

    return (
      symbol.scope.containsPosition(position) &&
      isPositionBefore(symbol.selectionRange.start, position)
    );
  }

  function filterSymbolsRecursively(symbolsToFilter: FishDocumentSymbol[]): FishDocumentSymbol[] {
    return symbolsToFilter.flatMap(symbol => {
      const validChildren = symbol.children ? filterSymbolsRecursively(symbol.children) : [];
      return isValidSymbol(symbol) ? [symbol, ...validChildren] : validChildren;
    });
  }

  return filterSymbolsRecursively(symbols);
  // }
}

/**
 * unflattened workspace symbol finder
 */
export function filterWorkspaceSymbol(symbols: FishDocumentSymbol[]) {
  function filter(symbol: FishDocumentSymbol) {
    const { scopeTag } = symbol.scope;
    if (symbol.kind === SymbolKind.Function) {
      if ('global' === scopeTag) {
        return true;
      }
      // if ('local' === scopeTag && scopeNode?.parent && isProgram(scopeNode.parent)) {
      //   return true;
      // }
    } else if (symbol.kind === SymbolKind.Variable) {
      if (scopeTag === 'global') {
        return true;
      }
    }
    return false;
  }

  return flattenNested(...symbols).filter(filter);
}

/**
 * @TODO - change to use a flat symbol array, so that it can be used with
 *         filterSymbolsOutsideOfCursor(), which then can give us our completion
 *         symbols
 *
 *
 * filter out duplicate symbol definitions per scope
 * @param symbolArray - non flattened symbol array
 * @returns - flat symbol array
 */
export function filterLastPerScopeSymbol(symbolArray: FishDocumentSymbol[]) {
  const symbolTree = flattenNested(...symbolArray);
  const flatSymbols = [...symbolTree];
  return symbolTree
    .filter((symbol: FishDocumentSymbol) => !flatSymbols.some((s) => {
      return (
        s.name === symbol.name &&
        !symbol.equals(s) &&
        symbol.equalScopes(s) &&
        symbol.isBefore(s)
      );
    }));
}

/**
 * filter out duplicate symbol definitions per scope
 * @param symbolArray - non flattened symbol array
 * @returns - flat symbol array
 */
export function filterSymbolsOutsideOfCursor(symbolArray: FishDocumentSymbol[], position: Position) {
  const symbolTree = flattenNested(...symbolArray);
  return symbolTree
    .filter((symbol: FishDocumentSymbol) => {
      if (!symbol.scope.containsPosition(position)) return false;

      if (symbol.kind === SymbolKind.Variable && isPositionBefore(symbol.selectionRange.start, position)) {
        return true;
      }
      if (symbol.kind === SymbolKind.Function) {
        return true;
      }
      return false;
    });
}

export function getGlobalSyntaxNodesInDocument(nodes: SyntaxNode[], symbols: FishDocumentSymbol[]) {
  // const flatSymbols = flattenNested(...symbols)
  //   .filter(s => s.scope.scopeTag !== 'global')
  //
  // return nodes.filter(n => !flatSymbols.some(range => containsRange(range, getRange(n))));
  return nodes.filter(n => !symbols.some(symbol => containsRange(getRange(symbol.scope.scopeNode), getRange(n)) && symbol.name === n.text));
}

/**
 * take a list of non flattened symbols and return a list of symbols that are in scope
 */
export function filterSymbolsInScope(symbols: FishDocumentSymbol[], cursorPosition: Position) {
  /**
   * 1. flatten the nested symbols
   * 2. filter out symbols that are not in scope
   * 3. filter out recursive function definitions (functions that the cursor is inside of)
   * 4. filter out duplicate symbols that are both in the same scope
   */
  return flattenNested(...symbols)
    .filter(s => !(
      s.kind === SymbolKind.Function
      && Locations.Range.containsPosition(s.range, cursorPosition)
    ))
    .filter(s => s.scope.containsPosition(cursorPosition))
    .filter((current, _, results) =>
      !results.some(other =>
        current.name === other.name &&
        !other.scopeSmallerThan(current) &&
        current.scope.scopeNode.equals(other.scope.scopeNode),
      ),
    );
}

function equalRanges(range1: Range, range2: Range): boolean {
  return range1.start.line === range2.start.line &&
    range1.start.character === range2.start.character &&
    range1.end.line === range2.end.line &&
    range1.end.character === range2.end.character;
}