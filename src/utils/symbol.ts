import {
  DocumentSymbol,
  SymbolKind,
  // Range,
  DocumentUri,
  Position,
} from 'vscode-languageserver';
import { getRange, isPositionBefore } from './tree-sitter';
import { isVariableDefinitionName, isFunctionDefinitionName, refinedFindParentVariableDefinitionKeyword, isProgram } from './node-types';
import { SyntaxNode } from 'web-tree-sitter';
import { DefinitionScope, getScope } from './definition-scope';
import { MarkdownBuilder, md } from './markdown-builder';
import { symbolKindToString } from './translation';
import { PrebuiltDocumentationMap } from './snippets';

export interface FishDocumentSymbol extends DocumentSymbol {
  uri: string;
  children: FishDocumentSymbol[];
  scope: DefinitionScope;
  node: SyntaxNode;
  mdCallback: (parent: SyntaxNode) => string;
  get detail(): string;
}

function mdCallback(this: FishDocumentSymbol, parent: SyntaxNode): string {
  const found = PrebuiltDocumentationMap.findMatchingNames(this.name, 'variable', 'command')?.find(name => name.name === this.name);
  // const moreInfo = !!found ? found.description + md.newline() + md.separator() : md.separator();
  const kindStr = `(${symbolKindToString(this.kind)})`;
  return new MarkdownBuilder().fromMarkdown(
    [
      md.bold(kindStr), '-', md.italic(this.name),
    ],
    md.separator(),
    md.codeBlock('fish', parent.text),
    found
      ? md.newline() + md.separator() + md.newline() + found.description
      : '',
  ).toString();
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

export function flattenNested<T extends { children: T[]; }>(...items: T[]): T[] {
  return items.flatMap(item => [item, ...flattenNested(...item.children)]);
}

export function getFishDocumentSymbolItems(uri: DocumentUri, ...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
  const symbols: FishDocumentSymbol[] = [];
  for (const current of currentNodes) {
    const childrenSymbols = getFishDocumentSymbolItems(uri, ...current.children);
    const { shouldCreate, kind, parent, child } = extractSymbolInfo(current);
    if (shouldCreate) {
      symbols.push({
        name: child.text,
        kind,
        uri,
        node: current,
        range: getRange(parent),
        selectionRange: getRange(child),
        scope: getScope(uri, child),
        children: childrenSymbols ?? [] as FishDocumentSymbol[],
        mdCallback,
        get detail() {
          return this.mdCallback(parent);
        },
      });
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
  return flattenNested(...symbols)
    .filter(symbol => {
      if (
        symbol.kind === SymbolKind.Function
          && symbol.node.parent
          && isProgram(symbol.node.parent)
      ) {
        return true;
      } else if (
        symbol.scope.containsPosition(position)
          && isPositionBefore(symbol.selectionRange.start, position)
      ) {
        return true;
      }
      return false;
    });
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
      if (scopeTag === 'global' || scopeTag === 'universal') {
        return true;
      }
    }
    return false;
  }

  return flattenNested(...symbols).filter(filter);
}
