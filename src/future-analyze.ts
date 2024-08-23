import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { LspDocument } from './document';
import { /*filterGlobalSymbols,*/ FishDocumentSymbol, filterDocumentSymbolInScope, filterWorkspaceSymbol, flattenNested, getFishDocumentSymbolItems, getGlobalSyntaxNodesInDocument } from './utils/symbol';
import * as LSP from 'vscode-languageserver';
import { ancestorMatch, containsRange, equalsRanges, getChildNodes, getNodeAtPosition, getRange, isPositionBefore, isPositionWithinRange, precedesRange } from './utils/tree-sitter';
import { isSourceFilename } from './diagnostics/node-types';
import { SyncFileHelper } from './utils/file-operations';
import { Location, Position, SymbolKind } from 'vscode-languageserver';
import { findAncestor } from 'typescript';
// import { Location } from './utils/locations';

type AnalyzedDocument = {
  document: LspDocument;
  symbols: FishDocumentSymbol[];
  tree: Tree;
  root: SyntaxNode;
  nodes: SyntaxNode[];
  sourcedFiles: string[];
};

/**
 * REFACTORING ./analyze.ts
 * ONCE ./utils/workspace.ts IS COMPLETED!
 *
 * What is the goal here?
 *   - [ ] ./src/analyze.ts easier to test,
 *   - [ ] ./src/analyze.ts is clearer in scope && usage
 *   - [ ] ./src/analyze.ts is smaller and better structured
 *   - [ ] ./src/analyze.ts is extendable & maintainable
 */
export class Analyzer { // @TODO rename to Analyzer
  public cached: Map<string, AnalyzedDocument> = new Map();
  public workspaceSymbols: Map<string, FishDocumentSymbol[]> = new Map();

  constructor(protected parser: Parser) { }

  private createAnalyzedDocument(document: LspDocument): AnalyzedDocument {
    const tree = this.parser.parse(document.getText());
    const root = tree.rootNode;
    const nodes = getChildNodes(root);
    const symbols = getFishDocumentSymbolItems(document.uri, tree.rootNode);
    const sourcedFiles = nodes
      .filter(isSourceFilename)
      .map(n => n.text);
    const workspaceSymbols = filterWorkspaceSymbol(symbols);

    for (const symbol of workspaceSymbols) {
      const currentSymbols = this.workspaceSymbols.get(symbol.name) ?? [];
      currentSymbols.push(symbol);
      this.workspaceSymbols.set(symbol.name, currentSymbols);
    }

    return {
      document,
      tree,
      root,
      nodes,
      symbols,
      sourcedFiles,
    };
  }

  analyze(document: LspDocument): AnalyzedDocument {
    this.parser.reset();
    const analyzed = this.createAnalyzedDocument(document);
    this.cached.set(document.uri, analyzed);
    return analyzed;
  }


  /**
   * A wrapper for this.analyze(). Creates an LspDocument from a filepath and analyzes it.
   * @returns LspDocument - the document analyzed
   */
  analyzeFilepath(filepath: string) {
    const document = SyncFileHelper.toLspDocument(filepath, 'fish', 1);
    this.analyze(document);
    return document;
  }

  /**
   * call at startup to analyze in background
   */
  // async initalizeBackgroundAnalysis() {}

  /**
   * getFlatSymbols - flattened document symbol array. Helper function to be used
   * throughout this class.
   */
  getFlatSymbols(document: LspDocument): FishDocumentSymbol[] {
    const symbols: FishDocumentSymbol[] = this.analyze(document).symbols;
    return flattenNested(...symbols);
  }

  get uris() {
    return [ ...new Set(Array.from(this.cached.keys())) ];
  }


  /**
   * getDefinitionSymbol - get definition symbol in a LspDocument
   */
  getDefinitionSymbol(document: LspDocument, position: Position) {
    if (!this.cached.has(document.uri)) return [];
    const { tree } = this.cached.get(document.uri)!;
    const currentNode = getNodeAtPosition(tree, position);
    if (!currentNode) return [];
    const result: FishDocumentSymbol[] = [];
    const localSymbols: FishDocumentSymbol[] = filterDocumentSymbolInScope(
      this.analyze(document).symbols,
      position
    ).filter(s => s.name === currentNode.text);
    result.push(...localSymbols);
    if (result.length === 0) {
      const workspaceSymbols = this.workspaceSymbols.get(currentNode.text) || [];
      result.push(...workspaceSymbols);
    }
    return result;
  }

  // @TODO - use locations
  // https://github.com/ndonfris/fish-lsp/blob/782e14a2d8875aeeddc0096bf85ca1bc0d7acc77/src/workspace-symbol.ts#L139
  /**
   * getReferenceSymbols - gets all references of a symbol in a LspDocument
   */
  getReferenceSymbols(document: LspDocument, position: Position) {
    const result: SyntaxNode[] = [];
    if (!this.cached.has(document.uri)) return [];
    const { tree, symbols } = this.cached.get(document.uri)!;
    const currentNode = this.getDefinitionSymbol(document, position).pop();
    if (!currentNode) return [];

    // const result = flattenNested(...symbols).filter(s => s.name === currentNode.text)
    result.push(...getChildNodes(currentNode.scope.scopeNode).filter(n => n.text === currentNode.name));

    if (result.length === 0) {
      for (const uri of this.uris) {
        const _cached = this.cached.get(uri);
        if (!_cached) continue;

        const gSymbols = flattenNested(..._cached.symbols)
          .filter(s => s.scope.scopeTag !== 'global');

        const matches = getGlobalSyntaxNodesInDocument(_cached.nodes, gSymbols)
          .filter(s => s.text === currentNode.name);
        //   .filter(s => s.scope.scopeTag !== 'global') ))

        result.push(...matches);
      }
    }
    return result;
  }

  getLocalLocations(document: LspDocument, position: Position) {
    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (!symbol) return [];

    const nodeToSearch = getChildNodes(symbol.scope.scopeNode);
    return findLocations(document.uri, nodeToSearch, symbol.name);
  }

  getGlobalLocations(document: LspDocument, position: Position) {
    const locations: LSP.Location[] = [];

    const symbol = this.getDefinitionSymbol(document, position);
    if (symbol.length === 0) return locations;

    for (const uri of this.uris) {
      const _cached = this.cached.get(uri);
      if (!_cached?.document.isAutoLoaded()) continue;

      const rootNode = _cached.tree.rootNode;
      const toSearchNodes = getGlobalSyntaxNodesInDocument(
        getChildNodes(rootNode),
        flattenNested(..._cached.symbols).filter(s => s.scope.scopeTag !== 'global')
      );
      const newLocations = findLocations(uri, toSearchNodes, symbol.at(0)!.name);
      locations.push(...newLocations);
    }
    return locations;
  }

  /**
   * getHover - gets the hover documentation of a symbol in a LspDocument
   */
  // getHover() {}

  /**
   * @TODO
   *
   * getCompletionSymbols - local symbols to send to a onCompletion request in server
   * @returns FishDocumentSymbol[]
   */
  getCompletionSymbols(document: LspDocument, position: Position): FishDocumentSymbol[] {
    const _cached = this.cached.get(document.uri);
    if (!_cached) return [];
    const { symbols, tree } = _cached;
    const currentNode = getNodeAtPosition(tree, position);
    if (!currentNode) return [];

    const parentFunctions = ancestorMatch(currentNode, n => n.type === 'function_definition')
      .map(n => n.child(1)!);

    const result: FishDocumentSymbol[] = [];
    const _symbols = flattenNested(...symbols).filter(s => {
      return !parentFunctions.some(p => s.node.equals(p))
    })
    for (const s of _symbols) {
      if (!s.scope.containsPosition(position)) {
        // && !(s.kind === SymbolKind.Function && containsRange(s.range, getRange(currentNode)))) {
        continue;
      }
      if (s.kind === SymbolKind.Function && isPositionBefore(position, s.range.start)) {
        continue;
      }
      result.push(s);
    }
    return result;
    // return flattenNested(...symbols).filter(s => precedesRange(getRange(s.node), getRange(currentNode)));
  }

  /**
   * getSignatureInformation - looks through the symbols for functions that can be used
   * to create SignatureInfo objects to be used in the server. Only function SymbolKind's
   * will be used.
   */
  // getSignatureInformation() {}

  /**
   * getWorkspaceSymbols - looks up a query symbol in the entire cachedDocuments object.
   * An empty query will return all symbols in the current workspace.
   */
  getWorkspaceSymbols(query: string = ''): LSP.WorkspaceSymbol[] {
    const allSymbols = Array.from(this.workspaceSymbols.values()).flat().map(s => LSP.WorkspaceSymbol.create(s.name, s.kind, s.uri, s.range));
    if (query === '') {
      return allSymbols;
    }

    return allSymbols.filter(s => s.name.startsWith(query));
  }

  /**
   * updateUri - deletes an old Uri Entry, and updates
   */
}

function findLocations(uri: string, nodes: SyntaxNode[], matchName: string): Location[] {
  const equalRanges = (a: LSP.Range, b: LSP.Range) => {
    return (
      a.start.line === b.start.line &&
      a.end.line === b.end.line &&
      a.start.character === b.start.character &&
      a.end.character === b.end.character
    );
  };
  const matchingNames = nodes.filter(node => node.text === matchName);
  const uniqueRanges: LSP.Range[] = [];
  matchingNames.forEach(node => {
    const range = getRange(node);
    if (uniqueRanges.some(u => equalRanges(u, range))) {
      return;
    }
    uniqueRanges.push(range);
  });
  return uniqueRanges.map(range => Location.create(uri, range));
}