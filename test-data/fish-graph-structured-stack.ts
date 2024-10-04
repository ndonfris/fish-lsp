import { Range, Location, Position, SymbolKind } from 'vscode-languageserver';

interface TextSpan {
  ranges: Range[];
}

type ScopeType = 'local' | 'global' | 'universal';

interface FishDocumentSymbol {
  text: string;
  type: SymbolKind;
  children: FishDocumentSymbol[];
  scopeType?: ScopeType;
  location: Location;
  scope: TextSpan;
}

class SymbolNode {
  symbol: FishDocumentSymbol;
  parent: SymbolNode | null;
  children: SymbolNode[];
  localScope: Map<string, FishDocumentSymbol>;
  references: Location[];

  constructor(symbol: FishDocumentSymbol, parent: SymbolNode | null = null) {
    this.symbol = symbol;
    this.parent = parent;
    this.children = [];
    this.localScope = new Map();
    this.references = [];
  }

  addChild(child: SymbolNode): void {
    this.children.push(child);
    child.parent = this;
  }

  addToScope(symbol: FishDocumentSymbol): void {
    this.localScope.set(symbol.text, symbol);
  }

  addReference(location: Location): void {
    this.references.push(location);
  }
}

const userConfigRoot = new SymbolNode({ text: '_@@root@@_', type: SymbolKind.Namespace, children: [], location: Location.create('', Range.create(0, 0, 0, 0)), scope: { ranges: [] } });
// const userConfigFile = new SymbolNode({ text: '_@@config@@_', type: SymbolKind.File, children: [], location: Location.create('user-config.fish', Range.create(0, 0, 0, 0)), scope: { ranges: [] } });

class FishSymbolGraph {
  private root: SymbolNode;
  private fileNodes: Map<string, SymbolNode>;
  private globalSymbols: Map<string, SymbolNode>;
  private universalSymbols: Map<string, SymbolNode>;

  constructor() {
    this.root = userConfigRoot;
    this.fileNodes = new Map();
    this.globalSymbols = new Map();
    this.universalSymbols = new Map();
  }

  addFile(filePath: string, symbols: FishDocumentSymbol[]): void {
    const fileNode = new SymbolNode({ text: filePath, type: SymbolKind.File, children: [], location: Location.create(filePath, Range.create(0, 0, 0, 0)), scope: { ranges: [] } });
    this.fileNodes.set(filePath, fileNode);
    this.root.addChild(fileNode);
    this.addSymbols(symbols, fileNode);
  }

  private addSymbols(symbols: FishDocumentSymbol[], parentNode: SymbolNode): void {
    for (const symbol of symbols) {
      const node = new SymbolNode(symbol, parentNode);
      parentNode.addChild(node);

      if (symbol.type === SymbolKind.Function) {
        this.processFunctionScope(node);
      } else if (symbol.type === SymbolKind.Variable) {
        this.addVariableToScope(symbol, node);
      }

      if (symbol.children.length > 0) {
        this.addSymbols(symbol.children, node);
      }
    }
  }

  addReference(word: string, location: Location): void {
    const definition = this.findDefinition(word, location);
    if (definition) {
      const definitionNode = this.findNodeForSymbol(definition);
      if (definitionNode) {
        definitionNode.addReference(location);
      }
    }
  }

  private findNodeForSymbol(symbol: FishDocumentSymbol): SymbolNode | undefined {
    for (const fileNode of Array.from(this.fileNodes.values())) {
      const node = this.findNodeForSymbolInSubtree(fileNode, symbol);
      if (node) return node;
    }
    return undefined;
  }

  private findNodeForSymbolInSubtree(node: SymbolNode, symbol: FishDocumentSymbol): SymbolNode | undefined {
    if (node.symbol === symbol) return node;
    for (const child of node.children) {
      const foundNode = this.findNodeForSymbolInSubtree(child, symbol);
      if (foundNode) return foundNode;
    }
    return undefined;
  }

  private processFunctionScope(functionNode: SymbolNode): void {
    for (const child of functionNode.symbol.children) {
      if (child.type === SymbolKind.Variable) {
        functionNode.addToScope(child);
      }
    }
  }

  private addVariableToScope(variable: FishDocumentSymbol, node: SymbolNode): void {
    switch (variable.scopeType) {
      case 'universal':
        this.universalSymbols.set(variable.text, node);
        break;
      case 'global':
        this.globalSymbols.set(variable.text, node);
        break;
      default:
        node.addToScope(variable);
    }
  }

  findDefinition(word: string, location: Location): FishDocumentSymbol | undefined {
    const fileNode = this.fileNodes.get(location.uri);
    if (!fileNode) return undefined;

    const startNode = this.findMostSpecificNodeAtLocation(fileNode, location);
    return this.findDefinitionInScope(word, startNode);
  }

  private findDefinitionInScope(word: string, startNode: SymbolNode): FishDocumentSymbol | undefined {
    let currentNode: SymbolNode | null = startNode;

    while (currentNode) {
      // Check local scope
      if (currentNode.localScope.has(word)) {
        return currentNode.localScope.get(word);
      }

      // Check if we're at file level
      if (currentNode.symbol.type === SymbolKind.File) {
        // Check global and universal scopes
        const globalSymbol = this.globalSymbols.get(word);
        if (globalSymbol) return globalSymbol.symbol;

        const universalSymbol = this.universalSymbols.get(word);
        if (universalSymbol) return universalSymbol.symbol;

        // Check file-level scope for functions and variables
        for (const child of currentNode.children) {
          if ((child.symbol.type === SymbolKind.Function || child.symbol.type === SymbolKind.Variable) && child.symbol.text === word) {
            return child.symbol;
          }
        }
      }

      currentNode = currentNode.parent;
    }

    return undefined;
  }

  /**
   * @TODO: FIX THIS METHOD!!!!!
   *  - its not finding the global references correctly
   *  - its not finding the local references correctly
   *
   * @param word - The word to find references for
   * @param location - The location to start searching from
   * @returns - A list of locations where the word is referenced
   */
  findReferences(word: string, location: Location): Location[] {
    const definition = this.findDefinition(word, location);
    if (!definition) return [];

    const references: Location[] = [definition.location];
    const fileNode = this.fileNodes.get(location.uri);
    if (!fileNode) return references;

    this.collectReferences(word, fileNode, definition, references);
    return references;
  }

  private collectReferences(word: string, node: SymbolNode, definition: FishDocumentSymbol, references: Location[]): void {
    // Check if this node represents the word we're looking for
    if (node.symbol.text === word && this.isSameLocation(node.symbol.location, definition.location)) {
      if (!references.some(r => node.symbol.location.range.start.line === r.range.start.line &&
          node.symbol.location.range.start.character === r.range.start.character &&
          node.symbol.location.range.end.line === r.range.end.line &&
          node.symbol.location.range.end.character === r.range.end.character,
      )) {
        references.push(node.symbol.location);
      }

      // Check references in this node
      for (const ref of node.references) {
        if (this.isInScope(ref, definition.scope)) {
          references.push(ref);
        }
      }

      // Recurse into children, but respect scoping rules
      for (const child of node.children) {
        if (child.symbol.type !== SymbolKind.Function || !child.localScope.has(word)) {
          this.collectReferences(word, child, definition, references);
        }
      }
    }
  }

  private findMostSpecificNodeAtLocation(startNode: SymbolNode, location: Location): SymbolNode {
    const currentNode = startNode;
    for (const child of startNode.children) {
      if (this.isInScope(location, child.symbol.scope)) {
        return this.findMostSpecificNodeAtLocation(child, location);
      }
    }
    return currentNode;
  }

  private isInScope(location: Location, scope: TextSpan): boolean {
    return scope.ranges.some(range => this.isPositionInRange(location.range.start, range));
  }

  private isPositionInRange(position: Position, range: Range): boolean {
    return (position.line > range.start.line || position.line === range.start.line && position.character >= range.start.character) &&
      (position.line < range.end.line || position.line === range.end.line && position.character <= range.end.character);
  }

  private isSameLocation(loc1: Location, loc2: Location): boolean {
    return loc1.uri === loc2.uri &&
      loc1.range.start.line === loc2.range.start.line &&
      loc1.range.start.character === loc2.range.start.character;
  }
}

// Usage example
const graph = new FishSymbolGraph();

// Add a file to the graph
graph.addFile('/home/user/example.fish', [
  {
    text: 'a',
    type: SymbolKind.Variable,
    children: [],
    scopeType: 'global',
    location: Location.create('/home/user/example.fish', Range.create(0, 0, 0, 15)),
    scope: { ranges: [Range.create(0, 0, 100, 0)] },
  },
  {
    text: 'b',
    type: SymbolKind.Variable,
    children: [],
    scopeType: 'local',
    location: Location.create('/home/user/example.fish', Range.create(1, 0, 1, 20)),
    scope: { ranges: [Range.create(0, 0, 100, 0)] },
  },
  {
    text: 'echo_a',
    type: SymbolKind.Function,
    children: [],
    location: Location.create('/home/user/example.fish', Range.create(3, 0, 9, 3)),
    scope: { ranges: [Range.create(3, 0, 9, 3)] },
  },
  {
    text: '_echo_a_helper',
    type: SymbolKind.Function,
    children: [
      {
        text: '_inner_private_func',
        type: SymbolKind.Function,
        children: [],
        location: Location.create('/home/user/example.fish', Range.create(12, 4, 15, 7)),
        scope: { ranges: [Range.create(12, 4, 15, 7)] },
      },
    ],
    location: Location.create('/home/user/example.fish', Range.create(11, 0, 18, 3)),
    scope: { ranges: [Range.create(11, 0, 18, 3)] },
  },
]);

// Helper function to create a Location
function createLocation(uri: string, startLine: number, startChar: number, endLine: number, endChar: number): Location {
  return Location.create(uri, Range.create(startLine, startChar, endLine, endChar));
}

// Add a file to the graph
const filePath = '/home/user/example.fish';

// Add references
const referenceLocations: { name: string; location: Location; }[] = [
  { name: 'a', location: createLocation(filePath, 4, 13, 4, 14) },  // $a in echo_a
  { name: 'b', location: createLocation(filePath, 5, 13, 5, 14) },  // $b in echo_a
  { name: '_echo_a_helper', location: createLocation(filePath, 7, 4, 7, 18) },   // _echo_a_helper call in echo_a
  { name: 'a', location: createLocation(filePath, 13, 17, 13, 18) }, // $a in _inner_private_func
  { name: 'b', location: createLocation(filePath, 14, 17, 14, 18) }, // $b in _inner_private_func
  { name: '_inner_private_func', location: createLocation(filePath, 16, 4, 16, 23) },  // _inner_private_func call in _echo_a_helper
  { name: 'a', location: createLocation(filePath, 17, 13, 17, 14) }, // $a in _echo_a_helper
  { name: 'b', location: createLocation(filePath, 18, 13, 18, 14) }, // $b in _echo_a_helper
  { name: 'echo_a', location: createLocation(filePath, 20, 0, 20, 6) },   // echo_a call at file level
];

referenceLocations.forEach(({ name, location }) => {
  graph.addReference(name, location);
});

// Find definition
const aDefinition = graph.findDefinition('a', Location.create('/home/user/example.fish', Range.create(5, 10, 5, 11)));
console.log('Definition of a:', JSON.stringify(aDefinition, null, 2));

const logRef = (name: string, references: Location[]) => {
  console.log(`References to ${name}:`);
  references.forEach(ref => {
    console.log(JSON.stringify({ ref }, null, 2));
  });
};

// Test finding references
// const aReferences = graph.findReferences('a', createLocation(filePath, 0, 0, 0, 1));
// logRef('a', aReferences);
//
// const bReferences = graph.findReferences('b', createLocation(filePath, 1, 0, 1, 1));
// logRef('b', bReferences);

const echo_aReferences = graph.findReferences('echo_a', createLocation(filePath, 3, 0, 3, 1));
logRef('echo_a', echo_aReferences);

// const _echo_a_helperreferences = graph.findreferences('_echo_a_helper', createlocation(filepath, 11, 0, 11, 1));
// logref('_echo_a_helper', _echo_a_helperreferences);
//
// const _inner_private_funcReferences = graph.findReferences('_inner_private_func', createLocation(filePath, 12, 4, 12, 5));
// logRef('_inner_private_func', _inner_private_funcReferences);
