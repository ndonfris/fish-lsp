import Parser, { SyntaxNode, Tree } from 'web-tree-sitter';
import { LspDocument } from './document';
import { /*filterGlobalSymbols,*/ FishDocumentSymbol, filterDocumentSymbolInScope, filterSymbolsInScope, filterWorkspaceSymbol, flattenNested, getFishDocumentSymbolItems, getGlobalSyntaxNodesInDocument } from './utils/symbol';
import * as LSP from 'vscode-languageserver';
import { ancestorMatch, containsRange, equalsRanges, getChildNodes, getNodeAtPosition, getRange, isPositionBefore, isPositionWithinRange, pointToPosition, positionToPoint, precedesRange, findFirstParent, getNodeAtPoint } from './utils/tree-sitter';
import { isSourceFilename } from './diagnostics/node-types';
import { SyncFileHelper } from './utils/file-operations';
import { Location, Position, SymbolKind } from 'vscode-languageserver';
// import { findAncestor } from 'typescript';
import { Range } from './utils/locations';
import { isCommandName, isFunctionDefinition, isNewline, isProgram, isSemicolon } from './utils/node-types';
import { getScopeTagValue } from './utils/definition-scope';
// import { isFunction } from './utils/builtins';

type SymbolArrayObject = {
  nested: () => FishDocumentSymbol[],
  flat: () => FishDocumentSymbol[]
};

type AnalyzedDocument = {
  document: LspDocument;
  symbols: SymbolArrayObject,
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
    const symbols = createSymbols(getFishDocumentSymbolItems(document.uri, root));
    const sourcedFiles = nodes
      .filter(isSourceFilename)
      .map(n => n.text);
    const workspaceSymbols = filterWorkspaceSymbol(symbols.nested());

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
  // private hasAnalyzedDocument(uri: string): uri is string & keyof Map<string, AnalyzedDocument> {
  //   return this.cached.has(uri);
  // }

  /**
   * getDocumentSymbols - gets all uris analyzed
   */
  get uris() {
    return Array.from(this.cached.keys());
  }

  get cachedEntries() {
    return Array.from(this.cached.entries());
  }

  /**
   * @TODO: FIX
   * getDefinitionSymbol - get definition symbol in a LspDocument
   */
  getDefinitionSymbol(document: LspDocument, position: Position): FishDocumentSymbol[] {
    const cached = this.cached.get(document.uri);
    if (!cached) return []

    const node =  getNodeAtPosition(cached.tree, position);
    if (!node) return []

    const text = node.text;
    const symbols = symbolsScopeContainsPosition(cached.symbols.flat(), position);

    // console.log({text});
    const localSymbol = symbols.filter(s => s.name === text);
    if (localSymbol.length > 0) {
      return localSymbol;
    }

    const globalSymbols = this.workspaceSymbols.get(text) ?? [];
    if (globalSymbols.length > 0) {
      return globalSymbols;
    }

    // execute shell command to get definition
    /** 
     * // const definitionFilepath = await this.getDefinition(document.uri, position); 
     * // const cachedDef = this.analyzeFilepath(definitionFilepath);
     * // return cachedDef.symbols.flat().filter(s => s.name === text);
     */
    return [];
  }

  private removeLocalSymbols(
    matchSymbol: FishDocumentSymbol,
    nodes: SyntaxNode[],
    symbols: FishDocumentSymbol[]
  ) {
    // const name = matchSymbol.name;
    const matchingSymbols = symbols
    .filter(s => s.name === matchSymbol.name)
    .filter(s => s.scope.tagValue() < getScopeTagValue('global'))
    .map(s => s.scope.scopeNode)

    const matchingNodes = nodes.filter(node => node.text === matchSymbol.name);

    if (matchingSymbols.length === 0 || matchSymbol.kind === SymbolKind.Function) {
      return matchingNodes;
    }

    return matchingNodes.filter((node) => {
      if (matchingSymbols.some(scopeNode => containsRange(getRange(scopeNode), getRange(node)))) {
        return false;
      }
      return true;
    });
  }

  private findLocalLocations(document: LspDocument, position: Position) {
    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (!symbol) return [];

    const nodes = getChildNodes(symbol.scope.scopeNode)
    return findLocations(document.uri, nodes, symbol.name);
  }

  private  findGlobalLocations(document: LspDocument, position: Position) {
    const locations: LSP.Location[] = [];
    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (!symbol) return locations;

    for (const uri of this.uris) {
      const cached = this.cached.get(uri);
      if (!cached) continue;

      const rootNode = cached.tree.rootNode;
      const toSearchNodes = this.removeLocalSymbols(
        symbol,
        getChildNodes(rootNode),
        cached.symbols.flat()
      );
      const newLocations = findLocations(uri, toSearchNodes, symbol.name);
      locations.push(...newLocations);
    }
    return locations;
  }

  getReferences(document: LspDocument, position: Position): LSP.Location[] {
    const tree = this.cached.get(document.uri)?.tree
    if (!tree) return []

    const node = getNodeAtPoint(tree, {line: position.line, column: position.character});
    if (!node) return [];

    const symbol = this.getDefinitionSymbol(document, position).pop();
    if (symbol) {
      switch (symbol.scope.scopeTag) {
        case 'global':
          return this.findGlobalLocations(document, position);
        case 'function':
        case 'inherit':
        case 'local':
        default:
          return this.findLocalLocations(document, position);
      }
    }

    if (isCommandName(node)) {
      const locations: Location[] = [];
      for (const [uri, cached] of this.cachedEntries) {
        const rootNode = cached.root;
        const nodes = getChildNodes(rootNode).filter(n => isCommandName(n));
        const newLocations = findLocations(uri, nodes, node.text);
        locations.push(...newLocations);
      }
      return locations;
    }

    return [];
  }

  //
  // @TODO - use locations
  // https://github.com/ndonfris/fish-lsp/blob/782e14a2d8875aeeddc0096bf85ca1bc0d7acc77/src/workspace-symbol.ts#L139
  /**
   * getReferenceSymbols - gets all references of a symbol in a LspDocument
   */
  // getReferences(document: LspDocument, position: Position): LSP.Location[] {
  //   const cached = this.cached.get(document.uri)
  //   if (!cached) return []
  //
  //   const toFind = getNodeAtPosition(cached.tree, position);
  //   if (!toFind) return [];
  //
  //   const result: LSP.Location[] = [];
  //   // const current = this.cached.get(document.uri).symbols;
  //
  //   const defSymbol = this.getDefinitionSymbol(document, position).pop()
  //   // if ()
  //   
  //   if (cached.symbols.flat().length === 0) return result;
  //   // const defSymbol  = filterSymbolsInScope(cached.symbols.nested(), position).pop()
  //   if (!defSymbol) return result;
  //
  //   if (defSymbol.scope.scopeTag !== 'global') {
  //     return this.getLocalLocations(document, position);
  //   }
  //
  //   return this.getGlobalLocations(document, position);
  //   // const uniqueLocations = new UniqueLocations();
  //   // for (const [uri, cached] of Array.from(this.cached.entries())) {
  //   //   this.getLocalLocations(cached.document, position)
  //   //   const getIncludedNodes = (  ) => {
  //   //     if (defSymbol.scope.scopeTag !== 'global') {
  //   //       return getChildNodes(defSymbol.scope.scopeNode)
  //   //     }
  //   //     return cached.nodes
  //   //   }
  //   //
  //   //
  //   //   // for (const node of possibleNodes) {
  //   //   //   if (node.text !== defSymbol.name) continue;
  //   //   //   const range = getRange(node);
  //   //   //   if (node.text === defSymbol.name) {
  //   //   //     uniqueLocations.add(LSP.Location.create(uri, range))
  //   //   //   }
  //   //   // }
  //   // }
  //   // return uniqueLocations.locations;
  // }

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
    const _symbols = _cached.symbols.flat().filter(s => {
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

  getNodeAtRange(uri: string, range: LSP.Range): SyntaxNode | undefined {
    const cached = this.cached.get(uri);
    if (!cached) return;
    return cached.tree.rootNode.descendantForPosition(positionToPoint(range.start));
  }

  getNodeAtLocation(location: LSP.Location): SyntaxNode | undefined {
    return this.getNodeAtRange(location.uri, location.range);
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


export function createSymbols(symbols: FishDocumentSymbol[]): SymbolArrayObject {
  return {
    nested: () => symbols,
    flat: () => flattenNested(...symbols)
  };
}


function symbolsScopeContainsPosition(symbols: FishDocumentSymbol[], position: Position) {
  const result: FishDocumentSymbol[] = [];
  for (const symbol of symbols) {
    if (symbol.scope.containsPosition(position)) {
      result.push(symbol);
    }
  }
  return result;
}

/**
 * getAccessibleNodes - gets all nodes that are accessible to a symbol
 */
// export function getAccessibleNodes(root: SyntaxNode, symbols: FishDocumentSymbol[], matchSymbol: FishDocumentSymbol) {
//   // const result: SyntaxNode[] = [];
//   // const isMatchUri = symbols.some(s => s.uri === matchSymbol.uri);
//   // let matches: FishDocumentSymbol[] = symbols
//   //   .filter(s => s.name === matchSymbol.name)
//   //
//   // if (isMatchUri) {
//   //   matches = matches.filter(s => !s.equalScopes(matchSymbol))
//   //   return getChildNodes(matchSymbol.scope.scopeNode)
//   //     .filter(n => matches.some(s => s.scope.containsNode(n)))
//   // } else {
//   //    matches = matches.filter(s => {
//   //     if (s.scope.scopeTag !== 'global') return true;
//   //     return false;
//   //   })
//   //   return getChildNodes(root)
//   //     .filter(n => !matches.some(s => s.scope.containsNode(n)))
//   // }
// }

export function getAccessibleNodes(
  root: SyntaxNode, 
  symbols: FishDocumentSymbol[], 
  matchSymbol: FishDocumentSymbol
): SyntaxNode[] {

  const isMatchUri = symbols.some(s => s.uri === matchSymbol.uri);
  const matchingSymbols = symbols.filter(s => s.name === matchSymbol.name);

  if (isMatchUri) {
    // Local scope: Filter nodes that are in different scopes
    const differentScopeSymbols = matchingSymbols.filter(s => !s.scopeEquivalent(matchSymbol))
    return getChildNodes(matchSymbol.scope.scopeNode)
      .filter(node => differentScopeSymbols.some(s => s.scope.containsNode(node)));
  } else {
    // Global scope: Filter out nodes that are not in the global scope
    const nonGlobalSymbols = matchingSymbols.filter(s => s.scope.scopeTag !== 'global');
    return getChildNodes(root)
      .filter(node => !nonGlobalSymbols.some(s => s.scope.containsNode(node)));
  }
}

class UniqueLocations {
  private map = new Map<string, LSP.Location>();
  private arr: LSP.Location[] = [];

  private key(loc: LSP.Location): string {
    const { uri, range } = loc;
    const { start, end } = range;
    return `${uri}:${start.line}:${start.character}-${end.line}:${end.character}`;
  }

  add(loc: LSP.Location): void {
    const key = this.key(loc);
    if (!this.map.has(key)) {
      this.map.set(key, loc);
      this.arr.push(loc);
    }
  }

  get locations(): LSP.Location[] {
    return this.arr;
  }
}