import {
  DocumentSymbol,
  SymbolKind,
  // Range,
  DocumentUri,
} from 'vscode-languageserver';
import { BFSNodesIter, getRange } from './tree-sitter';
import { isVariableDefinitionName, isFunctionDefinitionName, refinedFindParentVariableDefinitionKeyword } from './node-types';
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
  mdCallback: () => string;
  get detail(): string;
}

function mdCallback(this: FishDocumentSymbol): string {
  const found = PrebuiltDocumentationMap.findMatchingNames(this.name, 'variable', 'command')?.find(name => name.name === this.name);
  // const moreInfo = !!found ? found.description + md.newline() + md.separator() : md.separator();
  const kindStr = `(${symbolKindToString(this.kind)})`;
  return new MarkdownBuilder().fromMarkdown(
    [
      md.bold(kindStr), '-', md.italic(this.name),
    ],
    md.separator(),
    md.codeBlock('fish', this.node.text),
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

export function getFishDocumentSymbolItems(uri: DocumentUri, rootNode: SyntaxNode): FishDocumentSymbol[] {
  function getSymbols(...currentNodes: SyntaxNode[]): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = [];

    for (const current of Array.from(BFSNodesIter(...currentNodes))) {
      const childrenSymbols = getSymbols(...current.children);
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
            return this.mdCallback();
          },
        });
      }
    }
    return symbols;
  }

  return getSymbols(rootNode);
}

// export type Symbol = WorkspaceSymbol | DocumentSymbol;
export function flattenSymbols(...symbols: FishDocumentSymbol[]): FishDocumentSymbol[] {
  const flatten = (...arr: FishDocumentSymbol[]): FishDocumentSymbol[] => {
    return arr.reduce((acc: FishDocumentSymbol[], item) => {
      if (Array.isArray(item)) {
        return acc.concat(flatten(item));
      } else {
        return acc.concat(item);
      }
    }, []);
  };
  return flatten(...symbols);
}
